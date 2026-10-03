# Download a pinned official binary and verify its official SHA-256 before use.
$ErrorActionPreference = "Stop"
$Version = "8.30.1"
$Root = Split-Path -Parent $PSScriptRoot
$Target = Join-Path $Root "local/tooling"
New-Item -ItemType Directory -Path $Target -Force | Out-Null
$Asset = "gitleaks_${Version}_windows_x64.zip"
$Base = "https://github.com/gitleaks/gitleaks/releases/download/v${Version}"
$Zip = Join-Path $Target $Asset
Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $Zip
$Checksums = (Invoke-WebRequest -Uri "$Base/gitleaks_${Version}_checksums.txt").Content
if ($Checksums -is [byte[]]) { $Checksums = [Text.Encoding]::UTF8.GetString($Checksums) }
$Line = ($Checksums -split "`n" | Where-Object { $_ -match [regex]::Escape($Asset) })
if (@($Line).Count -ne 1) { throw "Missing unique checksum for $Asset" }
$Expected = ($Line -split '\s+')[0]
if ((Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash -ne $Expected) { throw "Gitleaks checksum mismatch" }
Expand-Archive -LiteralPath $Zip -DestinationPath $Target -Force
& (Join-Path $Target "gitleaks.exe") version
if ($LASTEXITCODE -ne 0) { throw "Gitleaks did not start" }
