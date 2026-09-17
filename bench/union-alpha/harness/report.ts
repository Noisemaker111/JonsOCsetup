// Aggregate raw trial JSONL files into one aligned table with a delta column relative to a
// baseline model. Reads only from the evidence directory (never commits scores); prints to
// stdout. Usage: bun bench/union-alpha/harness/report.ts <evidenceDir> [baselineRouteId]
//
// Each line in <evidenceDir>/<routeId>.jsonl is one trial record:
//   { routeId, trial, taskId, passed, durationMs }
// pass@1 for a route = passed trials / total trials (repeats included, matching the harness's
// per-task repeat count). Variance is the sample standard deviation of per-trial pass rate across
// repeat blocks when the caller records a "trial index" grouping (see run.ts).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface TrialRecord {
  routeId: string;
  routeLabel: string;
  trial: number;
  taskId: string;
  passed: boolean;
  durationMs: number;
}

async function loadTrials(dir: string): Promise<TrialRecord[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const all: TrialRecord[] = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      all.push(JSON.parse(line));
    }
  }
  return all;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// A trial whose duration lands within 10s of call-model.ts's default 480s timeout is treated as
// "no response" rather than "wrong answer" — under a saturated host, pass@1 alone conflates a
// model being unavailable tonight with a model answering incorrectly, and those need different
// verdicts. See call-model.ts DEFAULT_TIMEOUT_MS.
const TIMEOUT_FLOOR_MS = Number(process.env.BENCH_TIMEOUT_FLOOR_MS ?? 470_000);

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun report.ts <evidenceDir> [baselineRouteId]");
    process.exit(1);
  }
  const trials = await loadTrials(dir);
  if (trials.length === 0) {
    console.error(`no trial records found under ${dir}`);
    process.exit(1);
  }

  const byRoute = new Map<string, TrialRecord[]>();
  for (const t of trials) {
    if (!byRoute.has(t.routeId)) byRoute.set(t.routeId, []);
    byRoute.get(t.routeId)!.push(t);
  }

  const trialIndices = [...new Set(trials.map((t) => t.trial))].sort((a, b) => a - b);
  const baselineId = process.argv[3] ?? [...byRoute.keys()][0];

  type Row = {
    routeId: string;
    label: string;
    passRate: number;
    sd: number;
    n: number;
    avgMs: number;
    respondedPct: number;
    passRateAmongResponses: number;
  };
  const rows: Row[] = [];
  for (const [routeId, recs] of byRoute) {
    const perTrialRate = trialIndices.map((idx) => {
      const forTrial = recs.filter((r) => r.trial === idx);
      if (forTrial.length === 0) return NaN;
      return forTrial.filter((r) => r.passed).length / forTrial.length;
    }).filter((x) => !Number.isNaN(x));
    const responded = recs.filter((r) => r.durationMs < TIMEOUT_FLOOR_MS);
    rows.push({
      routeId,
      label: recs[0]?.routeLabel ?? routeId,
      passRate: mean(perTrialRate) * 100,
      sd: stddev(perTrialRate) * 100,
      n: recs.length,
      avgMs: mean(recs.map((r) => r.durationMs)),
      respondedPct: (responded.length / recs.length) * 100,
      passRateAmongResponses: responded.length > 0 ? (responded.filter((r) => r.passed).length / responded.length) * 100 : NaN,
    });
  }

  rows.sort((a, b) => (a.routeId === baselineId ? -1 : b.routeId === baselineId ? 1 : b.passRate - a.passRate));
  const baseline = rows.find((r) => r.routeId === baselineId) ?? rows[0];

  const nameW = Math.max(...rows.map((r) => r.label.length), "model".length);
  const header = `${"model".padEnd(nameW)}  pass@1   ±sd    n   avg_s  resp%  pass|resp   delta vs ${baseline.label}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    const delta = r.routeId === baselineId ? "(baseline)" : `${r.passRate - baseline.passRate >= 0 ? "+" : ""}${(r.passRate - baseline.passRate).toFixed(1)}pp`;
    const passAmongResp = Number.isNaN(r.passRateAmongResponses) ? "  n/a" : `${r.passRateAmongResponses.toFixed(1).padStart(5)}%`;
    console.log(
      `${r.label.padEnd(nameW)}  ${r.passRate.toFixed(1).padStart(5)}%  ${r.sd.toFixed(1).padStart(4)}  ${String(r.n).padStart(3)}  ${(r.avgMs / 1000).toFixed(1).padStart(5)}s  ${r.respondedPct.toFixed(0).padStart(4)}%  ${passAmongResp}    ${delta}`,
    );
  }
  console.log(
    "\nresp% = trials that returned before the timeout floor; pass|resp = pass rate among only those responses (isolates answer quality from tonight's host availability).",
  );
}

main();
