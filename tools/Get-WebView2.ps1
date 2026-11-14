param(
    [string]$VendorRoot = (Join-Path $PSScriptRoot '..\desktop\vendor')
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$vendor = [IO.Path]::GetFullPath($VendorRoot)
$sdk = Join-Path $vendor 'sdk'
$runtimeParent = Join-Path $vendor 'runtime'
$runtime = Join-Path $runtimeParent 'Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64'
$downloads = Join-Path $vendor 'downloads'
New-Item -ItemType Directory -Path $vendor,$downloads -Force | Out-Null

function Get-VerifiedDownload([string]$Url, [string]$Path, [string]$ExpectedHash) {
    if (!(Test-Path -LiteralPath $Path)) {
        $partial = $Path + '.partial'
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $ExpectedHash) {
            throw "Downloaded file checksum mismatch: $partial"
        }
        Move-Item -LiteralPath $partial -Destination $Path
    }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $ExpectedHash) {
        throw "Cached file checksum mismatch: $Path"
    }
}

$sdkInputs = @('lib\net462\Microsoft.Web.WebView2.Core.dll','lib\net462\Microsoft.Web.WebView2.WinForms.dll','runtimes\win-x64\native\WebView2Loader.dll','LICENSE.txt','NOTICE.txt')
$sdkMissing = @($sdkInputs | Where-Object { !(Test-Path -LiteralPath (Join-Path $sdk $_)) })
if ($sdkMissing.Count -gt 0) {
    if (Test-Path -LiteralPath $sdk) { throw 'Incomplete sdk directory. Use a new VendorRoot or repair the existing directory first.' }
    $package = Join-Path $downloads 'Microsoft.Web.WebView2.1.0.4191.47.nupkg'
    Get-VerifiedDownload 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4191.47' $package 'F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($package, $sdk)
}
foreach ($relative in $sdkInputs) {
    if (!(Test-Path -LiteralPath (Join-Path $sdk $relative))) { throw "Missing SDK input: $relative" }
}
$sdkVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll')).FileVersion
if ($sdkVersion -ne '1.0.4191.47') { throw "SDK version mismatch: $sdkVersion" }

$runtimeExe = Join-Path $runtime 'msedgewebview2.exe'
if (!(Test-Path -LiteralPath $runtimeExe)) {
    if (Test-Path -LiteralPath $runtime) { throw 'Incomplete runtime directory. Use a new VendorRoot or repair the existing directory first.' }
    $cab = Join-Path $downloads 'Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64.cab'
    Get-VerifiedDownload 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/0a4a34d9-ccaa-4cef-98b4-58cb313fbfeb/Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64.cab' $cab '2DC7D817DDCE4D036F33684425C218F1CA2D073911136E5D3F8CE9B2340569B5'
    New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
    & (Join-Path $env:WINDIR 'System32\expand.exe') $cab '-F:*' $runtimeParent
    if ($LASTEXITCODE -ne 0) { throw 'Fixed Runtime extraction failed.' }
}
if (!(Test-Path -LiteralPath $runtimeExe)) { throw 'The Fixed Runtime executable is missing after extraction.' }
if ((Get-FileHash -LiteralPath $runtimeExe -Algorithm SHA256).Hash -ne '0F75BA7DA899408D4C4474D58358BDBEE732705FC090161CBF08E8783520572D') {
    throw 'Fixed Runtime executable checksum mismatch.'
}
Write-Output "WebView2 inputs ready: $vendor"
