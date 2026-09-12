/**
 * @core-prevents a deliberate /new being navigated straight back into the existing Quest Giver, so the composer never gets the chance to create a conversation and /new appears to teleport the user back where they started
 * @core-observed Driving the real TUI on f48bc4d (2026-09-12) sent a prompt, pressed /new, and sent a second prompt: both were answered in the same conversation and session_v2 held exactly one row. quest/tui-active/quests.tsx navigated home back to the registered giver on every arrival at home.
 */
import {test, expect} from "bun:test"
import {giverHomeEntry} from "../quest/tui-navigation"

test("the registered giver opens when the host starts with nothing open, and never over a home the user asked for", () => {
  // Startup with no session: opening the one giver is the whole point.
  const startup = giverHomeEntry()
  expect(startup("home")).toBe(true)

  // Having been in a conversation, every later arrival at home is the user's own request.
  const used = giverHomeEntry()
  expect(used("session")).toBe(false)
  expect(used("home")).toBe(false)
  expect(used("home")).toBe(false)

  // The board and other plugin routes are neither, and passing through one does not arm the jump.
  const viaBoard = giverHomeEntry()
  expect(viaBoard("plugin")).toBe(false)
  expect(viaBoard("home")).toBe(true)
  expect(viaBoard("session")).toBe(false)
  expect(viaBoard("plugin")).toBe(false)
  expect(viaBoard("home")).toBe(false)

  // An undefined route is not home.
  expect(giverHomeEntry()(undefined)).toBe(false)
})
