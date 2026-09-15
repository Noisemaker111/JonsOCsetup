/** Guidance belongs beside the actual shell tool, independent of the model or Code Mode wrapper. */
export const windowsShellGuidance = 'Windows shell: use the shell named by this tool, its native syntax, and forward-slash paths. Inspect with rg and read only relevant spans. Run package scripts with the package directory as cwd and confirm the intended script ran. Batch independent reads; keep dependent commands sequential and check their exit status. Preserve literal text when quoting. Send verbose build/install output to an evidence log and return its summary or failure. Keep long-running commands in the host-managed session and inspect completion; do not repeatedly poll. Never delete or move a computed directory before checking its resolved target.'

export async function installShellGuidance(ctx: any) {
  if (process.platform !== 'win32') return
  const shell = (name: string) => /^(shell|bash|powershell|pwsh|terminal|exec_command)$/.test(name)
  const describe = (tool: any) => {
    if (!tool.description?.includes(windowsShellGuidance)) tool.description = windowsShellGuidance + '\n' + (tool.description ?? '')
  }
  // Discovery descriptions serve models that reach shell through Code Mode.
  await ctx.tool?.transform?.((draft: any) => {
    for (const { id } of draft.list()) if (shell(id)) draft.update(id, describe)
  })
  // Frontier providers may receive shell directly in their model-facing tool set.
  await ctx.session?.hook?.('context', (event: any) => {
    for (const [name, tool] of Object.entries(event.tools ?? {}) as [string, any][]) {
      if (shell(name)) describe(tool)
    }
  })
}
