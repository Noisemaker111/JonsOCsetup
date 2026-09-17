# Bench research findings: cheap, local, open-source coding benchmark

Researched 2026-09-17. Target: score arbitrary chat-completion coding models (driven through OpenCode's CLI) on this machine — Windows, no GPU, no Docker. All evidence below was pulled live from primary sources (official GitHub/HF code and data, model cards, leaderboards); nothing was installed system-wide during research.

## 1. The pick

**LiveCodeBench (code-generation scenario, official `code_generation_lite` dataset, v6 slice)** — it is the only function-level benchmark that is at once the one 2025–2026 model cards actually report, contamination-controlled by problem release date, runnable end-to-end with nothing but a local Python sandbox at scoring time, and cheap enough that a cached 25-task subset scores in a couple of minutes on this box.

## 2. Adoption evidence (current, cited)

1. **Qwen3-Next-80B-A3B-Instruct model card (Sep 2025)** — the "Coding" section of a major 2025 model card reports LiveCodeBench and nothing else function-level (no HumanEval/MBPP/BigCodeBench):
   > `| **Coding** | | | | |` … `| LiveCodeBench v6 (25.02-25.05) | 43.2 | 29.1 | 51.8 | **56.6** |`
   >
   > (other coding rows: MultiPL-E, Aider-Polyglot)
   https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct

2. **Kimi K2 Thinking model card (Nov 2025)** — Coding Tasks table, "no tools" (plain chat) setting:
   > `| **LiveCodeBenchV6** | no tools | 83.1 | 87.0* | 64.0* | 56.1* | 74.1 |`
   >
   > (columns: K2 Thinking, GPT-5 High, Claude Sonnet 4.5 Thinking, K2 0905, DeepSeek-V3.2)
   https://huggingface.co/MoonshotAI/Kimi-K2-Thinking — and GLM-4.6's card tunes specifically for it: "For **code-related evaluation tasks** (such as LCB) it is further recommended to set: `top_p = 0.95`, `top_k = 40`" (https://huggingface.co/zai-org/GLM-4.6).

3. **llm-stats leaderboards (Sep 2026)** — comparative coverage says the field moved:
   > "The LiveCodeBench leaderboard was last updated in September 2026 and currently includes **75 evaluated models**."
   >
   > vs. HumanEval+: "Phi 4 Reasoning … currently leads the HumanEval+ leaderboard with a score of 0.929 across **10 evaluated models**." and MBPP+: "**4 models**."
   https://llm-stats.com/benchmarks/livecodebench · https://llm-stats.com/benchmarks/humaneval+ · https://llm-stats.com/benchmarks/mbpp+

4. **Price-per-token leaderboard (Artificial Analysis data, Sep 2026)**:
   > "As of September 4, 2026, the top-scoring model on LiveCodeBench is Gemini 3 Pro Preview at 91.7% … **194 models have been evaluated** on this benchmark."
   https://pricepertoken.com/leaderboards/benchmark/livecodebench

5. **Vals AI (updated 9/1/2026)** — 25 frontier models tracked; also the honest top-end caveat:
   > "With the easy split effectively solved, the hard problems now decide the leaderboard: the top models, led by Claude Fable 5 at 89.78%, sit within about two points of one another."
   >
   > and their archival note: "Since performance on this benchmark has saturated, we no longer run this benchmark on new model releases." (their own implementation; mid-field models spread ~30–90%, so it still discriminates for the mid/cheap models we benchmark)
   https://www.vals.ai/benchmarks/lcb

## 3. Official code, data, license, and a small offline subset

- **Harness (MIT License)**: https://github.com/LiveCodeBench/LiveCodeBench — paper: "LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code" (arXiv 2403.07974). Runner package `lcb_runner`; scoring needs no API calls of any kind.
- **Dataset (default = lite)**: https://huggingface.co/datasets/livecodebench/code_generation_lite — JSONL files `test.jsonl`…`test6.jsonl`, one per release (`release_v1`…`release_v6`, `release_latest` = v6, still newest as of Sep 2026; Kaggle's mirror confirms "LiveCodeBench V6 … 1055 problems … Last updated November 13, 2025"). The lite variant is the official fast config: *"This (lite) version has pruned and sampled tests while trying to ensure similar performances with the original dataset. Going forward, livecodebench will be using this lite version for code generation evaluations."*
- **License nuance**: GitHub code+LICENSE = MIT ("Copyright (c) 2024 LiveCodeBench"). The HF dataset card YAML says `license: cc`, while the dataset's own loader script declares `license="MIT License"`. Problem statements originate from LeetCode/AtCoder/Codeforces — fine for internal scoring; check before redistributing the data.
- **File sizes (measured via HF tree API)**: `test6.jsonl` = 134,303,240 B (~128 MiB, newest slice, ~175 problems, contest dates ≈ Jan–May 2025 — the window cards quote as "25.02–25.05"); `test.jsonl` (v1, 400 problems, 2023-05→2024-03) = 1.25 GB; all six files ≈ 4.48 GB.
- **Gotcha**: `load_dataset("livecodebench/code_generation_lite", version_tag=...)` downloads *all six* files (~4.5 GB) because the loader's `_URLS` lists them all, then filters by config. Lean offline path instead: direct-download only the file you need once, e.g.
  `https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl` (134 MB), then parse JSONL locally — zero network afterwards. (I verified range-downloads of this file work.)
- **Subsetting is first-class**: `--start_date/--end_date` filters on `contest_date`; version tags (`v6`, `v4_v5`, …) select release increments; `difficulty` field filters easy/medium/hard; and `lcb_runner/runner/custom_evaluator.py` scores a pre-generated JSON file of `[{"question_id": ..., "code_list": [...]}, ...]` — i.e., you can generate through OpenCode's CLI yourself and score with their evaluator (needs a POSIX-ish Python for its signal-based timeouts; see §4).
- **Recommended cached subset here**: 25–30 problems drawn from `test6.jsonl` (newest problems = strongest contamination protection), mixed difficulty, fixed order/seed; ~44 tests each (see below).

## 4. Exact task-record shape (verified against real `test6.jsonl` records + harness code)

Each JSONL line is one problem with **11 fields, all JSON strings** (from `code_generation_lite.py` features and `lcb_runner/benchmarks/code_generation.py` `CodeGenerationProblem`):

| field | example (real record) | meaning |
|---|---|---|
| `question_title` | `"9x9 Sum"` | problem title |
| `question_content` | `"Among the 81 integers that appear in the 9-by-9 multiplication table, …"` (with inline I/O examples) | full problem statement = the prompt body |
| `platform` | `"atcoder"` / `"leetcode"` / `"codeforces"` | source |
| `question_id` | `"abc387_b"` / `"3692"` | stable id (AtCoder id or LeetCode number) |
| `contest_id` | `"abc387"` | contest |
| `contest_date` | `"2025-01-04T00:00:00"` | ISO datetime — the contamination window key |
| `starter_code` | `""` (stdin) or `"class Solution:\n    def shortestMatchingSubstring(self, s: str, p: str) -> int:\n        "` | function stub for functional problems |
| `difficulty` | `"easy"` / `"medium"` / `"hard"` | |
| `public_test_cases` | `'[{"input": "1", "output": "2024", "testtype": "stdin"}, …]'` | JSON list of test dicts |
| `private_test_cases` | plain JSON **or** base64(zlib(pickle(json-str))) — starts `"eJy9…"` | hidden tests |
| `metadata` | `"{}"` (stdin) or `'{"func_name": "shortestMatchingSubstring"}'` | JSON dict; `func_name` ⇔ functional problem |

- **Test dict**: `{"input": str, "output": str, "testtype": "stdin" | "functional"}`. Measured counts in lite: **3–4 public + 40 private tests per problem** (pruned from up to thousands).
- **Decoding private tests** (exactly what `CodeGenerationProblem.__post_init__` does):
  ```python
  import json, base64, zlib, pickle
  try:
      tests = json.loads(rec["private_test_cases"])
  except json.JSONDecodeError:
      tests = json.loads(pickle.loads(zlib.decompress(base64.b64decode(rec["private_test_cases"]))))
  ```
  (Do this once offline and store plain JSON locally; don't unpickle at scoring time.)
- **Two problem variants**:
  - *stdin* (`starter_code` empty, `metadata` `{}`): model writes a whole program reading stdin/printing stdout. Test `input` = the full stdin text, `output` = expected stdout.
  - *functional* (LeetCode; `starter_code` has the stub, `metadata.func_name` set): test `input` = newline-separated JSON literals, one per argument (e.g. `'"abaacbaecebce"\n"ba*c*ce"'`), `output` = one JSON value (e.g. `'8'`). Grader instantiates `class Solution` if present, calls `func_name(*args)`, compares `==` (tuples coerced to lists).
- **Official chat prompt** (`lcb_runner/prompts/code_generation.py`, `LMStyle.OpenAIChat` — single-turn system+user, works for any chat model):
  - system: `"You are an expert Python programmer. You will be given a question (problem specification) and will generate a correct Python program that matches the specification and passes all tests."`
  - user: `### Question:\n{question_content}\n\n### Format: …` where "…" is either `"You will use the following starter code to write the solution to the problem and enclose your code within delimiters."` + fenced `starter_code`, or `"Read the inputs from stdin solve the problem and write the answer to stdout (do not directly test on the sample inputs). Enclose your code within delimiters as follows. …"` + `` ```python\n# YOUR CODE HERE\n``` ``, then `### Answer: (use the provided format with backticks)`.
  - **Answer extraction** (`extraction_utils.extract_code`): the text between the last pair of ``` fence lines (i.e., the last fenced code block); fewer than 2 fence lines ⇒ empty ⇒ fail.
- **Scoring contract** (`lcb_runner/evaluation/testing_util.py` + `compute_code_generation_metrics.py`): prepend their `import_string` (stdlib star-imports + `sys.setrecursionlimit(50000)`), exec the code once per generation in a `multiprocessing.Process`; per-test alarm timeout `--timeout` (default **6 s**); global kill at `(timeout+1) * num_tests + 5` s; `ProcessPoolExecutor` with `--num_process_evaluate` (default 12). Pass@1 = generation passes **all** public+private tests; first failing test short-circuits; stdio comparison is line-stripped exact match with `Decimal`-tolerant numeric fallback. Error codes: -2 WA, -3 TLE, -4 runtime error.
- **Windows note (important)**: the official checker uses `signal.alarm`/`signal.setitimer`/`SIGALRM` — POSIX-only, so `lcb_runner` scoring does not run natively on Windows. Either score under WSL, or (recommended) write the thin adapter: per generation, run `subprocess.run([sys.executable, "-I", "-c", import_string + code + harness], input=…, capture_output=True, timeout=…)` and kill on expiry — same semantics, fully native, stdlib-only. Their `reliability_guard()` only nulls destructive builtins and says explicitly: *"This function is NOT a security sandbox."* Treat model code as untrusted (it is contest code from your own models, but keep the subprocess isolation).

## 5. Expected runtime & cost — 20–30 task subset, once per model

- **Scoring itself (sandboxed execution): ~1–3 minutes wall-clock, $0.** 25 problems × ~44 tests ≈ 1,100 subprocess test executions; passing tests finish in ~10–100 ms; only TLE/hangs consume the 6 s cap. Absolute worst case (every test times out) is bounded by `(6+1)×44+5 ≈ 313 s` per problem ÷ 12 workers × 25 ≈ **11 minutes**. No GPU, no Docker, no network, no paid API at scoring time.
- **Generation (the only cost, model-side): ~25 calls.** ~0.7–1.5 K input + 0.3–1.5 K output tokens per problem (more for reasoning models, e.g. 2–8 K thinking tokens). Per subset run ≈ 25–75 K total tokens ⇒ roughly **$0.02–$1.00** at typical hosted pricing ($0.1–3/M in, $1–15/M out), and ~2–12 minutes wall-clock through the OpenCode CLI sequentially.
- **One-time data cost:** 134 MB (test6.jsonl direct download) — or 4.5 GB if you use `load_dataset` (pulls all six files).
- **Statistical honesty:** 25 tasks ⇒ pass@1 granularity 4 points, 95% CI ≈ ±20 points. Use the subset for cheap A/B and regression checks between models/versions, not for leaderboard-grade claims; fix the task list and seed.

## 6. Alternatives weighed (all researched today)

| Benchmark | Verdict for this machine | Key evidence |
|---|---|---|
| HumanEval / HumanEval+ (EvalPlus) | **Reject — saturated + contaminated.** Frontier cards no longer report it. | IBM (Feb 2026): "The number of problems are also few enough that code generation models can perhaps memorize them all" (https://www.ibm.com/think/topics/humaneval); Awesome Agents (Apr 2026): "every frontier model is above 90% [HumanEval+] … A 96.9 versus a 93.8 on HumanEval+ at the frontier is not a meaningful gap. A 68.4 versus a 59.7 on LiveCodeBench is." (https://awesomeagents.ai/leaderboards/code-completion-llm-leaderboard); LCB repo: "models that perform well on HumanEval do not necessarily perform well on LiveCodeBench." |
| MBPP / MBPP+ (EvalPlus) | **Reject** — 2021 entry-level tasks, same age/contamination profile; llm-stats tracks 4 models on MBPP+; Qwen3-Next and Kimi K2 Thinking cards report neither. | https://llm-stats.com/benchmarks/mbpp+ |
| **LiveCodeBench** | **Pick** (see above). | §2 |
| BigCodeBench (ICLR'25 oral; "trusted by many LLM teams", 173 models evaluated) | **Reject for here** — 1,140 tasks across **139 libraries**; the execution environment needs all those deps (official path ships a Docker eval image); heavy on Windows/no-Docker, and 2025–26 frontier cards have dropped it. | "challenges LLMs to invoke multiple function calls as tools from 139 libraries and 7 domains" (https://github.com/bigcode-project/bigcodebench); release v0.2.3: "Fix Docker image and its dependencies … E2B, Gradio, and Local code execution." |
| SWE-bench Verified / Lite | **Reject for here** — Docker mandatory, per-instance containers, and officially "resource intensive": "at least 120GB of free storage, 16GB of RAM, and 8 CPU cores" (instance-level cache "~2,000GB"); also agent/repo-patch tasks, not single-turn chat. | "SWE-bench uses Docker for reproducible evaluations" (https://github.com/SWE-bench/SWE-bench); https://www.swebench.com/SWE-bench/guides/docker_setup |
| Aider polyglot | **Reject for here** — still cited (Qwen3-Next reports Aider-Polyglot 49.8) but it's a two-attempt *edit-format* benchmark inside the aider harness: 225 Exercism exercises × 2 attempts = 450 calls, measured 44–450 s per case (GPT-5: 194 s, $29/run) ⇒ a full run is 12–28 h; needs 6 language toolchains locally; no official small subset; measures diff compliance, not single-turn generation. | "225 challenging Exercism coding exercises across C++, Go, Java, JavaScript, Python, and Rust" (https://aider.chat/docs/leaderboards/); timing/cost table: https://benchmarklist.com/benchmarks/aider |
| LiveCodeBench Pro (2026) | **Watch, don't pick yet** — harder Codeforces/ICPC/IOI successor, quarter-specific leaderboards; only a handful of frontier models on it; overkill for cheap chat-model scoring. | https://llm-stats.com/benchmarks/livecodebench-pro ("Last updated September 7, 2026", 4 models) |

## 7. Caveats

- Top-end saturation is real but asymmetric: easy split ~solved for frontier models (Vals quote in §2); medium/hard and mid-tier models still spread widely — exactly the regime we benchmark in.
- Python-only, competitive-programming distribution — it does not measure repo-level/agentic SWE; keep SWE-bench numbers from public leaderboards for that dimension.
- Contamination window: prefer problems with `contest_date` after the model under test's cutoff — that's LCB's whole design. `test6.jsonl` (through ~Apr/May 2025) is the newest public slice today; models trained in 2026 may have ingested it, so always report the window alongside the score, and re-slice when a v7 lands.
- The official `lcb_runner` targets Linux/macOS (signal-based timeouts); the Windows-native adapter in §4 is the intended path here. Nothing was installed system-wide during this research; the future adapter needs only the Python already on this machine (3.12) + stdlib. If the harness author later wants the official runner verbatim, it needs a Python 3.11 venv with `datasets`, `numpy`, `tqdm` (repo `pyproject.toml`) — note it, don't install silently.

## Verification appendix (what I ran and saw)

- Range-downloaded three chunks of `test6.jsonl` (4 MB head / 4 MB mid / 4.3 MB tail from the 134,303,240-byte file) from `huggingface.co/datasets/livecodebench/code_generation_lite` and parsed real records with local Python 3.12: confirmed the 11-field schema, both problem variants (AtCoder stdin `abc387_*`, LeetCode functional `3692`/`shortestMatchingSubstring`), 3–4 public + 40 private tests, the b64-zlib-pickle private-test encoding, and JSONL ordering by contest date. Temp chunks deleted afterwards.
- Read the harness source directly from GitHub (`benchmarks/code_generation.py`, `evaluation/testing_util.py`, `evaluation/compute_code_generation_metrics.py`, `runner/parser.py`, `runner/custom_evaluator.py`, `prompts/code_generation.py`, `utils/extraction_utils.py`) and the dataset loader script `code_generation_lite.py`; file sizes from the HF datasets tree API; license from the GitHub LICENSE blob and repo API (MIT).
