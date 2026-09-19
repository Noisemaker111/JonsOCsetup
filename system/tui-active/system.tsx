/** @jsxImportSource @opentui/solid */
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { extensionInventoryText } from "../../scripts/extension-inventory.mjs"
import { activeSessionID, requestManagedRestart } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"

const CONFIG = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")

function runHostScript(context: any, args: string[], title: string, message: string) {
  try {
    const script = join(CONFIG, "scripts", "restart-opencode.ps1")
    const child = spawn("pwsh", ["-NoProfile", "-File", script, ...args], { windowsHide: true, stdio: "ignore", detached: true })
    child.unref?.()
    context.ui.toast?.show?.({ title, message, variant: "info" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    context.ui.toast?.show?.({ title, message: `Failed: ${message}`, variant: "error" })
  }
}

function runRestart(context: any) {
  const sessionID = activeSessionID(context)
  if (requestManagedRestart(sessionID)) {
    context.ui.toast?.show?.({ title: "Restarting", message: "Reloading the selected release and resuming this session.", variant: "info" })
    return
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  const command = "node " + quote(join(import.meta.dir, "../../scripts/opencode-runtime.mjs")) + " --no-deploy --cwd " + quote(process.cwd()) + (sessionID ? " --session " + quote(sessionID) : "")
  context.ui.dialog.alert({ title: "Restart this terminal safely", message: "Close only this OpenCode terminal, then run this command in PowerShell to reload the selected release and resume this conversation:\n\n" + command + "\n\nOther terminals can stay running." })
}

function SystemCommands(props: { context: any }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      { id: "extensions.show", title: "Installed extensions and release", group: "System", palette: true, slash: { name: "extensions" }, run: () => props.context.ui.dialog.alert({ title: "Extensions and release", message: extensionInventoryText(join(import.meta.dir, "../..")) }) },
      { id: "restart.service", title: "Reload this terminal’s selected release", group: "System", palette: true, suggested: true, slash: { name: "restart" }, run: () => runRestart(props.context) },
      { id: "update.cli", title: "Update opencode2 CLI and relaunch", group: "System", palette: true, suggested: true, slash: { name: "update" }, run: () => runHostScript(props.context, ["-Update"], "Updating", "Installing @opencode-ai/cli@latest, then relaunching opencode2.") },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "system",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <SystemCommands context={context} /> })
  },
})
