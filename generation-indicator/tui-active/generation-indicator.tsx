/** @jsxImportSource @opentui/solid */
/**
 * generation-indicator — one always-visible footer line naming the code this terminal actually
 * loaded, and how far origin/agents has moved past it.
 *
 * Jon merges fixes into agents but keeps a terminal launched earlier running the old generation;
 * nothing on screen said so. This line does: "Running: <subject> (<hash>)" always, plus "up to
 * date with agents" or "agents is N merges ahead · relaunch oc to load them" when the maintained
 * checkout's remote-tracking ref can be read.
 *
 * Everything shown comes from generation-status.ts, which is file-read only except for a
 * cache-gated commitsBehind. The one git spawn allowed here is sourceRepository() resolving the
 * maintained checkout exactly once at mount — never on the render path, never polled. The ahead
 * count is recomputed on a slow interval; do not lower REFRESH_MS, the ref file's mtime already
 * tells us when there is something new to count.
 */
import { Plugin } from "../../tui-legacy"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { sourceRepository } from "../../scripts/channel-prepare.mjs"
import { aheadCount, defaultCacheFile, defaultSourceRepository, formatIndicator, loadedGeneration } from "../generation-status"

/** Three minutes: slow enough that polling is free, fast enough that a merge shows up. */
const REFRESH_MS = 180000

/**
 * Theme roles, as colour strings. The host theme nests these and some roles are objects of
 * variants; handing an object to fg is how chrome goes blank, so a role is taken only when it
 * really is a string. Same guard as duration-graph.
 */
const colour = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback)
function themeColors(context: any) {
  const current = context?.theme?.current ?? context?.theme ?? {}
  return {
    muted: colour(current?.text?.muted ?? current?.textMuted, "#a5afb5"),
    warn: colour(current?.warning, "#efd06a"),
  }
}

type View = { text: string; stale: boolean }

function GenerationFooter(props: { context: any }) {
  const colors = themeColors(props.context)
  const [view, setView] = createSignal<View>()
  onMount(() => {
    const identity = loadedGeneration(process.env)
    // A plain source checkout has no release receipts: render nothing rather than guess.
    if (!identity) return
    const render = (count?: number, asOf?: number) =>
      setView({ text: formatIndicator({ subject: identity.subject, commit: identity.commit, count, asOf }), stale: (count ?? 0) > 0 })
    // What is running is always sayable, even when nothing about ahead can be known.
    render()
    let repositoryDir: string
    // Same override family as OPENCODE_QUEST_ROOT/OPENCODE_DB/OPENCODE_TELEMETRY_FILE: an isolated
    // verification drive points this at a throwaway checkout instead of the real one, without
    // touching homedir() or any other module that resolves the real registry from it.
    if (process.env.OPENCODE_SOURCE_REPOSITORY) {
      repositoryDir = process.env.OPENCODE_SOURCE_REPOSITORY
    } else {
      try {
        repositoryDir = sourceRepository()
      } catch {
        // This machine's layout differs from the maintained one. The plain default path is all we
        // can name without the canonicalizing spawn; if it is not a checkout there is nothing more
        // to say, and the line above stays at "Running: <subject>" with no ahead claim.
        repositoryDir = defaultSourceRepository()
      }
    }
    if (!existsSync(join(repositoryDir, ".git"))) return
    const refresh = () => {
      try {
        const result = aheadCount({ repositoryDir, loadedCommit: identity.commit, cacheFile: defaultCacheFile() })
        if (result) render(result.count, result.asOf)
      } catch { /* a footer reports; it never takes the host down */ }
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })
  // prompt.footer shares one row with native controls: a single short line, never wrapped.
  // A few merges behind is routine, so the tone is warn at most — never the error role.
  return (
    <Show when={view()}>
      {current => <text fg={current().stale ? colors.warn : colors.muted} wrapMode="none" truncate>{current().text}</text>}
    </Show>
  )
}

export default Plugin.define({
  id: "generation-indicator",
  setup(ctx) {
    ctx.ui.slot({ append: "prompt.footer", render: () => <GenerationFooter context={ctx} /> })
  },
})
