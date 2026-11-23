param([string]$AppDirectory = (Join-Path $PSScriptRoot '..\dist\Folio-Win32-2.0-x64'))
$ErrorActionPreference = 'Stop'
$AppDirectory = (Resolve-Path -LiteralPath $AppDirectory).Path
$bytes = [IO.File]::ReadAllBytes((Join-Path $AppDirectory 'Folio.exe'))
if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { throw 'Not a PE executable.' }
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
if ($pe -lt 0 -or $pe + 264 -gt $bytes.Length) { throw 'Invalid PE header bounds.' }
if ([BitConverter]::ToUInt32($bytes, $pe) -ne 0x00004550) { throw 'Invalid PE signature.' }
if ([BitConverter]::ToUInt16($bytes, $pe + 4) -ne 0x8664) { throw 'Expected an x64 executable.' }
$optional = $pe + 24
if ([BitConverter]::ToUInt16($bytes, $optional) -ne 0x20B) { throw 'Expected PE32+.' }
if ([BitConverter]::ToUInt16($bytes, $optional + 68) -ne 2) { throw 'Expected the Windows GUI subsystem.' }
if ([BitConverter]::ToUInt32($bytes, $optional + 112 + 14 * 8) -ne 0) { throw 'Unexpected CLR runtime header.' }
foreach ($path in @('WebView2Loader.dll', 'Assets\folio.js', 'Assets\folio-signatures.js', 'Assets\folio-signature-inline.js', 'Assets\pdfjs\web\viewer.html', 'Assets\pdfjs\build\pdf.worker.mjs', 'Assets\pdfjs\LICENSE', 'LICENSE.txt', 'ThirdPartyLicenses\WebView2-LICENSE.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory $path))) { throw "Missing portable bundle file: $path" }
}
if (Get-ChildItem -LiteralPath $AppDirectory -Filter '*.runtimeconfig.json') { throw 'Unexpected .NET runtime configuration.' }
Write-Host 'Native bundle verified: x64 PE32+, Windows GUI subsystem, no CLR header, required assets and licenses present.'
