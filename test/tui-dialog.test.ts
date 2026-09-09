import { expect, test } from "bun:test"
import { openTuiDialog } from "../usage/tui-dialog"

test("supported beta dialog.show receives and renders the real callback", () => {
  const rendered = { type: "usage-dialog" }
  let received: (() => unknown) | undefined
  const result = openTuiDialog({ show: (render: () => unknown) => { received = render } }, () => rendered)
  expect(result).toBe(true)
  expect(received?.()).toBe(rendered)
})

test("removed dialog.replace cannot make a command report success", () => {
  let replaced = false
  const errors: string[] = []
  const result = openTuiDialog({ replace: () => { replaced = true } }, () => "usage", (error) => errors.push(error))
  expect(result).toBe(false)
  expect(errors).toEqual(["dialog.show unavailable"])
  expect(replaced).toBe(false)
})

test("dialog.show failures are bounded and reported", () => {
  const errors: string[] = []
  expect(openTuiDialog({ show: () => { throw new Error("dialog failed") } }, () => "usage", (error) => errors.push(error))).toBe(false)
  expect(errors).toEqual(["dialog failed"])
})
