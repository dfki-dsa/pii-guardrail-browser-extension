#!/usr/bin/env python3
"""Prune the XLM-RoBERTa vocabulary of the BardsAI NER model to EU scripts.

XLM-R's 250k SentencePiece vocab covers ~100 languages; its fp16 embedding
matrix (250002 x 768 = 384 MB) dominates the shipped q4f16 artifact because
MatMulNBits quantization leaves Gather-fed embeddings at fp16. Privacy
Guardrail targets EU official languages only, so tokens whose letters fall
outside Latin / Greek / Cyrillic scripts are dead rows.

This script:
  1. filters tokenizer.json's Unigram vocab to EU-script tokens (order kept),
  2. remaps added_tokens ids (<mask> moves to the new last id),
  3. slices the matching rows out of roberta.embeddings.word_embeddings.weight
     in onnx/model_fp16.onnx by rewriting the external-data file directly
     (streaming byte copy; no protobuf round-trip of the weights),
  4. updates config.json vocab_size.

Tokenization of EU-script text is unchanged: the Unigram model can only ever
select the dropped tokens for non-EU-script input, which now falls back to
<unk> exactly like any other out-of-vocabulary byte sequence.

Usage:
  python3 tools/prune_vocab.py --source-dir <dir-with-original> --output-dir <dir>
"""

import argparse
import json
import os
import sys
import unicodedata

import numpy as np
import onnx

EMBEDDING_INITIALIZER = "roberta.embeddings.word_embeddings.weight"
EXTERNAL_DATA_FILE = "model_fp16.onnx.data"
SENTENCEPIECE_SPACE = "▁"
ALIGNMENT = 4096

# Letters (and letter-modifiers) must fall inside these ranges; every
# non-letter character (digits, punctuation, symbols, emoji, combining marks)
# is always allowed. Ranges cover Latin, Greek and Cyrillic including their
# extended blocks, so all 24 EU official languages keep full coverage.
ALLOWED_LETTER_RANGES = (
    (0x0041, 0x005A), (0x0061, 0x007A),          # Basic Latin
    (0x00C0, 0x024F),                            # Latin-1 Sup + Ext-A/B
    (0x0250, 0x02FF),                            # IPA + spacing modifiers
    (0x0370, 0x03FF), (0x1F00, 0x1FFF),          # Greek + Greek Extended
    (0x0400, 0x052F), (0x1C80, 0x1C8F),          # Cyrillic + Ext-C
    (0x2DE0, 0x2DFF), (0xA640, 0xA69F),          # Cyrillic Ext-A/B
    (0x1E00, 0x1EFF),                            # Latin Ext Additional
    (0x2C60, 0x2C7F), (0xA720, 0xA7FF),          # Latin Ext-C/D
    (0xAB30, 0xAB6F),                            # Latin Ext-E
    (0xFB00, 0xFB06),                            # Latin ligatures
    (0x1D00, 0x1DBF),                            # Phonetic extensions
)


def letter_allowed(cp):
    return any(lo <= cp <= hi for lo, hi in ALLOWED_LETTER_RANGES)


def token_is_eu_script(token):
    for ch in token:
        if ch == SENTENCEPIECE_SPACE:
            continue
        cat = unicodedata.category(ch)
        if cat.startswith("L") and not letter_allowed(ord(ch)):
            return False
    return True


def compute_keep_ids(source_dir):
    with open(os.path.join(source_dir, "tokenizer.json"), encoding="utf-8") as fh:
        tok = json.load(fh)
    assert tok["model"]["type"] == "Unigram", "expected an XLM-R Unigram tokenizer"
    vocab = tok["model"]["vocab"]
    special_contents = {a["content"] for a in tok.get("added_tokens", [])}
    keep_ids = [
        old_id
        for old_id, (piece, _) in enumerate(vocab)
        if piece in special_contents or token_is_eu_script(piece)
    ]
    return tok, vocab, keep_ids


