Set sh = CreateObject("WScript.Shell")
home = sh.ExpandEnvironmentStrings("%USERPROFILE%")
local = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
bun = home & "\.bun\bin\bun.exe"
root = home & "\.config\opencode\cliproxyapi"
models = home & "\.config\opencode\models"
edge86 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
edge64 = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
ps = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

sh.Run """" & bun & """ """ & models & "\grok-sub-proxy.ts""", 0, False
sh.Run """" & bun & """ """ & root & "\search-shim.ts""", 0, False
sh.Run """" & ps & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\search-shim-hotkey.ps1""", 0, False

edge = edge86
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(edge) Then edge = edge64
If fso.FileExists(edge) Then
  ud = local & "\oc-search-shim"
  If Not fso.FolderExists(ud) Then fso.CreateFolder ud
  sh.Run """" & edge & """ --user-data-dir=""" & ud & """ --app=http://127.0.0.1:8320/ --window-size=780,560 --window-position=560,180", 1, False
End If
