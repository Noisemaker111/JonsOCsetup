import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn, type ChildProcess } from "node:child_process"
import { superviseForeground } from "./foreground-supervisor"
import { appendLedger, deliverMessage, enqueueMessage, pendingMessages, readLedger, recordHeartbeat, recordLifecycle, recordNotification } from "../orchestration/orchestration-ledger"
import { preserveRecoveryManifest } from "../orchestration/context-policy"

const parentID = "ses_probe_same_session_61289d8"
const childID = "ses_probe_hung_child_61289d8"
const callID = "call_probe_hung_child_61289d8"
const messageID = "msg_probe_followup_61289d8"
const root = join(tmpdir(), "opencode-production-reliability-61289d8")
const ledger = join(root, "orchestration.jsonl")
const manifestFile = join(root, "recovery-manifest.json")

function fail(message: string): never { throw new Error(message) }

async function runProbe() {
  rmSync(root, { recursive: true, force: true })
  appendLedger({ kind: "spawn", parentID, callID, agent: "claude-code", questID: "tmd7kfg5gvk1psn78rxke9egjg", role: "integration", deliverables: ["same-session replay"] }, ledger)
  appendLedger({ kind: "bound", parentID, callID, childID, claudeSessionID: childID, runtime: "claude-code" }, ledger)
  recordLifecycle(parentID, callID, "executing", childID, ledger)
  recordHeartbeat(parentID, callID, childID, ledger)

  let exactChildPID = 0
  const result = await superviseForeground("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 60"], {
    sessionID: parentID,
    leaseMs: 80,
    timeoutMs: 350,
    spawn: ((executable, args, options) => {
      const child = spawn(executable, args, options)
      exactChildPID = child.pid ?? 0
      return child
    }) as typeof spawn,
    onBlocked: (event) => {
      enqueueMessage(parentID, messageID, "follow-up queued while the same session is blocked", ledger)
      recordLifecycle(parentID, callID, "blocked", childID, ledger)
      recordNotification(parentID, callID, childID, "stopped", `${event.state} session=${event.sessionID} exact-child=${exactChildPID}`, ledger)
    },
  })
  if (!result.timedOut || !result.blocked || result.code !== 124) fail(`unexpected supervisor result: ${JSON.stringify(result)}`)
  let childAlive = true
  try { process.kill(exactChildPID, 0) } catch { childAlive = false }
  const rows = readLedger(ledger)
  const notifications = rows.filter((row) => row.kind === "notification" && row.parentID === parentID && row.childID === childID)
  if (childAlive || notifications.length !== 1 || pendingMessages(parentID, ledger).length !== 1) fail(`durability failure: childAlive=${childAlive} notifications=${notifications.length} pending=${pendingMessages(parentID, ledger).length}`)
  const manifest = preserveRecoveryManifest({ questID: "tmd7kfg5gvk1psn78rxke9egjg", sessionID: parentID, parentSessionID: parentID, model: "openai/gpt-5.6-sol", queuedMessages: [messageID], checkpoint: { commit: "61289d8" }, blockers: ["hung child"], evidence: { ledger, notificationCount: notifications.length } })
  writeFileSync(manifestFile, JSON.stringify(manifest), "utf8")
  console.log(JSON.stringify({ phase: "blocked", parentID, childID, exactChildPID, result, queued: pendingMessages(parentID, ledger).map((row) => row.messageID), notifications: notifications.length, childAlive, manifestFile, ledger }))
}

function resumeProbe() {
  if (!existsSync(ledger) || !existsSync(manifestFile)) fail("durable probe state is missing")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  const before = pendingMessages(parentID, ledger)
  const alreadyDelivered = readLedger(ledger).filter((row) => row.kind === "message-delivered" && row.parentID === parentID && row.messageID === messageID)
  if (manifest.sessionID !== parentID || manifest.queuedMessages[0] !== messageID || (before.length !== 1 && alreadyDelivered.length !== 1)) fail(`resume state mismatch: ${JSON.stringify({ manifest, pending: before, delivered: alreadyDelivered.length })}`)
  if (before.length === 1 && (!deliverMessage(parentID, messageID, ledger) || deliverMessage(parentID, messageID, ledger))) fail("message was not acknowledged exactly once")
  const after = pendingMessages(parentID, ledger)
  const delivered = readLedger(ledger).filter((row) => row.kind === "message-delivered" && row.parentID === parentID && row.messageID === messageID)
  if (after.length !== 0 || delivered.length !== 1) fail(`delivery mismatch: pending=${after.length} delivered=${delivered.length}`)
  console.log(JSON.stringify({ phase: "resumed", sameSessionID: manifest.sessionID, queuedBeforeResume: before.length, alreadyDelivered: alreadyDelivered.length, deliveredExactlyOnce: delivered.length, pendingAfterAck: after.length, manifest }))
}

if (process.argv.includes("--resume")) resumeProbe()
else await runProbe()
