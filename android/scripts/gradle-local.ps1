# Run Gradle with the Android toolchain that is already installed on this machine.
#
# Two traps this script handles:
# 1. The project path contains non-ASCII characters (E:\AI\<chinese>\android) and AGP
#    rejects it, so the project root is first mapped to an ASCII drive letter with subst.
# 2. The toolchain (JDK 17 + Android SDK + Gradle 8.10.2, about 1.5 GB) is NOT committed.
#    It is resolved from YUEBEIDOU_TOOLING, or from a ".tooling" directory junction inside
#    this project that points at the local installation.
#
# Keep this file pure ASCII: Windows PowerShell 5.1 reads .ps1 as ANSI unless a BOM is
# present, and non-ASCII text can break the parser.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RunRoot = $Root

function Normalize-Path([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Test-ProjectDrive([string]$Drive) {
    # Get-PSDrive does not expose the target of a substitute drive on this Windows
    # version, so identify an existing mapping by a marker only this project has.
    $settings = Join-Path ($Drive + "\") "settings.gradle.kts"
    if (-not (Test-Path $settings)) { return $false }
    return (Select-String -Path $settings -Pattern 'rootProject\.name = "YueBeiDouPhone"' -Quiet) -eq $true
}

if ($Root -cmatch "[^\u0000-\u007F]") {
    $Drive = $null
    foreach ($Candidate in @("Z:", "Y:", "X:", "W:", "V:")) {
        if (Test-Path ($Candidate + "\")) {
            if (Test-ProjectDrive $Candidate) { $Drive = $Candidate; break }
            continue
        }
        & subst $Candidate $Root
        if ($LASTEXITCODE -eq 0) { $Drive = $Candidate; break }
    }
    if ($null -eq $Drive) { throw "No free drive letter (Z: Y: X: W: V: are all taken)." }
    $RunRoot = "$Drive\"
}

$Tooling = $env:YUEBEIDOU_TOOLING
if ([string]::IsNullOrWhiteSpace($Tooling)) { $Tooling = Join-Path $Root ".tooling" }
if (-not (Test-Path $Tooling)) {
    throw "Android toolchain not found at $Tooling. Set YUEBEIDOU_TOOLING, or create a '.tooling' directory junction inside this project."
}

$env:JAVA_HOME = Join-Path $Tooling "jdk-17"
$env:ANDROID_HOME = Join-Path $Tooling "android-sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE ".gradle" }
$env:PATH = @(
    (Join-Path $env:JAVA_HOME "bin"),
    (Join-Path $env:ANDROID_HOME "platform-tools"),
    (Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin"),
    $env:PATH
) -join ";"

$Gradle = Join-Path $Tooling "gradle-8.10.2\bin\gradle.bat"
if (-not (Test-Path $Gradle)) { throw "Gradle not found at $Gradle" }

Write-Output "JAVA_HOME=$env:JAVA_HOME"
Write-Output "ANDROID_HOME=$env:ANDROID_HOME"
Write-Output "PROJECT=$RunRoot"

Push-Location $RunRoot
try {
    & $Gradle @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
