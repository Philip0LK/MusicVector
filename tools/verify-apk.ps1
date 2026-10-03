param([Parameter(Mandatory=$true)][string]$Apk, [Parameter(Mandatory=$true)][string]$Tooling)
$ErrorActionPreference = "Stop"
$env:JAVA_HOME = Join-Path $Tooling "jdk-17"
$BuildTools = Get-ChildItem -LiteralPath (Join-Path $Tooling "android-sdk/build-tools") -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $BuildTools) { throw "Android build-tools missing" }
$Signer = Join-Path $BuildTools.FullName "apksigner.bat"
$Aapt = Join-Path $BuildTools.FullName "aapt.exe"
$Apk = (Resolve-Path -LiteralPath $Apk).Path
$CreatedDrive = $null
if ($Apk -cmatch "[^\u0000-\u007F]") {
    foreach ($Candidate in @("Z:", "Y:", "X:", "W:", "V:", "U:")) {
        if (Test-Path ($Candidate + "\")) { continue }
        & subst $Candidate (Split-Path -Parent $Apk)
        if ($LASTEXITCODE -eq 0) { $CreatedDrive = $Candidate; break }
    }
    if (-not $CreatedDrive) { throw "No free ASCII drive for APK metadata tools" }
    $Apk = Join-Path ($CreatedDrive + "\") (Split-Path -Leaf $Apk)
}
try {
$Cert = & $Signer verify --print-certs $Apk 2>&1
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }
$Badging = & $Aapt dump badging $Apk 2>&1
if ($LASTEXITCODE -ne 0) { throw "APK metadata verification failed" }
$CertText = $Cert -join "`n"
$Metadata = $Badging -join "`n"
if ($CertText -notmatch 'certificate SHA-256 digest: ([a-fA-F0-9:]+)') { throw "APK certificate SHA-256 missing" }
$Fingerprint = $Matches[1].Replace(":", "").ToLowerInvariant()
if ($Metadata -notmatch "package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'") { throw "APK version missing" }
[pscustomobject]@{fingerprint=$Fingerprint; applicationId=$Matches[1]; versionCode=[int]$Matches[2]; versionName=$Matches[3]} | ConvertTo-Json -Compress
} finally {
    if ($CreatedDrive) { & subst $CreatedDrive /d }
}
