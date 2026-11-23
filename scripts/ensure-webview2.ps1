# Used by Windows CI. Normal users can install the runtime from Microsoft's page.
$ErrorActionPreference = 'Stop'
function Find-WebViewRuntime {
    foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
        $value = (Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue).pv
        if ($value -and $value -ne '0.0.0.0') { return $value }
    }
    return $null
}
$installed = Find-WebViewRuntime
if ($installed) { Write-Host "WebView2 Runtime found: $installed"; return }
$tools = Join-Path $PSScriptRoot '..\.tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null
$installer = Join-Path (Resolve-Path -LiteralPath $tools).Path 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'The WebView2 installer does not have a valid Microsoft signature.' }
$process = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(180000)) { throw 'WebView2 installation timed out.' }
$installed = Find-WebViewRuntime
if (-not $installed) { throw "WebView2 Runtime not found after setup (exit $($process.ExitCode))." }
Write-Host "WebView2 Runtime installed: $installed"
