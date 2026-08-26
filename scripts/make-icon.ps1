Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root 'scripts\.icon-tmp'
$build = Join-Path $root 'build'
$resources = Join-Path $root 'resources'
New-Item -ItemType Directory -Force -Path $tmp, $build, $resources | Out-Null

$master = 1024
$bitmap = New-Object System.Drawing.Bitmap $master, $master
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

$pad = 72
$size = $master - $pad * 2
$radius = 220
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($pad, $pad, $d, $d, 180, 90)
$path.AddArc($pad + $size - $d, $pad, $d, $d, 270, 90)
$path.AddArc($pad + $size - $d, $pad + $size - $d, $d, $d, 0, 90)
$path.AddArc($pad, $pad + $size - $d, $d, $d, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 197, 24))
$g.FillPath($brush, $path)

$fontFamily = 'Microsoft YaHei UI'
try {
  $probe = New-Object System.Drawing.Font($fontFamily, 12)
  $probe.Dispose()
} catch {
  $fontFamily = 'Microsoft YaHei'
}
$font = New-Object System.Drawing.Font($fontFamily, 560, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 27, 36, 48))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF 0, 36, $master, $master
$g.DrawString([char]0x503C, $font, $ink, $rect, $sf)

$masterPng = Join-Path $tmp '1024.png'
$bitmap.Save($masterPng, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bitmap.Dispose()
$path.Dispose()
$brush.Dispose()
$font.Dispose()
$ink.Dispose()
$sf.Dispose()

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($px in $sizes) {
  $src = New-Object System.Drawing.Bitmap $masterPng
  $dst = New-Object System.Drawing.Bitmap $px, $px
  $sg = [System.Drawing.Graphics]::FromImage($dst)
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sg.Clear([System.Drawing.Color]::Transparent)
  $sg.DrawImage($src, 0, 0, $px, $px)
  $outPng = Join-Path $tmp "$px.png"
  $dst.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += $outPng
  $sg.Dispose()
  $dst.Dispose()
  $src.Dispose()
}

Copy-Item (Join-Path $tmp '256.png') (Join-Path $build 'icon.png') -Force
Copy-Item (Join-Path $tmp '256.png') (Join-Path $resources 'icon.png') -Force

$ico = Join-Path $build 'icon.ico'
& node (Join-Path $PSScriptRoot 'pack-ico.mjs') $ico @pngs
if ($LASTEXITCODE -ne 0) { throw 'pack-ico failed' }

Copy-Item $ico (Join-Path $resources 'icon.ico') -Force
Copy-Item $ico (Join-Path $build 'installerIcon.ico') -Force
Copy-Item $ico (Join-Path $build 'uninstallerIcon.ico') -Force
Remove-Item $tmp -Recurse -Force
Write-Host "Wrote build/icon.ico and resources/icon.ico"
