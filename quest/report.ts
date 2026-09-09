/**
 * Worker report protocol.
 *
 * A worker on the Claude Code / Codex / Grok harness runs inside the vendor
 * CLI with the vendor's own tools; OpenCode's `quest` tool does not exist
 * there (verified 2026-09-04: "there's no `quest` tool available in my
 * toolset"). So every worker also reports in plain text at the end of its
 * answer, and the tracker applies those lines when the completion lands:
 *
 *   STEP <id or number>: done — <what you ran and saw>
 *   STEP <id or number>: blocked — <what is needed>
 *   TESTS: <command> — passed|failed
 *
 * A native worker that also called the tool produces the same events twice;
 * the reducer treats a repeated stage state and a same-id proof as no-ops.
 */
export type StepReport = { ref: string; status: "done" | "blocked" | "working" | "pending"; evidence: string }
export type TestReport = { command: string; result: "passed" | "failed" }
export type WorkerReport = { steps: StepReport[]; tests: TestReport[] }

const STEP = /^\s*(?:[-*]\s*)?STEP\s+([^:]+?)\s*:\s*(done|blocked|working|pending)\b\s*(?:[—–:-]+|->)?\s*(.*)$/i
const TEST = /^\s*(?:[-*]\s*)?TESTS?\s*:\s*(.+?)\s*(?:[—–:-]+|->)\s*(passed|failed)\b/i

export function parseWorkerReport(text: string): WorkerReport {
  const steps: StepReport[] = []
  const tests: TestReport[] = []
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/[`*_]/g, "")
    const step = STEP.exec(line)
    if (step) { steps.push({ ref: step[1].trim(), status: step[2].toLowerCase() as StepReport["status"], evidence: step[3].trim() }); continue }
    const test = TEST.exec(line)
    if (test) tests.push({ command: test[1].trim(), result: test[2].toLowerCase() as TestReport["result"] })
  }
  return { steps, tests }
}

export function hasWorkerReport(text: string): boolean {
  const report = parseWorkerReport(text)
  return report.steps.length > 0 || report.tests.length > 0
}
