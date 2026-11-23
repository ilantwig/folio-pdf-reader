# Used by Windows CI. Normal users can install the runtime from Microsoft's page.
$ErrorActionPreference = 'Stop'
function Find-WebViewRuntime {
    $versions = @()
    foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
        $value = (Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue).pv
        if ($value -and $value -ne '0.0.0.0') { $versions += [version]$value }
    }
    if ($versions.Count) { return ($versions | Sort-Object -Descending | Select-Object -First 1).ToString() }
    return $null
}
$installed = Find-WebViewRuntime
if ($installed -and ([version]$installed).Major -ge 145) { Write-Host "Compatible WebView2 Runtime found: $installed"; return }
if ($installed) { Write-Host "Updating WebView2 Runtime $installed; PDF.js requires version 145 or newer." }
$tools = Join-Path $PSScriptRoot '..\.tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null
$installer = Join-Path (Resolve-Path -LiteralPath $tools).Path 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124701' -OutFile $installer
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'The WebView2 installer does not have a valid Microsoft signature.' }
$process = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(180000)) { throw 'WebView2 installation timed out.' }
$installed = Find-WebViewRuntime
if (-not $installed -or ([version]$installed).Major -lt 145) { throw "Compatible WebView2 Runtime not found after setup (exit $($process.ExitCode), detected '$installed')." }
Write-Host "WebView2 Runtime installed: $installed"
