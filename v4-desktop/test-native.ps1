param(
    [string]$VendorRoot = (Join-Path $PSScriptRoot '..\desktop\vendor'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot ('qa-output\native-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')))
)
$ErrorActionPreference = 'Stop'
$out = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $out) { throw 'Native tests require a new output directory.' }
$sdk = Join-Path $VendorRoot 'sdk'
$coreDll = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$formsDll = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($file in @($csc,$coreDll,$formsDll)) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing test input: $file" }
}
New-Item -ItemType Directory -Path $out | Out-Null
$exe = Join-Path $out 'NativeTests.exe'
$compile = @('/nologo','/target:exe','/platform:x64','/utf8output',"/out:$exe",'/reference:System.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Security.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll',"/reference:$coreDll","/reference:$formsDll",(Join-Path $PSScriptRoot 'Database.cs'),(Join-Path $PSScriptRoot 'HttpGateway.cs'),(Join-Path $PSScriptRoot 'NativeTests.cs'))
& $csc @compile
if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed.' }
Copy-Item -LiteralPath $coreDll,$formsDll -Destination $out
& $exe $out
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
Write-Output "Native tests passed: $out"
