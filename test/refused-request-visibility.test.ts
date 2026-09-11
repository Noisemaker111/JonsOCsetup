/**
 * @core-prevents a prompt disappearing without a word when the host binds a session to a model the launch never asked for, and the access guard then refuses the request inside the turn: the hook throws, the drain dies, and the user is left with an unanswered prompt, no error and no telemetry
 * @core-observed On 2026-09-11 the activated dev release was driven on opencode-go/deepseek-v4.1-flash#high against a model catalog cached before that model shipped. The session bound openrouter/deepseek/deepseek-v4.1-flash, the access policy refused it, and the drive sat 247.8s after the prompt for 0 tokens and $0 with no requests.jsonl written and nothing on screen; the host log alone carried "Failed to drain Session". A launch asking for opencode-go/zzz-not-a-real-model landed on the same substitute, so it is the composer's fallback rather than a same-name twin.
 */
import { test, expect } from "bun:test"
import { installAccessGuard, announcer, requestedAgentRoute, refusalNotice, substitutedProvider } from "../models/access-policy"

const launch = JSON.stringify({ agents: { "quest-giver": { model: "opencode-go/deepseek-v4.1-flash#high" } } })

test("a refused request and a substituted model both reach the conversation, not just the log", async () => {
  const hooks: Record<string, Function> = {}
  const posted: { sessionID: string; text: string; resume?: boolean }[] = []
  const session = {
    hook: async (name: string, callback: Function) => { hooks[name] = callback },
    synthetic: async (input: any) => { posted.push(input) },
  }
  const restore = process.env.OPENCODE_CONFIG_CONTENT
  process.env.OPENCODE_CONFIG_CONTENT = launch
  try {
    await installAccessGuard({ session })

    // The substitution is reported before anything is sent, so the user learns which model is
    // actually about to answer even when the substitute is one the policy would have allowed.
    hooks.context({ sessionID: "ses_giver", agent: "quest-giver", model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash" } })
    await Bun.sleep(5)
    expect(posted).toHaveLength(1)
    expect(posted[0].sessionID).toBe("ses_giver")
    expect(posted[0].text).toContain("openrouter/deepseek/deepseek-v4.1-flash")
    expect(posted[0].text).toContain("opencode-go/deepseek-v4.1-flash")
    // Resuming would re-enter the turn that is failing; the notice is a message, not a retry.
    expect(posted[0].resume).toBe(false)

    // The refusal still blocks the request -- the fix is that the user is told, never that the
    // forbidden route is allowed through.
    const refused = () => hooks["http.request"]({
      sessionID: "ses_giver", agent: "quest-giver",
      model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
      request: new Request("https://openrouter.ai/api/v1/chat/completions"),
    })
    expect(refused).toThrow("User access policy does not allow openrouter/deepseek/deepseek-v4.1-flash")
    await Bun.sleep(5)
    expect(posted).toHaveLength(2)
    expect(posted[1].text).toContain("Nothing was sent")

    // A turn the policy permits says nothing at all: a notice on every request is a notice nobody reads.
    hooks.context({ sessionID: "ses_ok", agent: "quest-giver", model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" } })
    hooks["http.request"]({
      sessionID: "ses_ok", agent: "quest-giver",
      model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" },
      request: new Request("https://opencode.ai/zen/go/v1/chat/completions"),
    })
    await Bun.sleep(5)
    expect(posted).toHaveLength(2)

    // The host draws a session's title and summary models from the session's own provider, so a
    // same-provider difference is that, not the catalog handing back another provider's model.
    expect(substitutedProvider("opencode-go/deepseek-v4.1-flash#high", "opencode-go/gpt-5.6-luna")).toBe(false)
    expect(substitutedProvider("opencode-go/deepseek-v4.1-flash#high", "openrouter/deepseek/deepseek-v4.1-flash")).toBe(true)
    expect(requestedAgentRoute("quest-giver", launch)).toBe("opencode-go/deepseek-v4.1-flash#high")
    expect(requestedAgentRoute("worker", launch)).toBeUndefined()
  } finally {
    if (restore === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
    else process.env.OPENCODE_CONFIG_CONTENT = restore
  }
})

test("a notice that cannot be delivered while the turn unwinds is retried, not dropped", async () => {
  const delivered: string[] = []
  let attempts = 0
  const announce = announcer({
    synthetic: async (input: any) => {
      attempts++
      if (attempts < 3) throw new Error("session is busy")
      delivered.push(input.text)
    },
  }, [0, 1, 1, 1])
  announce("ses_busy", "Nothing was sent to the model.")
  announce("ses_busy", "Nothing was sent to the model.")
  await Bun.sleep(30)
  expect(attempts).toBe(3)
  expect(delivered).toEqual(["Nothing was sent to the model."])
  // A session with no id has nowhere to post; silence there must not be mistaken for delivery.
  expect(refusalNotice({ model: { providerID: "openrouter", id: "x" }, reason: "refused" })).toContain("bound to openrouter/x")
})
