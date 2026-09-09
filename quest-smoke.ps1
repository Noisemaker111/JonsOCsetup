$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bun = (Get-Command bun -ErrorAction Stop).Source
$p = [Diagnostics.Process]::new(); $p.StartInfo = [Diagnostics.ProcessStartInfo]::new(); $p.StartInfo.FileName = $bun; $p.StartInfo.WorkingDirectory = $root; $p.StartInfo.Arguments = 'test test/quest.test.ts'; $p.StartInfo.UseShellExecute = $false; $p.StartInfo.CreateNoWindow = $true; $p.StartInfo.RedirectStandardInput = $true
if (-not $p.Start()) { throw "bun failed to start" }; $p.StandardInput.Close()
if (-not $p.WaitForExit(30000)) { try { $p.Kill($true) } catch {}; throw "bounded Quest smoke timeout after 30000ms" }
if ($p.ExitCode -ne 0) { exit $p.ExitCode }; Write-Output "QUEST-SMOKE PASS"
