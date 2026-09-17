#!/usr/bin/env python3
"""Resolve every task record's private_test_cases to plain JSON, once, offline.

LiveCodeBench's own CodeGenerationProblem.__post_init__ resolves private_test_cases as:
    try: tests = json.loads(raw)
    except json.JSONDecodeError: tests = json.loads(pickle.loads(zlib.decompress(base64.b64decode(raw))))
(observed directly against the harness source and against real downloaded records on 2026-09-17).
This script applies exactly that and rewrites the field to the plain JSON string so every later
consumer (the TypeScript runner, in particular) is a plain json.loads/JSON.parse — no reimplementing
Python's pickle format in another language.

Reads a JSONL file, writes the same records with private_test_cases resolved, to stdout (or --out).
"""
import argparse
import base64
import json
import pickle
import sys
import zlib


def resolve(raw: str, max_cases: int) -> str:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        decoded = pickle.loads(zlib.decompress(base64.b64decode(raw)))
        # decoded is itself a JSON string per the reference implementation.
        value = json.loads(decoded) if isinstance(decoded, str) else decoded
    # Competitive-programming stress tests can carry multi-megabyte inputs (observed directly: one
    # record in a 25-task sample was 16 MB after decode). Keep the first max_cases cases only, so
    # the cached subset stays small and git-friendly while still using real hidden tests instead of
    # the 3-4 public examples alone.
    if isinstance(value, list) and len(value) > max_cases:
        value = value[:max_cases]
    return json.dumps(value)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("--out", default=None)
    ap.add_argument("--max-cases", type=int, default=12)
    ap.add_argument("--max-record-bytes", type=int, default=60_000)
    args = ap.parse_args()

    out_lines = []
    resolved = 0
    fell_back_public = 0
    skipped_oversize = 0
    with open(args.infile, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            try:
                rec["private_test_cases"] = resolve(rec["private_test_cases"], args.max_cases)
                resolved += 1
            except Exception as e:  # noqa: BLE001 - deliberately broad: any decode failure means public-only
                rec["private_test_cases"] = "[]"
                fell_back_public += 1
                print(f"warning: {rec.get('question_id')}: private test decode failed ({e}); using public only", file=sys.stderr)
            encoded = json.dumps(rec)
            if len(encoded) > args.max_record_bytes:
                skipped_oversize += 1
                print(f"skip: {rec.get('question_id')}: record {len(encoded)}B exceeds --max-record-bytes {args.max_record_bytes}B even after capping to {args.max_cases} private cases", file=sys.stderr)
                continue
            out_lines.append(encoded)

    text = "\n".join(out_lines) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    print(f"resolved {resolved} records, {fell_back_public} fell back to public-only, {skipped_oversize} skipped as oversize, {len(out_lines)} kept", file=sys.stderr)


if __name__ == "__main__":
    main()
