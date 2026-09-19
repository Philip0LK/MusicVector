# Install the debug APK on a USB-connected phone and collect evidence.
#
#   .\scripts\verify-device.ps1
#
# Produces:
#   qa/01-launch.png      screenshot taken a few seconds after launch
#   qa/crash.txt          FATAL EXCEPTION lines from logcat (empty file = none)
#   qa/logcat.txt         full logcat dump
#
# ASCII only: see the note in gradle-local.ps1.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

# Same toolchain resolution as gradle-local.ps1 (this script may run on its own).
$Tooling = $env:YUEBEIDOU_TOOLING
if ([string]::IsNullOrWhiteSpace($Tooling)) { $Tooling = Join-Path $Root ".tooling" }
if (-not (Test-Path $Tooling)) {
    throw "Android toolchain not found at $Tooling. Set YUEBEIDOU_TOOLING, or create a '.tooling' directory junction inside this project."
}
$Adb = Join-Path $Tooling "android-sdk\platform-tools\adb.exe"
if (-not (Test-Path $Adb)) { throw "adb not found at $Adb" }

$Apk = Join-Path $Root "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk (run scripts\build-apk.ps1 first)" }

$Qa = Join-Path $Root "qa"
New-Item -ItemType Directory -Force -Path $Qa | Out-Null

$devices = (& $Adb devices) -split "`r?`n" | Where-Object { $_ -match "\tdevice$" }
if (-not $devices) {
    throw "No authorised device. Connect the phone by USB, then allow USB debugging on the phone."
}
Write-Output "device: $($devices -join ', ')"

& $Adb install -r $Apk
if ($LASTEXITCODE -ne 0) { throw "Install failed." }

& $Adb logcat -c
& $Adb shell am start -n com.yuebeidou.player/.MainActivity | Out-Null
Start-Sleep -Seconds 5

# screencap emits raw PNG bytes; redirect at the cmd level so PowerShell does not re-encode them.
$Png = Join-Path $Qa "01-launch.png"
cmd /c "`"$Adb`" exec-out screencap -p > `"$Png`""
Write-Output "screenshot: $Png"

$Log = Join-Path $Qa "logcat.txt"
& $Adb logcat -d -v time | Out-File -FilePath $Log -Encoding UTF8
$Fatal = Join-Path $Qa "crash.txt"
Select-String -Path $Log -Pattern "FATAL EXCEPTION" | ForEach-Object { $_.Line } | Out-File -FilePath $Fatal -Encoding UTF8
if ((Get-Item $Fatal).Length -gt 0) {
    Write-Output "FATAL EXCEPTION found, see $Fatal"
    Get-Content $Fatal | Select-Object -First 20
    exit 1
}
Write-Output "no fatal exception in logcat"
Write-Output "app log: $Log"
