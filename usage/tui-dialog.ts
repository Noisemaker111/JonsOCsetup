export function openTuiDialog(dialog: any, render: () => unknown, onError?: (error: string) => void): boolean {
  if (typeof dialog?.show !== "function") {
    onError?.("dialog.show unavailable")
    return false
  }
  try {
    dialog.show(render)
    return true
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error))
    return false
  }
}
