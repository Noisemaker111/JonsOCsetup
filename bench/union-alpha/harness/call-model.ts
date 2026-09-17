// Headless single-turn call to a model through the OpenCode Go v2 CLI, the same CLI proven in
// bench/union-alpha/route.md. Each call gets a fresh scratch working directory with no project
// opencode.jsonc, isolated OPENCODE_CONFIG_DIR, one prompt in, stdout captured. This keeps every
// model's trial identical (same harness invocation shape) regardless of which model is scored.
//
// Only OpenCode Go (v2) is in scope: Jon decided only the v2 host matters, so the v1 Zen path this
// harness used to also score was removed here (it worked, proven in route.md's history, but scoring
// against it is out of scope now).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Route } from "./route";

const GO_EXE = "C:\\Users\\Jk101\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode2.exe";
const GO_CONFIG_DIR = process.env.BENCH_OC_GO_CFG ?? path.join(process.env.TEMP ?? ".", "oc-headless", "cfg");

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

export async function callModel(
  route: Route,
  prompt: string,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CallResult> {
  const scratchDir = await makeScratchDir(label);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  const modelArg = route.reasoningEffort ? `${route.model}#${route.reasoningEffort}` : route.model;
  const cmd = [
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
  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: GO_CONFIG_DIR,
    // Git Bash (the shell this whole toolchain runs under) sets PWD, and at least one OpenCode
    // CLI binary was observed preferring PWD over the OS-level cwd a spawner sets (root-caused on
    // the v1 binary this harness used to also drive; pinned here too since it costs nothing and
    // guards against the same class of bug if it ever applies to opencode2.exe).
    PWD: scratchDir,
    OLDPWD: scratchDir,
  } as Record<string, string>;

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
  await writeFile(path.join(scratchDir, "call-result.json"), JSON.stringify(result, null, 2));
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
