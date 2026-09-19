const hostedOrigin = "https://quest.jonsoc.com"

/** Keep activation evidence tied to this candidate and to the hosted product boundary. */
export function assertActivationEvidence(report, { root, sourceCommit }) {
  const runs = report?.runs
  const validRun = run => run?.ok === true
    && run.mode === "hosted-browser"
    && run.linkedOpenCode2 === true
    && run.savedAfterReload === true
    && typeof run.operation === "string"
    && run.operation.trim().length > 0
    && Array.isArray(run.observations)
    && run.observations.length > 0

  if (report?.ok !== true || report.root !== root || report.sourceCommit !== sourceCommit) {
    throw new Error("Quest Web evidence does not match this candidate")
  }
  if (report.boundary !== "quest-web" || report.origin !== hostedOrigin) {
    throw new Error(`Activation evidence must come from ${hostedOrigin}`)
  }
  if (!Array.isArray(runs) || runs.length < 2 || runs.some(run => !validRun(run))) {
    throw new Error("Two hosted Quest Web runs through linked OpenCode2 with saved reload evidence are required")
  }
}
