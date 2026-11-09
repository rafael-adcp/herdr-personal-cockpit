# Copies the mod and the layout into the Herdr home, then switches to it.
#
# A copy, not a junction or a symlink. Linking looks better -- the app
# hot-reloads as you edit -- and the JavaScript really does load through it,
# so the panels come up and nothing reports an error. But every
# svg("mods/personal-cockpit/...") then resolves to a path outside the Herdr
# home and silently draws nothing: the refresh, gear, dock and minimise buttons
# all vanish from the headers. Verified by A/B on 0.1.13.
#
#   -NoSwitch   install without changing the shown layout
#   -NoLayout   install the mod only, leaving layouts/cockpit.json alone

[CmdletBinding()]
param([switch]$NoSwitch, [switch]$NoLayout)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# HERDR_APP_HOME first, exactly as install.sh reads it and as the app itself
# does: it is how the sandbox installs into a throwaway home, and how either
# installer gets tested without touching the one being used.
$herdr = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
$name = 'personal-cockpit'

if (-not (Test-Path $herdr)) { throw "No Herdr home at $herdr -- start the app once first." }

$src = Join-Path $root "mods\$name"
$dst = Join-Path $herdr "mods\$name"

# A previous link install has to go before a copy can land. rmdir drops the
# junction itself; Remove-Item -Recurse would follow it into the repo and
# delete the source.
if (Test-Path $dst) {
  if ((Get-Item $dst).LinkType) { cmd /c rmdir "$dst" | Out-Null }
}

# /MIR so a file deleted here is deleted there; the two the app writes into the
# mod folder are left alone, since they belong to the installed version.
# routines.yml, team.yml and jira.config.json join them because they are the
# person's own, edited in place so that a new routine or a new teammate never
# means reinstalling. An /XF file is excluded from the operation, so /MIR does
# not delete it either.
robocopy $src $dst /MIR /XF gpui-kit.d.ts jsconfig.json routines.yml team.yml jira.config.json /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
Write-Host "mod      -> $dst"

# Seeded from the example only when it is not there yet, so an install never
# overwrites what somebody wrote. The gear in those panels does the same thing
# for a file deleted later.
foreach ($conf in @('routines', 'team')) {
  $file = Join-Path $dst "$conf.yml"
  $example = Join-Path $dst "$conf.example.yml"
  if ((-not (Test-Path $file)) -and (Test-Path $example)) {
    Copy-Item $example $file
    Write-Host "config   -> $file (from the example)"
  }
}

if (-not $NoLayout) {
  # The .json and the .svg its "preview" field points at; the Settings picker
  # draws a blank frame without the second one.
  foreach ($ext in @('json', 'svg')) {
    $from = Join-Path $root "layouts\cockpit.$ext"
    if (Test-Path $from) {
      Copy-Item $from (Join-Path $herdr "layouts\cockpit.$ext") -Force
      Write-Host "layout   -> $herdr\layouts\cockpit.$ext"
    }
  }
}

$app = Get-Command herdr-app -ErrorAction SilentlyContinue
if (-not $app) {
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
  if (Test-Path $guess) { $app = $guess }
}
if (-not $app) { Write-Host "herdr-app not found; switch the layout yourself."; return }
$appPath = if ($app -is [string]) { $app } else { $app.Source }

# Start-Process -Wait, not the call operator: herdr-app is a GUI-subsystem
# binary, so PowerShell starts it and carries straight on without waiting and
# without setting $LASTEXITCODE. That made this check decorative -- a mod that
# failed it still got the layout switched to it, and the only sign was a line of
# output arriving some time later. -PassThru is the only way to read its code.
#
# The arguments are quoted by hand because -ArgumentList does not quote one
# holding a space, and a Herdr home under "C:\Users\First Last\" is exactly
# that: the path reached herdr-app split in two, and it refused the second half.
function Quoted([string[]]$parts) {
  ($parts | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
}

$check = Start-Process -FilePath $appPath -ArgumentList (Quoted @('check', $dst)) -NoNewWindow -Wait -PassThru
if ($check.ExitCode -ne 0) {
  throw "herdr-app check failed on $dst (exit $($check.ExitCode)). The mod is installed; the layout was not switched."
}
Write-Host "check    -> passed"

if (-not $NoSwitch) {
  Start-Process -FilePath $appPath -ArgumentList (Quoted @('do', 'layout.switch', '--name', 'cockpit')) -NoNewWindow -Wait | Out-Null
  Write-Host "layout   -> switched to cockpit"
}
