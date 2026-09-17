/**
 * @core-prevents the generation indicator ever reporting the running code as current with agents
 * when the commit it actually loaded is not origin/agents' tip, and reports a stale count instead
 * of a fresh one when the ref has moved since the count was last computed
 * @core-observed 2026-09-17: the live dev host (PID 2684) ran PR #217 while origin/agents was nine
 * commits ahead at PR #221, and nothing on screen said so.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { git } from "../quest/cleanup-git.mjs"
import { loadedGeneration, readRemoteRefTip, aheadCount, formatIndicator } from "../generation-indicator/generation-status"

/** An origin repo and a clone holding a real refs/remotes/origin/agents, like the maintained pair. */
function sourcePair(home: string) {
  const origin = join(home, "origin"), repository = join(home, "repo")
  for (const root of [origin, repository]) {
    mkdirSync(root)
    git(root, ["init", "--initial-branch=agents"])
    git(root, ["config", "user.email", "test@example.invalid"])
    git(root, ["config", "user.name", "Test"])
  }
  writeFileSync(join(origin, "file"), "shared")
  git(origin, ["add", "file"])
  git(origin, ["commit", "-m", "shared"])
  git(repository, ["remote", "add", "origin", origin])
  git(repository, ["fetch", "origin"])
  git(repository, ["reset", "--hard", "origin/agents"])
  return { origin, repository }
}

/** The receipts a prepared launch leaves in its config root: the release, and the generation's source record. */
function releaseReceipts(home: string, commit: string, generation: string, sourceCommit = commit) {
  const root = join(home, "release")
  mkdirSync(join(root, "generations", generation), { recursive: true })
  writeFileSync(join(root, "channel-release.json"), JSON.stringify({ schema: 1, channel: "dev", commit, root, subject: "shared", ref: "agents", resolved: "origin/agents" }))
  writeFileSync(join(root, "generations", generation, ".deployment-source.json"), JSON.stringify({ commit: sourceCommit }))
  return root
}

test("the running code is named from its own receipts, or not named at all", () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "gen-indicator-")))
  try {
    const { repository } = sourcePair(home)
    const commit = git(repository, ["rev-parse", "HEAD"])
    const generation = "gen-" + commit.slice(0, 12)
    const root = releaseReceipts(home, commit, generation)
    const env = { OPENCODE_CONFIG_DIR: root, OPENCODE_RELEASE_CHANNEL: "dev", OPENCODE_PLUGIN_GENERATION: generation }
    const identity = loadedGeneration(env)
    expect(identity?.commit).toBe(commit)
    expect(identity?.subject).toBe("shared")
    expect(identity?.channel).toBe("dev")
    expect(identity?.generation).toBe(generation)

    // The generation receipt disagrees with the release: an identity the two receipts cannot back
    // up together is reported as nothing, never as a guess.
    const mismatched = releaseReceipts(join(home, "mismatch"), commit, generation, "f".repeat(40))
    expect(loadedGeneration({ ...env, OPENCODE_CONFIG_DIR: mismatched })).toBeUndefined()

    // A plain source checkout has no channel-release.json, and a missing config dir is plainer
    // still. Both are the normal "nothing to show" case, not errors.
    expect(loadedGeneration({ ...env, OPENCODE_CONFIG_DIR: join(home, "nowhere") })).toBeUndefined()
    expect(loadedGeneration({})).toBeUndefined()
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("the indicator never calls the loaded code current once agents has moved past it", () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "gen-behind-")))
  try {
    const { origin, repository } = sourcePair(home)
    const loaded = git(repository, ["rev-parse", "HEAD"])
    const cacheFile = join(home, "state", "generation-ahead-cache.json")

    // Steady state: the ref tip IS the loaded commit, and saying so costs no git spawn at all.
    const current = aheadCount({ repositoryDir: repository, loadedCommit: loaded, cacheFile })
    expect(current?.count).toBe(0)
    expect(current?.source).toBe("current")
    const steady = formatIndicator({ subject: "shared", commit: loaded, count: current?.count, asOf: current?.asOf })
    expect(steady).toContain("up to date")
    expect(steady).not.toContain("ahead")

    // agents gains a commit on the remote; the clone fetches it, moving the ref the indicator reads.
    writeFileSync(join(origin, "file"), "next")
    git(origin, ["commit", "-am", "next"])
    git(repository, ["fetch", "origin"])

    // The literal incident: the loaded commit is now behind, and the line must not say "up to date".
    const moved = aheadCount({ repositoryDir: repository, loadedCommit: loaded, cacheFile })
    expect(moved?.count).toBe(1)
    expect(moved?.source).toBe("git")
    const stale = formatIndicator({ subject: "shared", commit: loaded, count: moved?.count, asOf: moved?.asOf })
    expect(stale).toContain("1 merge ahead")
    expect(stale).not.toContain("up to date")

    // Nothing moved since: the same answer comes back from the cache, not from a second git spawn.
    const again = aheadCount({ repositoryDir: repository, loadedCommit: loaded, cacheFile })
    expect(again?.source).toBe("cache")
    expect(again?.count).toBe(moved?.count)
    expect(again?.refSha).toBe(moved?.refSha)

    // And when the count cannot be known, the line says only what is running — nothing invented.
    const unknown = formatIndicator({ subject: "shared", commit: loaded, count: undefined })
    expect(unknown).toBe("Running: shared (" + loaded.slice(0, 7) + ")")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("the ref tip is read loose or packed, with no git spawn", () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "gen-reftip-")))
  try {
    const { origin, repository } = sourcePair(home)
    const tip = git(repository, ["rev-parse", "refs/remotes/origin/agents"])
    const loose = readRemoteRefTip(repository)
    expect(loose?.sha).toBe(tip)
    expect(typeof loose?.mtimeMs).toBe("number")

    // Packed away, the same sha comes out of packed-refs.
    git(repository, ["pack-refs", "--all"])
    expect(readRemoteRefTip(repository)?.sha).toBe(tip)

    // A ref that does not exist, and a directory that is not a repository, are "cannot tell".
    expect(readRemoteRefTip(repository, "refs/remotes/origin/nope")).toBeUndefined()
    expect(readRemoteRefTip(join(home, "nowhere"))).toBeUndefined()

    // A fetch moves the tip the next read returns — the file is the observation, not a snapshot.
    writeFileSync(join(origin, "file"), "next")
    git(origin, ["commit", "-am", "next"])
    git(repository, ["fetch", "origin"])
    const moved = readRemoteRefTip(repository)
    expect(moved?.sha).toBe(git(repository, ["rev-parse", "refs/remotes/origin/agents"]))
    expect(moved?.sha).not.toBe(tip)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
