param(
    [string]$VendorRoot = (Join-Path $PSScriptRoot '..\desktop\vendor'),
    [switch]$Zip,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'package-4.1')
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repo = Split-Path $root -Parent
$out = [IO.Path]::GetFullPath($OutputDirectory)
$sdk = Join-Path $VendorRoot 'sdk'
$runtime = Join-Path $VendorRoot 'runtime\Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($file in @($csc, "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll", "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$sdk\runtimes\win-x64\native\WebView2Loader.dll", "$runtime\msedgewebview2.exe")) {
    if (!(Test-Path -LiteralPath $file)) { throw "缺少构建输入：$file；请阅读 desktop/vendor/PROVENANCE.md。" }
}
if ((Get-FileHash -LiteralPath "$runtime\msedgewebview2.exe" -Algorithm SHA256).Hash -ne '0F75BA7DA899408D4C4474D58358BDBEE732705FC090161CBF08E8783520572D') { throw 'WebView2 Runtime 版本或校验值不匹配。' }
New-Item -ItemType Directory -Force -Path $out,"$out\app","$out\licenses" | Out-Null
$compile = @('/nologo','/target:winexe','/platform:x64','/utf8output',"/out:$out\T计划 v4.exe", "/win32icon:$repo\v3-desktop\icon.ico", "/win32manifest:$repo\desktop\app.manifest", "/resource:$repo\v3-desktop\icon.ico,icon", "/resource:$root\qa.js,qa", "/resource:$root\qa-timetable.js,qa-timetable", '/reference:System.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Security.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll', "/reference:$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll", "/reference:$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$root\Program.cs", "$root\Database.cs", "$root\MainWindow.cs", "$root\HttpGateway.cs", "$root\TimerWindow.cs")
& $csc @compile
if ($LASTEXITCODE -ne 0) { throw '编译失败' }
Copy-Item -LiteralPath "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll","$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll","$sdk\runtimes\win-x64\native\WebView2Loader.dll" -Destination $out
Copy-Item -LiteralPath "$repo\desktop\TPlan.exe.config" -Destination "$out\T计划 v4.exe.config"
Copy-Item -LiteralPath "$repo\v4\index.html","$repo\v4\styles.css","$repo\v4\timetable.css" -Destination "$out\app"
foreach ($folder in @('js','vendor')) {
    & robocopy "$repo\v4\$folder" "$out\app\$folder" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "页面资源复制失败：$folder" }
}
Copy-Item -LiteralPath "$sdk\LICENSE.txt","$sdk\NOTICE.txt","$repo\desktop\vendor\WebView2-Fixed-Runtime-LICENSE.html","$repo\desktop\vendor\PROVENANCE.md" -Destination "$out\licenses"
Copy-Item -LiteralPath "$root\使用说明.txt" -Destination $out
& robocopy $runtime "$out\runtime" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw '运行组件复制失败' }
$manifest = Get-ChildItem -LiteralPath $out -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object FullName | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.FullName.Substring($out.Length + 1).Replace('\','/') }
[IO.File]::WriteAllLines("$out\SHA256SUMS.txt", $manifest, (New-Object Text.UTF8Encoding($false)))
if ($Zip) {
    $release = Join-Path $root 'release'
    New-Item -ItemType Directory -Force -Path $release | Out-Null
    $archive = Join-Path $release ('TPlan-v4.1.0-Windows-x64-portable-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($out, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
    Get-Item -LiteralPath $archive | Select-Object FullName,Length
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash + '  ' + (Split-Path $archive -Leaf) | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ascii
}
Write-Output "构建完成：$out"
