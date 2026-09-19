# Build the debug APK and optionally install it on a USB-connected phone.
#
#   .\scripts\build-apk.ps1              build only
#   .\scripts\build-apk.ps1 -Install     build, then adb install -r
#
# ASCII only: see the note in gradle-local.ps1.
param([switch]$Install)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "gradle-local.ps1") :app:assembleDebug
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$Apk = Join-Path $Root "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }
Write-Output "APK=$Apk"

if ($Install) {
    $adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
    $devices = (& $adb devices) -split "`r?`n" | Where-Object { $_ -match "\tdevice$" }
    if (-not $devices) { throw "No authorised device. Connect the phone by USB and allow USB debugging." }
    & $adb install -r $Apk
    if ($LASTEXITCODE -ne 0) { throw "Install failed." }
    Write-Output "Installed."
}
