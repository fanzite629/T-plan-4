$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$source=[Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'icon-orange-sprout-source.png'))
$frames=@();$sizes=@(16,32,48,64,128,256)
try {
 foreach($size in $sizes) {
  $bitmap=New-Object Drawing.Bitmap $size,$size
  $g=[Drawing.Graphics]::FromImage($bitmap)
  $g.CompositingQuality='HighQuality';$g.InterpolationMode='HighQualityBicubic';$g.SmoothingMode='HighQuality'
  $g.DrawImage($source,0,0,$size,$size)
  $ms=New-Object IO.MemoryStream
  $bitmap.Save($ms,[Drawing.Imaging.ImageFormat]::Png)
  $frames+=,($ms.ToArray())
  if($size -eq 128){[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icon-128.png'),$ms.ToArray())}
  if($size -eq 256){[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icon.png'),$ms.ToArray())}
  $ms.Dispose();$g.Dispose();$bitmap.Dispose()
 }
} finally {$source.Dispose()}
$bw=New-Object IO.BinaryWriter ([IO.File]::Create((Join-Path $PSScriptRoot 'icon.ico')))
try {
 $bw.Write([uint16]0);$bw.Write([uint16]1);$bw.Write([uint16]$sizes.Count)
 $offset=6+16*$sizes.Count
 for($i=0;$i -lt $sizes.Count;$i++){
  $d=if($sizes[$i] -eq 256){0}else{$sizes[$i]}
  $bw.Write([byte]$d);$bw.Write([byte]$d);$bw.Write([byte]0);$bw.Write([byte]0)
  $bw.Write([uint16]1);$bw.Write([uint16]32);$bw.Write([uint32]$frames[$i].Length);$bw.Write([uint32]$offset)
  $offset+=$frames[$i].Length
 }
 foreach($frame in $frames){$bw.Write([byte[]]$frame)}
} finally {$bw.Dispose()}
