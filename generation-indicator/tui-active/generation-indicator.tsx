/** @jsxImportSource @opentui/solid */
/**
 * generation-indicator — one always-visible footer line naming the code this terminal actually
 * loaded, and how far origin/agents has moved past it.
 *
 * Jon merges fixes into agents but keeps a terminal launched earlier running the old generation;
 * nothing on screen said so. This line leads with the state — "Up to date with agents" or "agents
 * is N merges ahead · relaunch oc" — and only the subject that follows it is ever shortened, so the
 * part Jon actually needs to read can never be the part a narrow row cuts off.
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

/**
 * The box's own measured width in cells, not the terminal's — prompt.footer is one row shared with
 * native controls, already narrower than the screen. Same shape as quest/tui-active/quests.tsx's
 * useBoxWidth (vendored rather than imported: quest/tui-active/* is owned by quests, out of scope,
 * and currently being rewritten elsewhere). There is no laid-out width until the first frame, hence
 * the zero-delay re-measure after mount.
 */
function useBoxWidth(context: any, fallback = 120) {
  let box: { width?: number } | undefined
  const [width, setWidth] = createSignal(fallback)
  const measure = () => { const value = box?.width; if (typeof value === "number" && value > 0) setWidth(value) }
  onMount(() => {
    measure()
    const settle = setTimeout(measure, 0)
    const renderer = context?.renderer
    renderer?.on?.("resize", measure)
    onCleanup(() => { clearTimeout(settle); renderer?.off?.("resize", measure) })
  })
  return { width, ref: (node: any) => { box = node; measure() } }
}

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

type Identity = NonNullable<ReturnType<typeof loadedGeneration>>
type Ahead = { count?: number; asOf?: number }

function GenerationFooter(props: { context: any }) {
  const colors = themeColors(props.context)
  const { width, ref: measureBox } = useBoxWidth(props.context, 60)
  const [identity, setIdentity] = createSignal<Identity>()
  const [ahead, setAhead] = createSignal<Ahead>({})
  onMount(() => {
    const found = loadedGeneration(process.env)
    // A plain source checkout has no release receipts: render nothing rather than guess.
    if (!found) return
    setIdentity(found)
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
        const result = aheadCount({ repositoryDir, loadedCommit: found.commit, cacheFile: defaultCacheFile() })
        if (result) setAhead({ count: result.count, asOf: result.asOf })
      } catch { /* a footer reports; it never takes the host down */ }
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })
  // The state leads and is passed the box's own measured width, so fitTitle inside formatIndicator
  // only ever shortens the subject that follows it — the renderer's own middle-cut truncate below
  // is then a safety net for the rare frame before the first measurement lands, not the shortening
  // path itself.
  const text = () => {
    const found = identity()
    if (!found) return undefined
    const { count, asOf } = ahead()
    return formatIndicator({ subject: found.subject, commit: found.commit, count, asOf, width: width() })
  }
  // A few merges behind is routine, so the tone is warn at most — never the error role.
  const stale = () => (ahead().count ?? 0) > 0
  return (
    <box ref={measureBox} flexDirection="row" flexShrink={1} minWidth={0}>
      <Show when={text()}>
        {current => <text fg={stale() ? colors.warn : colors.muted} wrapMode="none" truncate>{current()}</text>}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "generation-indicator",
  setup(ctx) {
    ctx.ui.slot({ append: "prompt.footer", render: () => <GenerationFooter context={ctx} /> })
  },
})
