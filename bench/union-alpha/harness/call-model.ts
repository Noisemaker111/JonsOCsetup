// Headless single-turn call to a model through the same CLIs proven in bench/union-alpha/route.md.
// Every route is driven the same way: a scratch working directory with no project opencode.jsonc,
// isolated OPENCODE_CONFIG_DIR/XDG_CONFIG_HOME, one prompt in, stdout captured. This keeps every
// model's trial identical (same harness invocation shape) regardless of provider.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Route } from "./route";

const GO_EXE = "C:\\Users\\Jk101\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode2.exe";
// The v1 CLI's npm shim on Windows is a .cmd batch file, which Bun.spawn (like any CreateProcess
// caller) must run through cmd.exe — and cmd.exe collapses a multi-line argv element to its first
// line (verified directly: a real multi-line LiveCodeBench prompt through opencode.cmd arrived at
// the model as nothing after the first line, producing "Please provide the problem specification
// and I'll write the solution."). Invoking the real binary the shim wraps skips cmd.exe entirely,
// so Bun's array argv reaches the process with embedded newlines intact (CreateProcessW, not a
// batch re-parse). A bare "opencode" on PATH is also ambiguous on this machine (an unrelated
// WinGet install shadows the npm one), so this is pinned by absolute path either way.
const ZEN_V1_CMD = "C:\\Users\\Jk101\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe";
const GO_CONFIG_DIR = process.env.BENCH_OC_GO_CFG ?? path.join(process.env.TEMP ?? ".", "oc-headless", "cfg");
const ZEN_CONFIG_DIR = process.env.BENCH_OC_ZEN_CFG ?? path.join(process.env.TEMP ?? ".", "oc-headless", "cfg");
const ZEN_XDG_HOME = process.env.BENCH_OC_ZEN_XDG ?? path.join(process.env.TEMP ?? ".", "oc-headless", "xdgcfg");

export interface CallResult {
  route: Route;
  prompt: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  scratchDir: string;
}

async function makeScratchDir(label: string): Promise<string> {
  const dir = path.join(process.env.TEMP ?? ".", "oc-headless", "bench-scratch", label, String(Date.now()));
  await mkdir(dir, { recursive: true });
  return dir;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.BENCH_CALL_TIMEOUT_MS ?? 480_000);

// The v1 CLI (Zen route) reads PWD (set by Git Bash, the shell this whole toolchain runs under)
// as a hint for "the invoking shell's directory" and prefers it over the actual OS working
// directory Bun.spawn sets via `cwd` — root-caused directly with --print-logs --log-level DEBUG:
// the v1 binary logged "creating instance" for the correct scratch dir, then logged it again for
// this repo's worktree (PWD's value, since every call here happens to run from inside a
// worktree), re-bootstrapped against the worktree's own opencode.jsonc, and then failed "Session
// not found". Overriding PWD/OLDPWD in the child's env below fixed it end to end. Kept on one
// stable directory (matching bench/union-alpha/route.md Path 1, proven working) rather than a
// fresh directory per call, since nothing requires per-call isolation once PWD is pinned.
const ZEN_STABLE_CWD = process.env.BENCH_OC_ZEN_CWD ?? path.join(process.env.TEMP ?? ".", "oc-headless", "work");

export async function callModel(
  route: Route,
  prompt: string,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CallResult> {
  const scratchDir = route.kind === "zen-v1" ? ZEN_STABLE_CWD : await makeScratchDir(label);
  await mkdir(scratchDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  let cmd: string[];
  let env: Record<string, string>;

  if (route.kind === "go-v2") {
    const modelArg = route.reasoningEffort ? `${route.model}#${route.reasoningEffort}` : route.model;
    cmd = [
      GO_EXE,
      "run",
      "--standalone",
      "--auto",
      "--agent",
      "build",
      "-m",
      modelArg,
      "--title",
      label,
      prompt,
    ];
    env = {
      ...process.env,
      OPENCODE_CONFIG_DIR: GO_CONFIG_DIR,
      PWD: scratchDir,
      OLDPWD: scratchDir,
    } as Record<string, string>;
  } else {
    cmd = [ZEN_V1_CMD, "run", "-m", route.model, prompt];
    env = {
      ...process.env,
      OPENCODE_CONFIG_DIR: ZEN_CONFIG_DIR,
      XDG_CONFIG_HOME: ZEN_XDG_HOME,
      PWD: scratchDir,
      OLDPWD: scratchDir,
    } as Record<string, string>;
  }

  const proc = Bun.spawn(cmd, {
    cwd: scratchDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The host this runs on is sometimes saturated (documented elsewhere in this repo: health
  // checks measured 13-40s under load) and a CLI call can hang past any reasonable trial budget.
  // Bound every call so one stuck model never blocks an entire scoring run; a timeout is recorded
  // as a failed trial with reason "timeout", not silently dropped.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  const endedAt = new Date().toISOString();
  const durationMs = performance.now() - t0;

  const result: CallResult = {
    route,
    prompt,
    stdout,
    stderr: timedOut ? `${stderr}\n[bench] killed after ${timeoutMs}ms timeout` : stderr,
    exitCode: timedOut ? -1 : exitCode,
    startedAt,
    endedAt,
    durationMs,
    scratchDir,
  };
  // Use a label-qualified filename: for zen-v1 the scratchDir is shared/reused across calls (see
  // above), so a fixed "call-result.json" name would overwrite between calls.
  await writeFile(path.join(scratchDir, `call-result-${label}.json`), JSON.stringify(result, null, 2));
  return result;
}

// Extract code the same way LiveCodeBench's own generic-style extractor does (observed directly,
// lcb_runner/utils/extraction_utils.py): split on lines containing a ``` fence and take everything
// between the LAST pair of fence lines, not the first — models often reason in earlier fenced
// snippets before the final answer block. Falls back to the trimmed raw text when no fence pair
// is found (matches the harness's own behavior of returning "" only in the stricter path; a raw
// fallback here scores conservatively rather than silently failing every unfenced answer).
export function extractCode(text: string): string {
  const lines = text.split("\n");
  const fenceLines = lines
    .map((line, i) => (line.includes("```") ? i : -1))
    .filter((i) => i !== -1);
  if (fenceLines.length >= 2) {
    const start = fenceLines[fenceLines.length - 2];
    const end = fenceLines[fenceLines.length - 1];
    return lines.slice(start + 1, end).join("\n").trim();
  }
  return text.trim();
}
