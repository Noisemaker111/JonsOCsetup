import { describe, expect, test } from "bun:test"
import { assertActivationEvidence } from "../scripts/activation-evidence.mjs"

const identity = { root: "C:/releases/dev-candidate", sourceCommit: "abc123" }
const run = {
  ok: true,
  mode: "hosted-browser",
  linkedOpenCode2: true,
  savedAfterReload: true,
  operation: "create and reopen a saved Quest",
  observations: ["The saved Quest remained visible after a public-page reload."],
}
const report = { ok: true, boundary: "quest-web", origin: "https://quest.jonsoc.com", ...identity, runs: [run, { ...run, operation: "edit, archive, and reopen the Quest" }] }

describe("development activation evidence", () => {
  test("accepts only repeated hosted Quest Web persistence through the linked server", () => {
    expect(() => assertActivationEvidence(report, identity)).not.toThrow()
    expect(() => assertActivationEvidence({ ...report, sourceCommit: "other" }, identity)).toThrow(/candidate/)
    expect(() => assertActivationEvidence({ ...report, origin: "http://localhost:8790" }, identity)).toThrow(/quest\.jonsoc\.com/)
    expect(() => assertActivationEvidence({ ...report, runs: [run] }, identity)).toThrow(/Two hosted/)
    expect(() => assertActivationEvidence({ ...report, runs: [run, { ...run, linkedOpenCode2: false }] }, identity)).toThrow(/Two hosted/)
    expect(() => assertActivationEvidence({ ...report, runs: [run, { ...run, savedAfterReload: false }] }, identity)).toThrow(/Two hosted/)
  })
})