def write_tokenizer(out, tok, vocab, keep_ids):
    kept_vocab = [vocab[i] for i in keep_ids]
    tok["model"]["vocab"] = kept_vocab
    piece_to_new = {piece: new_id for new_id, (piece, _) in enumerate(kept_vocab)}
    for added in tok.get("added_tokens", []):
        added["id"] = piece_to_new[added["content"]]
    with open(os.path.join(out, "tokenizer.json"), "w", encoding="utf-8") as fh:
        json.dump(tok, fh, ensure_ascii=False)
    return len(kept_vocab)


def external_info(init):
    info = {kv.key: kv.value for kv in init.external_data}
    return info["location"], int(info.get("offset", 0)), int(info["length"])


def set_external_offset(init, offset, length):
    for kv in init.external_data:
        if kv.key == "offset":
            kv.value = str(offset)
        elif kv.key == "length":
            kv.value = str(length)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    src, out = args.source_dir, args.output_dir
    src_onnx = os.path.join(src, "onnx", "model_fp16.onnx")
    out_onnx = os.path.join(out, "onnx", "model_fp16.onnx")
    if os.path.abspath(src_onnx) == os.path.abspath(out_onnx):
        print("error: source and output must be distinct directories", file=sys.stderr)
        return 1
    os.makedirs(os.path.join(out, "onnx"), exist_ok=True)

    tok, vocab, keep_ids = compute_keep_ids(src)
    total = len(vocab)
    kept = write_tokenizer(out, tok, vocab, keep_ids)
    print("vocab: kept %d/%d tokens (%.1f%%)" % (kept, total, 100.0 * kept / total))

    with open(os.path.join(src, "config.json"), encoding="utf-8") as fh:
        config = json.load(fh)
    config["vocab_size"] = kept
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)

    # ---- external-data surgery -------------------------------------------
    model = onnx.load(src_onnx, load_external_data=False)
    hidden = config["hidden_size"]
    row_bytes = hidden * 2  # fp16

    externals = [
        init
        for init in model.graph.initializer
        if init.data_location == onnx.TensorProto.EXTERNAL
    ]
    externals.sort(key=lambda init: external_info(init)[1])

    src_data = open(os.path.join(src, "onnx", EXTERNAL_DATA_FILE), "rb")
    out_path = os.path.join(out, "onnx", EXTERNAL_DATA_FILE)
    keep_idx = np.asarray(keep_ids, dtype=np.int64)

    with open(out_path, "wb") as dst:
        for init in externals:
            location, offset, length = external_info(init)
            assert location == EXTERNAL_DATA_FILE, "unexpected location " + location
            pad = (-dst.tell()) % ALIGNMENT
            dst.write(b"\0" * pad)
            new_offset = dst.tell()
            src_data.seek(offset)
            if init.name == EMBEDDING_INITIALIZER:
                assert length == total * row_bytes, "embedding length mismatch"
                table = np.frombuffer(src_data.read(length), dtype=np.float16)
                table = table.reshape(total, hidden)
                pruned = np.ascontiguousarray(table[keep_idx])
                dst.write(pruned.tobytes())
                init.dims[0] = kept
                set_external_offset(init, new_offset, pruned.nbytes)
                print(
                    "embedding: (%d, %d) %.0f MB -> (%d, %d) %.0f MB"
                    % (total, hidden, length / 2**20, kept, hidden, pruned.nbytes / 2**20)
                )
            else:
                remaining = length
                while remaining:
                    chunk = src_data.read(min(remaining, 64 * 2**20))
                    dst.write(chunk)
                    remaining -= len(chunk)
                set_external_offset(init, new_offset, length)
    src_data.close()

    onnx.save(model, out_onnx)

    for name in ("tokenizer_config.json",):
        src_path = os.path.join(src, name)
        if os.path.exists(src_path):
            with open(src_path, "rb") as fin, open(os.path.join(out, name), "wb") as fout:
                fout.write(fin.read())

    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
