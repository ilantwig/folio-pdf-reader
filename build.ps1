param(
    [string]$Toolchain = (Join-Path $PSScriptRoot '.tools\llvm-mingw-20261117-ucrt-x86_64\bin'),
    [string]$Destination = (Join-Path $PSScriptRoot 'dist\Folio-Win32-2.0-x64')
)
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $Toolchain 'x86_64-w64-mingw32-clang++.exe'
$resourceCompiler = Join-Path $Toolchain 'llvm-windres.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Set -Toolchain to the bin folder of LLVM-MinGW (Windows x64 UCRT).' }
New-Item -ItemType Directory -Force -Path $Destination,(Join-Path $PSScriptRoot 'build') | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
Push-Location $PSScriptRoot
try {
    & $resourceCompiler -i folio.rc -o build/folio-res.o -O coff
    if ($LASTEXITCODE -ne 0) { throw 'Resource compilation failed.' }
    & $compiler -std=c++20 -O2 -DNDEBUG -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -fms-extensions -municode -mwindows -static -s folio.cpp build/folio-res.o -o (Join-Path $Destination 'Folio.exe') -lole32 -luuid -luser32 -lgdi32 -lshell32 -lshlwapi -lcomdlg32 -lcrypt32 '-Wl,--dynamicbase' '-Wl,--nxcompat' '-Wl,--high-entropy-va'
    if ($LASTEXITCODE -ne 0) { throw 'Native C++ compilation failed.' }
    Copy-Item -LiteralPath Assets -Destination $Destination -Recurse -Force
    Copy-Item -LiteralPath vendor/WebView2Loader.dll -Destination $Destination
    Copy-Item -LiteralPath ThirdPartyLicenses -Destination $Destination -Recurse -Force
    Copy-Item -LiteralPath LICENSE.txt -Destination $Destination
    if (Test-Path -LiteralPath README.txt) { Copy-Item -LiteralPath README.txt -Destination $Destination }
    Write-Host "Native Win32 app ready: $Destination\Folio.exe"
} finally { Pop-Location }
