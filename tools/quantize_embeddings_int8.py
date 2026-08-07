#!/usr/bin/env python3
"""Quantize the word-embedding matrix of the BardsAI fp16 ONNX model to int8.

MatMulNBits (q4f16) quantization never touches the Gather-fed embedding
table, so it ships at fp16 and dominates the artifact. Embeddings are lookup
rows, not matmul operands, so symmetric per-row int8 is near-lossless:

    Gather(weight_f16, ids)                                  # before
    Mul(Cast(Gather(weight_i8, ids), f16), Gather(scale_f16, ids))  # after

The int8 table + per-row fp16 scales halve the embedding bytes. The rewrite
streams the external-data file directly (no protobuf round-trip of weights).

Usage:
  python3 tools/quantize_embeddings_int8.py --input-dir <dir> --output-dir <dir>

Reads/writes onnx/model_fp16.onnx (+ .data). Input and output dirs must differ.
"""
import argparse, os, sys
import numpy as np
import onnx
from onnx import TensorProto, helper

EMB = "roberta.embeddings.word_embeddings.weight"
DATA_FILE = "model_fp16.onnx.data"
ALIGNMENT = 4096

def external_info(init):
    info = {kv.key: kv.value for kv in init.external_data}
    return info["location"], int(info.get("offset", 0)), int(info["length"])

def make_external(name, dims, elem_type, offset, length):
    t = TensorProto()
    t.name = name
    t.dims.extend(dims)
    t.data_type = elem_type
    t.data_location = TensorProto.EXTERNAL
    for k, v in (("location", DATA_FILE), ("offset", str(offset)), ("length", str(length))):
        kv = t.external_data.add(); kv.key = k; kv.value = v
    return t

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True)
    p.add_argument("--output-dir", required=True)
    a = p.parse_args()
    src_onnx = os.path.join(a.input_dir, "onnx", "model_fp16.onnx")
    out_onnx = os.path.join(a.output_dir, "onnx", "model_fp16.onnx")
    if os.path.abspath(src_onnx) == os.path.abspath(out_onnx):
        print("error: input and output dirs must differ", file=sys.stderr); return 1
    os.makedirs(os.path.join(a.output_dir, "onnx"), exist_ok=True)

    model = onnx.load(src_onnx, load_external_data=False)
    inits = list(model.graph.initializer)
    emb_init = next(i for i in inits if i.name == EMB)
    vocab, hidden = emb_init.dims[0], emb_init.dims[1]

    src = open(os.path.join(a.input_dir, "onnx", DATA_FILE), "rb")
    dst = open(os.path.join(a.output_dir, "onnx", DATA_FILE), "wb")

    new_inits = []
    externals = sorted(
        (i for i in inits if i.data_location == TensorProto.EXTERNAL),
        key=lambda i: external_info(i)[1],
    )
    for init in externals:
        loc, off, length = external_info(init)
        src.seek(off)
        dst.write(b"\0" * ((-dst.tell()) % ALIGNMENT))
        if init.name == EMB:
            w = np.frombuffer(src.read(length), dtype=np.float16).reshape(vocab, hidden).astype(np.float32)
            absmax = np.abs(w).max(axis=1, keepdims=True)
            scale = (absmax / 127.0).astype(np.float16).astype(np.float32)
            scale[scale == 0] = 1.0
            q = np.clip(np.rint(w / scale), -127, 127).astype(np.int8)
            q_off = dst.tell(); dst.write(q.tobytes())
            dst.write(b"\0" * ((-dst.tell()) % ALIGNMENT))
            s_off = dst.tell(); s16 = scale.astype(np.float16); dst.write(s16.tobytes())
            new_inits.append(make_external(EMB + "_q8", (vocab, hidden), TensorProto.INT8, q_off, q.nbytes))
            new_inits.append(make_external(EMB + "_scale", (vocab, 1), TensorProto.FLOAT16, s_off, s16.nbytes))
            err = np.abs(q.astype(np.float32) * scale - w).max()
            print("embedding int8: %d x %d, %.0f MB -> %.0f MB, max abs err %.5f"
                  % (vocab, hidden, length / 2**20, (q.nbytes + s16.nbytes) / 2**20, err))
        else:
            new_off = dst.tell()
            remaining = length
            while remaining:
                chunk = src.read(min(remaining, 64 * 2**20))
                dst.write(chunk); remaining -= len(chunk)
            for kv in init.external_data:
                if kv.key == "offset": kv.value = str(new_off)
    src.close(); dst.close()

    # graph rewrite: Gather(emb) -> Mul(Cast(Gather(q8)), Gather(scale))
    gather_idx, gather = next(
        (idx, n) for idx, n in enumerate(model.graph.node)
        if n.op_type == "Gather" and n.input[0] == EMB
    )
    ids, out_name = gather.input[1], gather.output[0]
    nodes = [
        helper.make_node("Gather", [EMB + "_q8", ids], [out_name + "_q8"],
                         name=gather.name + "_q8"),
        helper.make_node("Gather", [EMB + "_scale", ids], [out_name + "_scale"],
                         name=gather.name + "_scale"),
        helper.make_node("Cast", [out_name + "_q8"], [out_name + "_f16raw"],
                         to=TensorProto.FLOAT16, name=gather.name + "_cast"),
        helper.make_node("Mul", [out_name + "_f16raw", out_name + "_scale"], [out_name],
                         name=gather.name + "_dequant"),
    ]
    del model.graph.node[gather_idx]
    for n, node in enumerate(nodes):
        model.graph.node.insert(gather_idx + n, node)
    model.graph.initializer.remove(emb_init)
    model.graph.initializer.extend(new_inits)

    onnx.save(model, out_onnx)
    onnx.checker.check_model(out_onnx)
    print("done")
    return 0

if __name__ == "__main__":
    sys.exit(main())
