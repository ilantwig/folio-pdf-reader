param(
    [string]$AppDirectory = (Join-Path $PSScriptRoot '..\dist\Folio-Win32-2.0-x64'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts')
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'check-native.ps1') -AppDirectory $AppDirectory
$AppDirectory = (Resolve-Path -LiteralPath $AppDirectory).Path
if ((Split-Path -Leaf $AppDirectory) -ne 'Folio-Win32-2.0-x64') { throw 'Use a Folio-Win32-2.0-x64 output folder for this release.' }
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $AppDirectory 'Folio.exe')).ProductVersion
if ($version -ne '2.0.0') { throw "Unexpected release version: $version" }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$archive = Join-Path $OutputDirectory 'Folio-Win32-2.0-x64.zip'
Compress-Archive -LiteralPath $AppDirectory -DestinationPath $archive -CompressionLevel Optimal -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'SHA256SUMS.txt'), "$hash  Folio-Win32-2.0-x64.zip`n", [Text.UTF8Encoding]::new($false))
Write-Host "Release ZIP ready: $archive"
Write-Host "SHA-256: $hash"
