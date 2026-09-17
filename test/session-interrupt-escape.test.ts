/**
 * @core-prevents Esc needing two presses inside a five second window to stop a running turn, so a user who presses, looks at the screen and presses again never interrupts anything; and its opposite, Esc being taken from the dialog, autocomplete or shell-mode work it already does
 * @core-observed On 2026-09-16 Jon pressed Esc twice during a stalled Quest Giver turn and nothing stopped. Reproduced 2026-09-17 in a real Windows Terminal window on installed host 0.0.0-beta-19398: two presses about two seconds apart stopped the turn, two presses seven seconds apart did not and the turn was still running five seconds later. The host arms rather than interrupting (opencode2 packages/tui/src/component/prompt/index.tsx:533-545).
 */
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  INTERRUPT_COMMAND,
  interruptOffered,
  interruptsTurn,
  type PromptView,
} from "../interrupt/interrupt-keys"

const PROMPT: PromptView = { focused: true, isDestroyed: false, traits: { owner: "opencode", role: "prompt" } }

test("one Esc stops the turn the host says is running", () => {
  expect(interruptsTurn(PROMPT, true)).toBe(true)
  // No running turn: Esc belongs to whatever else wants it.
  expect(interruptsTurn(PROMPT, false)).toBe(false)
})

test("Esc keeps every other job it already has", () => {
  // The host blurs the prompt behind a dialog, while it is hidden and while it is disabled
  // (prompt/index.tsx:742-752), and its own interrupt command gives up on a blurred prompt, so a
  // press taken there would stop nothing and close nothing.
  const cases: Array<[string, PromptView | undefined]> = [
    ["blurred behind a dialog", { ...PROMPT, focused: false }],
    ["destroyed", { ...PROMPT, isDestroyed: true }],
    ["another owner", { ...PROMPT, traits: { owner: "quests", role: "prompt" } }],
    ["another role", { ...PROMPT, traits: { owner: "opencode", role: "search" } }],
    ["no traits", { focused: true, isDestroyed: false }],
    ["nothing focused", undefined],
    // capture holds "escape" exactly while the prompt's autocomplete is open (prompt/traits.ts:17-22).
    ["autocomplete open", { ...PROMPT, traits: { ...PROMPT.traits, capture: ["escape", "navigate", "submit", "tab"] } }],
    // In shell mode the host's escape leaves shell mode instead.
    ["shell mode", { ...PROMPT, traits: { ...PROMPT.traits, status: "SHELL" } }],
  ]
  for (const [name, prompt] of cases) expect(`${name}: ${interruptsTurn(prompt, true)}`).toBe(`${name}: false`)
  // The ordinary composer capture list does not contain escape, so it is not mistaken for one.
  expect(interruptsTurn({ ...PROMPT, traits: { ...PROMPT.traits, capture: ["tab"] } }, true)).toBe(true)
})

test("whether a turn is running is the host's own answer, not a second opinion", () => {
  expect(INTERRUPT_COMMAND).toBe("session.interrupt")
  expect(interruptOffered([{ id: INTERRUPT_COMMAND }])).toBe(true)
  expect(interruptOffered([{ id: INTERRUPT_COMMAND, enabled: true }])).toBe(true)
  expect(interruptOffered([{ id: INTERRUPT_COMMAND, enabled: () => true }])).toBe(true)
  expect(interruptOffered([{ id: INTERRUPT_COMMAND, enabled: false }])).toBe(false)
  expect(interruptOffered([{ id: INTERRUPT_COMMAND, enabled: () => false }])).toBe(false)
  // Not reachable at all: no turn to stop.
  expect(interruptOffered([{ id: "prompt.submit" }])).toBe(false)
  expect(interruptOffered(undefined)).toBe(false)
})

test("the press satisfies the host's arming in one go and says so on screen", () => {
  const source = readFileSync(join(import.meta.dir, "..", "interrupt/tui-active/interrupt.tsx"), "utf8")
  // Two dispatches are what makes one press enough: the host's command counts to two before it
  // calls the server. One dispatch only arms, which is the defect.
  const dispatches = source.split("ctx.keymap.dispatch(INTERRUPT_COMMAND)").length - 1
  expect(`dispatches: ${dispatches}`).toBe("dispatches: 2")
  // A saturated host answers slowly, so the press is acknowledged when it is sent.
  expect(`toast: ${source.includes("ctx.ui?.toast?.show?.(")}`).toBe("toast: true")
  // No target on the layer: a targeted plugin layer is bound to one Renderable and is dead in every
  // other route, which is the defect this repository measured on the composer the same day.
  expect(`target field: ${/^\s*target:/m.test(source)}`).toBe("target field: false")
  expect(`global: ${source.includes('mode: "global"')}`).toBe("global: true")
  // The prompt's own escape layer is registered after this plugin's slot and wins at equal
  // priority. Instrumented on 2026-09-17: the byte reached the renderer, session.interrupt was
  // reachable and enabled, and this command's run was never called until the layer outranked it.
  expect(`priority: ${/^\s*priority: 1,/m.test(source)}`).toBe("priority: true")
  // Returning false is what hands an unclaimed press back to the host's own escape bindings.
  expect(`falls through: ${source.includes("return false")}`).toBe("falls through: true")
})
