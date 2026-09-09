#!/usr/bin/env bun
/** Recorded benchmark evaluation entry point. Does not launch models or remove worktrees. */
if (!process.argv[2] || process.argv[2].startsWith("--")) {
  console.error("Usage: bun bench/runner.ts <recorded-trials.json>. Live sweeps require an explicitly budgeted runtime; the former unbudgeted launcher is retired. Existing results and worktrees are preserved.")
  process.exitCode = 2
} else {
  await import("../scripts/evaluate-benchmark")
}
