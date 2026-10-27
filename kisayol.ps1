$ErrorActionPreference = 'Stop'

$bat = Join-Path $PSScriptRoot 'baslat.bat'
if (-not (Test-Path $bat)) { Write-Host 'baslat.bat bulunamadi'; exit 1 }

# gercek masaustu yolu (OneDrive yonlendirmesi olabilir)
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
  $desktop = Join-Path $env:USERPROFILE 'Desktop'
}

$hedef = Join-Path $desktop 'AJANS OS.lnk'

$W = New-Object -ComObject WScript.Shell
$S = $W.CreateShortcut($hedef)
$S.TargetPath = $bat
$S.WorkingDirectory = $PSScriptRoot
$S.IconLocation = 'shell32.dll,14'
$S.Description = 'Ajans OS - tek kisilik sirket paneli'
$S.WindowStyle = 7
$S.Save()

if (Test-Path $hedef) {
  Write-Host "Kisayol olusturuldu: $hedef"
} else {
  Write-Host 'Kisayol olusturulamadi'
  exit 1
}
