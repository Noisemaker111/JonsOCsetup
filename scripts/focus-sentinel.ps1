$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FocusProbe { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
'@
$before=[FocusProbe]::GetForegroundWindow()
$seen=[System.Collections.Generic.List[int]]::new()
$identity = (& node (Join-Path $PSScriptRoot 'host-status.mjs') | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'OpenCode2 identity could not be verified' }
$exe=$identity.executable
for($i=0;$i -lt 20;$i++){
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$exe;$psi.ArgumentList.Add('--version');$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;[void]$p.Start();$p.StandardInput.Close();$seen.Add($p.Id);[void]$p.StandardOutput.ReadToEnd();[void]$p.StandardError.ReadToEnd();if(-not $p.WaitForExit(5000)){throw 'hidden process timeout'}
}
$after=[FocusProbe]::GetForegroundWindow()
$visible=@(Get-CimInstance Win32_Process | Where-Object {$seen -contains [int]$_.ParentProcessId -and $_.Name -match '^(wt|conhost|cmd)\.exe$'})
if($visible.Count){throw "visible terminal descendants: $($visible.ProcessId -join ',')"}
if($before -ne $after){throw "foreground transition detected: $before -> $after"}
Write-Host "PASS: focus sentinel stable=$before; 20 hidden launches; no wt/cmd/conhost descendants"
