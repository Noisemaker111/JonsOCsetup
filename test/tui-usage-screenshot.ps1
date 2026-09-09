# BANNED: desktop TUI capture is forbidden.
# This harness previously launched `opencode2 --standalone` in a visible window
# and used SendKeys / PrintWindow / SetForegroundWindow on Jk's interactive
# desktop, which steals focus and crashes existing terminals. That path is
# permanently removed.
#
# If you need to prove /usage renders:
#  - Use a headless/off-desktop method (virtual framebuffer, hidden session,
#    or unit test like test/tui-usage.test.ts) — NEVER a visible wt/conhost
#    window on the interactive desktop.
#  - If a headless method is not available, FAIL closed — do not "just open a window".
#
# See AGENTS.md invariant: never spawn a visible opencode2/TUI window on the
# interactive desktop; never SendKeys / steal focus / PrintWindow.

$ErrorActionPreference = "Stop"
Write-Host "FAIL: test/tui-usage-screenshot.ps1 is disabled — desktop TUI capture (opencode2 --standalone + SendKeys/PrintWindow in a visible window) is banned. It steals focus and crashes Jk's terminals." -ForegroundColor Red
Write-Host "Use a headless/off-desktop verification or test/tui-usage.test.ts. If you cannot verify headless, FAIL — do not open a window on the interactive desktop." -ForegroundColor Yellow
Write-Host "See AGENTS.md invariant." -ForegroundColor Yellow
exit 1
