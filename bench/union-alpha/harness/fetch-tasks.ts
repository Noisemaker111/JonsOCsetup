// One-time cache of a small LiveCodeBench code_generation_lite subset. Downloads a byte range
// (not the whole multi-hundred-MB split) from the public Hugging Face dataset, keeps the first
// --count complete JSONL records, and writes them locally so every later run is fully offline.
//
// Usage: bun bench/union-alpha/harness/fetch-tasks.ts [--count 25] [--split test6]
//
// Source verified directly against the live file on 2026-09-17:
// https://huggingface.co/datasets/livecodebench/code_generation_lite (MIT-licensed repo,
// https://github.com/LiveCodeBench/LiveCodeBench/blob/main/LICENSE).

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = Number(args.count ?? 25);
  const split = args.split ?? "test6";
  const outDir = path.join(import.meta.dir, "tasks");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "livecodebench-subset.jsonl");

  const url = `https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/${split}.jsonl`;
  // Some task records (many private test cases) run past 30 KiB JSON-encoded; oversize the range
  // generously and trim after parsing. HF redirects this URL to a CDN host, and Bun's fetch() drops
  // the Range header across that cross-origin redirect (observed directly), so this shells out to
  // curl -L, which was verified to preserve Range across the redirect.
  const rangeBytes = Math.max(48 * 1024 * 1024, count * 4 * 400 * 1024);
  console.log(`fetching ${url} (range 0-${rangeBytes - 1}) via curl -L`);
  const proc = Bun.spawn([
    "curl",
    "-sL",
    "--max-time",
    "120",
    "-r",
    `0-${rangeBytes - 1}`,
    url,
  ], { stdout: "pipe", stderr: "pipe" });
  const [text, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl failed (exit ${exitCode}): ${stderr}`);
  }
  const lines = text.split("\n");
  // Drop the last line: it may be truncated by the byte range.
  const completeLines = lines.slice(0, -1).filter((l) => l.trim().length > 0);

  // Pull a larger candidate pool than --count: decode-private-tests.py below drops any record
  // whose decoded size still exceeds --max-record-bytes (a handful of competitive-programming
  // stress tests carry multi-megabyte inputs — observed directly, one record in an initial sample
  // was 16 MB after decode), so the raw pool needs headroom for those drops.
  const candidatePool = count * 4;
  const candidates: string[] = [];
  for (const line of completeLines) {
    if (candidates.length >= candidatePool) break;
    try {
      JSON.parse(line); // validate only; keep the raw line as-is
    } catch {
      continue; // skip any line that isn't valid JSON (shouldn't happen for complete lines)
    }
    candidates.push(line);
  }

  if (candidates.length < candidatePool) {
    console.warn(`warning: only found ${candidates.length}/${candidatePool} candidate records in the fetched range; widen --count or increase the byte range`);
  }

  const rawFile = outFile + ".raw";
  await writeFile(rawFile, candidates.join("\n") + "\n");

  // Resolve private_test_cases (base64+zlib+pickle for most records) to plain JSON once, offline,
  // capped to a small number of cases and dropped if still oversize, via decode-private-tests.py
  // — see that file for why this isn't reimplemented in TypeScript.
  const decodedFile = outFile + ".decoded";
  const decodeProc = Bun.spawn(
    ["python", path.join(import.meta.dir, "decode-private-tests.py"), rawFile, "--out", decodedFile],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [decodeStderr, decodeExit] = await Promise.all([
    new Response(decodeProc.stderr).text(),
    decodeProc.exited,
  ]);
  if (decodeExit !== 0) {
    throw new Error(`decode-private-tests.py failed (exit ${decodeExit}): ${decodeStderr}`);
  }
  console.error(decodeStderr); // pass through the per-record resolve/skip summary

  const decodedText = await Bun.file(decodedFile).text();
  const decodedLines = decodedText.split("\n").filter((l) => l.trim().length > 0);
  const finalLines = decodedLines.slice(0, count);

  let stdioCount = 0;
  let functionalCount = 0;
  for (const line of finalLines) {
    const rec = JSON.parse(line);
    const meta = rec.metadata ? JSON.parse(rec.metadata) : {};
    if (rec.starter_code || meta.func_name) functionalCount++;
    else stdioCount++;
  }

  await writeFile(outFile, finalLines.join("\n") + "\n");
  await Bun.file(rawFile).delete().catch(() => {});
  await Bun.file(decodedFile).delete().catch(() => {});

  if (finalLines.length < count) {
    console.warn(`warning: only ${finalLines.length}/${count} tasks survived decode+size filtering; widen --count or the candidate pool`);
  }
  console.log(`wrote ${finalLines.length} tasks (${stdioCount} stdio, ${functionalCount} functional) to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
