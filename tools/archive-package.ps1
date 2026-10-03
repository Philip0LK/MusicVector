param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination, [switch]$Extract)
$ErrorActionPreference = "Stop"
if ($Extract) { Expand-Archive -LiteralPath $Source -DestinationPath $Destination }
else { Compress-Archive -LiteralPath $Source -DestinationPath $Destination -CompressionLevel Optimal }
