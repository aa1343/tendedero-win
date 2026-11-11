<#
    Builds the portable Windows folder: dist\Tendedero

    - copies src\ into dist\Tendedero\resources\app\src
    - copies the Electron runtime from node_modules\electron\dist
    - writes the two launchers (VBS = no console window, CMD = console)
    - keeps only the zh-CN / en-US locales, which is ~38 MB less to ship

    Usage:  npm install    (once)
            npm run dist
#>
param(
    # Where the Electron runtime lives. Override it if it is not the local
    # node_modules copy (useful for CI or for rebuilding from a shared cache).
    [string]$Runtime = ''
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$root = $PSScriptRoot
$dist = Join-Path $root 'dist\Tendedero'
if (-not $Runtime) { $Runtime = Join-Path $root 'node_modules\electron\dist' }
$runtime = $Runtime

if (-not (Test-Path $runtime)) {
    throw "Electron runtime not found at $runtime - run 'npm install' first."
}

Write-Host "Assembling $dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 1) Electron runtime
Copy-Item (Join-Path $runtime '*') $dist -Recurse -Force

# 2) our sources
$appDir = Join-Path $dist 'resources\app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $root 'src') $appDir -Recurse -Force
Copy-Item (Join-Path $root 'package.json') $appDir -Force

# 3) documents next to the executable
foreach ($doc in 'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE.md') {
    $from = Join-Path $root $doc
    if (Test-Path $from) { Copy-Item $from $dist -Force }
}

# 4) trim locales (Electron falls back to en-US when a locale is missing)
$locales = Join-Path $dist 'locales'
if (Test-Path $locales) {
    Get-ChildItem $locales -File | Where-Object { $_.Name -notin 'zh-CN.pak', 'en-US.pak' } | Remove-Item -Force
}

# 5) launchers
$vbs = @'
' Tendedero for Windows - launcher.
' Double-click this file: no console window, and the app is detached from
' whatever started it, so closing a terminal never takes it down.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Dim dir
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' Some hosts export this and force Electron into plain Node mode. It must be
' REMOVED: an empty value still counts as set and the app would not start.
On Error Resume Next
sh.Environment("PROCESS").Remove("ELECTRON_RUN_AS_NODE")
On Error GoTo 0
sh.Run """" & dir & "\electron.exe""", 1, False
Set sh = Nothing
Set fso = Nothing
'@
$cmd = @'
@echo off
rem Tendedero for Windows - launcher (console version).
rem Use Start Tendedero.vbs if you do not want a console window.
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0electron.exe"
'@
# WSH/CMD read these as ANSI, so write them as ASCII
[IO.File]::WriteAllText((Join-Path $dist 'Start Tendedero.vbs'), $vbs, [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $dist 'Start Tendedero.cmd'), $cmd, [Text.Encoding]::ASCII)

$size = [math]::Round(((Get-ChildItem $dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "Done: $dist  ($size MB)"
Write-Host "Run it with: $(Join-Path $dist 'Start Tendedero.vbs')"
