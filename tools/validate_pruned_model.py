#!/usr/bin/env python3
"""Compare a vocab-pruned (and optionally int8-embedding) BardsAI model
against the full-vocab baseline: same tokenization, same predictions.

Usage:
  python3 tools/validate_pruned_model.py --baseline-dir <dir> --pruned-dir <dir> [--pruned-onnx <file>]
"""
import argparse, json, os, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

SAMPLES = [
    # EN / DE PII (the shipped benchmark languages)
    "My name is Anna Mueller and I live at Hauptstrasse 42, 10115 Berlin.",
    "Kontaktieren Sie Dr. Hans Gruber unter der Nummer +49 30 1234567 in Muenchen.",
    "Please send the contract to Giulia Rossi, Via Roma 15, Milano, before 12.03.2025.",
    "Jean Dupont habite 24 rue de la Paix, Paris, depuis le 3 janvier 2024.",
    "El Sr. Carlos Garcia vive en Calle Mayor 8, Madrid, y su cumple es el 5 de mayo.",
    # Greek + Bulgarian (EU scripts that must survive pruning)
    "Ο Γιώργος Παπαδόπουλος μένει στην οδό Ερμού 12, Αθήνα.",
    "Иван Петров живее на улица Витоша 25, София, от 2019 година.",
]

def load(dir_, onnx_file=None):
    tok = Tokenizer.from_file(os.path.join(dir_, "tokenizer.json"))
    sess = ort.InferenceSession(
        onnx_file or os.path.join(dir_, "onnx", "model_fp16.onnx"),
        providers=["CPUExecutionProvider"],
    )
    return tok, sess

def logits(tok, sess, text):
    enc = tok.encode(text)
    ids = np.asarray([enc.ids], dtype=np.int64)
    mask = np.ones_like(ids)
    out = sess.run(None, {"input_ids": ids, "attention_mask": mask})[0]
    return enc.tokens, out[0].astype(np.float32)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--baseline-dir", required=True)
    p.add_argument("--pruned-dir", required=True)
    p.add_argument("--pruned-onnx", default=None)
    p.add_argument(
        "--min-agreement",
        type=float,
        default=1.0,
        help="Fail when per-sample argmax agreement drops below this (default 1.0: any label change fails).",
    )
    a = p.parse_args()

    tok_b, sess_b = load(a.baseline_dir)
    tok_p, sess_p = load(a.pruned_dir, a.pruned_onnx)
    id2label = json.load(open(os.path.join(a.baseline_dir, "config.json")))["id2label"]

    worst = 0.0
    fail = False
    for text in SAMPLES:
        t_b, l_b = logits(tok_b, sess_b, text)
        t_p, l_p = logits(tok_p, sess_p, text)
        if t_b != t_p:
            print("FAIL: tokenization mismatch:", text, file=sys.stderr)
            print("  base:", t_b, file=sys.stderr)
            print("  prun:", t_p, file=sys.stderr)
            fail = True
            continue
        diff = float(np.max(np.abs(l_b - l_p)))
        worst = max(worst, diff)
        am_b, am_p = l_b.argmax(-1), l_p.argmax(-1)
        agree = float((am_b == am_p).mean())
        # softmax score shift on the argmax class
        def sm(x):
            e = np.exp(x - x.max(-1, keepdims=True)); return e / e.sum(-1, keepdims=True)
        s_b = sm(l_b)[np.arange(len(am_b)), am_b]
        s_p = sm(l_p)[np.arange(len(am_p)), am_p]
        print("ok | argmax agree %.3f | max|dlogit| %.4f | max|dscore| %.4f | %s..." % (
            agree, diff, float(np.max(np.abs(s_b - s_p))), text[:40]))
        if agree < 1.0:
            ents_b = [id2label[str(i)] for i in am_b]
            ents_p = [id2label[str(i)] for i in am_p]
            for j, (x, y) in enumerate(zip(ents_b, ents_p)):
                if x != y:
                    print("   token %d %r: %s -> %s (score %.3f -> %.3f)" % (j, t_b[j], x, y, s_b[j], s_p[j]))
        if agree < a.min_agreement:
            print(
                "FAIL: argmax agreement %.3f below threshold %.3f: %s" % (agree, a.min_agreement, text),
                file=sys.stderr,
            )
            fail = True
    print("worst max|dlogit|:", worst)
    if fail:
        print("FAIL: model predictions diverged from baseline", file=sys.stderr)
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
