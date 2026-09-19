#!/usr/bin/env python3
"""Local, offline execution sandbox for scoring one generated solution against one task.

Reads a single JSON spec on stdin, writes a single JSON result on stdout. No network access is
required or attempted. Supports two task shapes, selected by spec["test_type"]:

  "functional" (HumanEval / MBPP / EvalPlus / LiveCodeBench functional problems): the generated
    code defines a function; spec["test_code"] is appended after it and is expected to raise on
    failure (the canonical HumanEval "check(candidate)" pattern, called with entry_point).

  "stdio" (LiveCodeBench competitive-programming problems and similar): the generated code is run
    as a standalone program; spec["cases"] is a list of {"input": str, "output": str} pairs fed on
    stdin, stdout compared after trailing-whitespace-insensitive normalization.

Each case/check runs in its own subprocess with a wall-clock timeout so one hanging solution
cannot stall the run. This script has no side effects outside the temp file it writes and removes.
"""

import json
import subprocess
import sys
import tempfile
import os


def run_functional(code: str, test_code: str, entry_point: str, timeout_s: float) -> dict:
    program = f"{code}\n\n{test_code}\n\ncheck({entry_point})\n"
    return _run_program(program, stdin_text="", expected_stdout=None, timeout_s=timeout_s)


def run_stdio_cases(code: str, cases: list, timeout_s: float) -> dict:
    total = len(cases)
    passed = 0
    failures = []
    for i, case in enumerate(cases):
        result = _run_program(code, stdin_text=case.get("input", ""), expected_stdout=case.get("output"), timeout_s=timeout_s)
        if result["passed"]:
            passed += 1
        else:
            failures.append({"case": i, "reason": result.get("reason"), "stderr": result.get("stderr", "")[:2000]})
    return {"passed": passed == total and total > 0, "passed_cases": passed, "total_cases": total, "failures": failures}


def _normalize(s: str) -> str:
    return "\n".join(line.rstrip() for line in s.strip().splitlines())


def _run_program(program: str, stdin_text: str, expected_stdout, timeout_s: float) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(program)
        path = f.name
    try:
        proc = subprocess.run(
            [sys.executable, path],
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        if proc.returncode != 0:
            return {"passed": False, "reason": f"exit code {proc.returncode}", "stderr": proc.stderr}
        if expected_stdout is None:
            return {"passed": True}
        if _normalize(proc.stdout) == _normalize(expected_stdout):
            return {"passed": True}
        return {
            "passed": False,
            "reason": "stdout mismatch",
            "stderr": proc.stderr,
            "got": proc.stdout[:500],
            "want": expected_stdout[:500],
        }
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": f"timeout after {timeout_s}s"}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def main() -> None:
    spec = json.load(sys.stdin)
    timeout_s = float(spec.get("timeout_s", 6.0))
    if spec["test_type"] == "functional":
        result = run_functional(spec["code"], spec["test_code"], spec["entry_point"], timeout_s)
    elif spec["test_type"] == "stdio":
        result = run_stdio_cases(spec["code"], spec["cases"], timeout_s)
    else:
        result = {"passed": False, "reason": f"unknown test_type {spec['test_type']!r}"}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
