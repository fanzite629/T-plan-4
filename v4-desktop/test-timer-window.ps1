param([string]$OutputDirectory = (Join-Path $PSScriptRoot ('qa-output\timer-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a new test directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$exe = Join-Path $OutputDirectory 'TimerWindowTests.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:exe /platform:x64 /utf8output "/out:$exe" "/win32manifest:$PSScriptRoot\..\desktop\app.manifest" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "$PSScriptRoot\TimerWindow.cs" "$PSScriptRoot\TimerWindowTests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Timer tests did not compile.' }
& $exe | Tee-Object -FilePath (Join-Path $OutputDirectory 'result.txt')
if ($LASTEXITCODE -ne 0) { throw 'Timer tests failed.' }
