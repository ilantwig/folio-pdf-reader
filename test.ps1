param(
    [string]$Executable = (Join-Path $PSScriptRoot 'dist\Folio-Win32-2.0-x64\Folio.exe'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot ('test-results\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')))
)
$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test-fixtures') -Destination $OutputDirectory -Recurse -Force
$report = Join-Path $OutputDirectory 'report.json'
$process = Start-Process -FilePath $Executable -ArgumentList @('--self-test', ('"' + $report + '"')) -PassThru
if (-not $process.WaitForExit(210000)) { $process.Kill(); throw 'Native integration run exceeded 210 seconds.' }
if (-not (Test-Path -LiteralPath $report)) { throw 'No test report was produced.' }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
$failed = @($result.tests | Where-Object { -not $_.passed })
Write-Host ("{0} / {1} checks passed. Report: {2}" -f ($result.tests.Count - $failed.Count), $result.tests.Count, $report)
if (-not $result.passed) { $failed | Format-List; throw 'Native integration tests failed.' }
if ($result.tests.Count -lt 104) { throw 'The native report is incomplete; expected at least 104 integration checks.' }
