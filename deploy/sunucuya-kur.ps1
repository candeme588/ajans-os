# ============================================================
#  AJANS OS - Sanal sunucuya tek tikla kurulum
#  Bu dosyaya cift tikla, sorulara cevap ver.
# ============================================================
$ErrorActionPreference = 'Stop'

function Baslik($metin) {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host "  $metin" -ForegroundColor White
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host ""
}

function Hata($metin) {
    Write-Host ""
    Write-Host "  HATA: $metin" -ForegroundColor Red
    Write-Host ""
    Read-Host "Kapatmak icin Enter"
    exit 1
}

Baslik "AJANS OS - sunucuya kurulum"

$kok = $PSScriptRoot
Set-Location $kok

# --- on kontroller ---
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Hata "SSH bulunamadi. Windows Ayarlar > Uygulamalar > Istege bagli ozellikler > OpenSSH Istemcisi kur."
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    Hata "tar bulunamadi."
}

# --- bilgiler ---
Write-Host "  Sunucu bilgilerini gir." -ForegroundColor Gray
Write-Host ""
$ip   = Read-Host "  Sunucu IP adresi"
$kln  = Read-Host "  SSH kullanici adi (root / ubuntu)"
if ([string]::IsNullOrWhiteSpace($kln)) { $kln = "root" }

if ([string]::IsNullOrWhiteSpace($ip)) { Hata "IP adresi bos olamaz." }

$hedef = "$kln@$ip"

Baslik "Paket hazirlaniyor"

# --- arsiv ---
$arsiv = Join-Path $env:TEMP "ajans-os.tar.gz"
if (Test-Path $arsiv) { Remove-Item $arsiv -Force }

$dahil = @(
    'server.js', 'lib', 'public', 'agents', 'deploy', 'README.md'
)
# sirket ayarlari (Jenovin, Reklam Ajansi, notlar) da tasinsin
if (Test-Path 'data/companies') { $dahil += 'data/companies' }

Write-Host "  Dosyalar sikistiriliyor..." -ForegroundColor Gray
tar -czf $arsiv @dahil 2>$null
if (-not (Test-Path $arsiv)) { Hata "Arsiv olusturulamadi." }

$boyut = [math]::Round((Get-Item $arsiv).Length / 1KB, 0)
Write-Host "  Hazir: $boyut KB" -ForegroundColor Green

Baslik "Sunucuya gonderiliyor"
Write-Host "  SSH sifreni 2 kez soracak. Ilk: dosya kopyalama, ikinci: kurulum." -ForegroundColor Yellow
Write-Host "  (Sifre yazarken ekranda gorunmez, bu normal.)" -ForegroundColor Gray
Write-Host ""

# --- 1) dosyalari gonder ---
Write-Host "  [1/2] Dosyalar kopyalaniyor..." -ForegroundColor Cyan
scp $arsiv "${hedef}:/tmp/ajans-os.tar.gz"
if ($LASTEXITCODE -ne 0) { Hata "Dosya kopyalama basarisiz. IP / kullanici / sifre dogru mu?" }

# --- 2) kurulumu calistir ---
Write-Host ""
Write-Host "  [2/2] Kurulum baslatiliyor..." -ForegroundColor Cyan
Write-Host ""

$uzak = @'
set -e
rm -rf /tmp/ajans-kur
mkdir -p /tmp/ajans-kur
tar -xzf /tmp/ajans-os.tar.gz -C /tmp/ajans-kur
cd /tmp/ajans-kur
if [ "$(id -u)" = "0" ]; then
  bash deploy/kur.sh
else
  sudo bash deploy/kur.sh
fi
'@

$uzak = $uzak -replace "`r", ""
$uzakDosya = Join-Path $env:TEMP "ajans-uzak-komut.sh"
[System.IO.File]::WriteAllText($uzakDosya, $uzak, (New-Object System.Text.UTF8Encoding $false))

Get-Content $uzakDosya -Raw | ssh $hedef "bash -s"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Kurulum tamamlanamadi. Sunucuya baglanip logu kontrol et:" -ForegroundColor Red
    Write-Host "    ssh $hedef" -ForegroundColor Gray
    Write-Host "    sudo journalctl -u ajans-os -n 50 --no-pager" -ForegroundColor Gray
    Read-Host "Kapatmak icin Enter"
    exit 1
}

Baslik "BITTI"
Write-Host "  Panel adresi:  http://${ip}:7777" -ForegroundColor Green
Write-Host ""
Write-Host "  Sifreyi yukaridaki kurulum ciktisinda bulacaksin." -ForegroundColor Yellow
Write-Host "  Kaybettiysen sunucuda:" -ForegroundColor Gray
Write-Host "    sudo grep ADMIN_PASSWORD /etc/ajans-os.env" -ForegroundColor Gray
Write-Host ""
Read-Host "Kapatmak icin Enter"
