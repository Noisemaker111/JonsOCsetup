// Score one route against the cached LiveCodeBench subset, N repeat trials, same task list and
// settings as every other route scored this way. Raw artifacts (prompt, full model response,
// extracted code, sandbox verdict) are written per task/trial; nothing here is ever committed —
// callers point --out at a path under .evidence/ (git-ignored).
//
// Usage: bun bench/union-alpha/harness/run.ts --route <id> --trials 3 --out <dir> [--tasks <path>] [--concurrency 3]

import path from "node:path";
import { mkdir, appendFile, writeFile, readFile } from "node:fs/promises";
import { findRoute } from "./route";
import { callModel, extractCode } from "./call-model";
import { decodeTask, type LiveCodeBenchTask } from "./decode-tests";
import { buildPrompt } from "./prompt";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function runSandbox(spec: unknown): Promise<{ passed: boolean; [k: string]: unknown }> {
  const proc = Bun.spawn(["python", path.join(import.meta.dir, "sandbox.py")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify(spec));
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    return { passed: false, reason: `sandbox exit ${exitCode}: ${stderr}` };
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return { passed: false, reason: `sandbox produced non-JSON output: ${stdout} / stderr: ${stderr}` };
  }
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routeId = args.route;
  const trials = Number(args.trials ?? 1);
  const outDir = args.out ?? ".evidence/union-alpha-bench/scores";
  const tasksPath = args.tasks ?? path.join(import.meta.dir, "tasks", "livecodebench-subset.jsonl");
  const concurrency = Number(args.concurrency ?? 3);

  if (!routeId) {
    console.error("usage: run.ts --route <id> --trials N --out <dir>");
    process.exit(1);
  }

  const route = findRoute(routeId);
  const rawTasksText = await readFile(tasksPath, "utf8");
  const tasks: LiveCodeBenchTask[] = rawTasksText
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  await mkdir(outDir, { recursive: true });
  const artifactsDir = path.join(outDir, "artifacts", routeId);
  await mkdir(artifactsDir, { recursive: true });
  const summaryPath = path.join(outDir, `${routeId}.jsonl`);

  console.log(`route=${routeId} (${route.label}) tasks=${tasks.length} trials=${trials} concurrency=${concurrency}`);

  for (let trial = 1; trial <= trials; trial++) {
    const t0 = Date.now();
    let passedCount = 0;
    await pool(tasks, concurrency, async (task) => {
      const decoded = decodeTask(task);
      const prompt = buildPrompt(task);
      const label = `lcb-${routeId}-t${trial}-${task.question_id}`;
      const call = await callModel(route, prompt, label);
      const code = extractCode(call.stdout);
      const spec = {
        test_type: "stdio",
        code,
        cases: decoded.cases,
        timeout_s: 6,
      };
      const verdict = code.length > 0 ? await runSandbox(spec) : { passed: false, reason: "no code extracted from model output" };

      const record = {
        routeId,
        routeLabel: route.label,
        trial,
        taskId: task.question_id,
        platform: task.platform,
        difficulty: task.difficulty,
        caseSource: decoded.caseSource,
        passed: Boolean(verdict.passed),
        durationMs: call.durationMs,
      };
      await appendFile(summaryPath, JSON.stringify(record) + "\n");
      await writeFile(
        path.join(artifactsDir, `t${trial}-${task.question_id}.json`),
        JSON.stringify({ prompt, stdout: call.stdout, stderr: call.stderr, exitCode: call.exitCode, code, verdict }, null, 2),
      );
      if (record.passed) passedCount++;
      process.stdout.write(record.passed ? "." : "x");
    });
    const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\ntrial ${trial}/${trials}: ${passedCount}/${tasks.length} passed in ${elapsedS}s`);
  }

  console.log(`done. raw artifacts: ${artifactsDir}, summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
