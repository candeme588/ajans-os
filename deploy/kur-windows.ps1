# ============================================================
#  AJANS OS - Windows Server kurulumu
#
#  Sunucuda (RDP ile baglandiktan sonra) PowerShell'i
#  YONETICI OLARAK ac ve bu dosyayi calistir:
#
#     powershell -ExecutionPolicy Bypass -File kur-windows.ps1
#
#  Ne yapar:
#   - Node.js kurar (yoksa)
#   - Dosyalari C:\ajans-os konumuna kopyalar
#   - Rastgele guclu sifre uretir
#   - Windows servisi kurar (sunucu acilinca kendiliginden baslar)
#   - 7777 portunu guvenlik duvarinda acar
# ============================================================

param(
    [string]$Hedef = "C:\ajans-os",
    [int]$Port = 7777,
    [string]$Sifre = ""        # bos birakirsan otomatik uretilir
)

$ErrorActionPreference = "Stop"

function Baslik($m) {
    Write-Host ""
    Write-Host ("=" * 55) -ForegroundColor DarkGray
    Write-Host "  $m" -ForegroundColor White
    Write-Host ("=" * 55) -ForegroundColor DarkGray
    Write-Host ""
}
function Adim($n, $m) { Write-Host "[$n] $m" -ForegroundColor Cyan }

# ---------- yonetici kontrolu ----------
$kimlik = [Security.Principal.WindowsIdentity]::GetCurrent()
$yetki = New-Object Security.Principal.WindowsPrincipal($kimlik)
if (-not $yetki.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ""
    Write-Host "  HATA: PowerShell'i YONETICI OLARAK ac." -ForegroundColor Red
    Write-Host "  (Baslat menusu > PowerShell > sag tik > Yonetici olarak calistir)" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Kapatmak icin Enter"
    exit 1
}

Baslik "AJANS OS - Windows Server kurulumu"
Write-Host "  Hedef klasor : $Hedef"
Write-Host "  Port         : $Port"
Write-Host ""

# ---------- Node.js ----------
Adim "1/7" "Node.js kontrol ediliyor..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "      Node.js yok, indiriliyor..." -ForegroundColor Gray
    $msi = Join-Path $env:TEMP "node-lts.msi"
    try {
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi" -OutFile $msi -UseBasicParsing
    } catch {
        Write-Host "      Indirme basarisiz. Elle kur: https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    Write-Host "      Kuruluyor (2-3 dk)..." -ForegroundColor Gray
    Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Start-Sleep 3
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "      Node.js kurulamadi. Sunucuyu yeniden baslatip tekrar dene." -ForegroundColor Red
        exit 1
    }
}
Write-Host "      Node: $((& node --version))" -ForegroundColor Green

# ---------- dosyalari kopyala ----------
Adim "2/7" "Dosyalar $Hedef konumuna kopyalaniyor..."

if ((Get-Location).Path -ne $Hedef) {
    New-Item -ItemType Directory -Force -Path $Hedef | Out-Null

    $haric = @('node_modules', '.git', 'uploads', 'runs', 'data')
    Get-ChildItem -Path (Get-Location) -Force | Where-Object { $haric -notcontains $_.Name } | ForEach-Object {
        Copy-Item $_.FullName -Destination $Hedef -Recurse -Force
    }
} else {
    Write-Host "      Zaten hedef klasordeyiz, kopyalama atlandi." -ForegroundColor Gray
}

foreach ($k in @('uploads', 'runs', 'data', 'data\companies')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Hedef $k) | Out-Null
}
Write-Host "      Kopyalandi." -ForegroundColor Green

# ---------- API anahtarlari ----------
Adim "3/7" "API anahtarlari ayarlaniyor..."
$provHedef = Join-Path $Hedef "data\providers.json"
$provKaynak = Join-Path $Hedef "deploy\providers.hazir.json"

if (Test-Path $provKaynak) {
    if (-not (Test-Path $provHedef)) {
        Copy-Item $provKaynak $provHedef -Force
        Write-Host "      Hazir anahtarlar yerlestirildi." -ForegroundColor Green
    } else {
        Write-Host "      providers.json zaten var, korunuyor." -ForegroundColor Gray
    }
    Remove-Item $provKaynak -Force -ErrorAction SilentlyContinue
} elseif (-not (Test-Path $provHedef)) {
    Copy-Item (Join-Path $Hedef "deploy\providers.ornek.json") $provHedef -Force
    Write-Host "      ORNEK dosya kopyalandi - anahtarlari elle girmen gerek!" -ForegroundColor Yellow
    Write-Host "      Dosya: $provHedef" -ForegroundColor Yellow
}
# sadece SYSTEM ve Administrators okuyabilsin
& icacls $provHedef /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)" 2>&1 | Out-Null

# ---------- sifre ----------
Adim "4/7" "Giris sifresi hazirlaniyor..."
$envDosya = Join-Path $Hedef ".env"
if ([string]::IsNullOrWhiteSpace($Sifre)) {
    if (Test-Path $envDosya) {
        $mevcut = Get-Content $envDosya | Where-Object { $_ -match '^ADMIN_PASSWORD=' }
        if ($mevcut) {
            $Sifre = ($mevcut -split '=', 2)[1]
            Write-Host "      Mevcut sifre korunuyor." -ForegroundColor Gray
        }
    }
    if ([string]::IsNullOrWhiteSpace($Sifre)) {
        $bytes = New-Object byte[] 18
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $Sifre = ([Convert]::ToBase64String($bytes) -replace '[/+=]', '').Substring(0, 18)
    }
}

@"
# AJANS OS ayarlari - bu dosyayi kimseyle paylasma
PORT=$Port
SUNUCU_MODU=1
ADMIN_PASSWORD=$Sifre
"@ | Set-Content -Path $envDosya -Encoding UTF8 -Force

& icacls $envDosya /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)" 2>&1 | Out-Null

# ---------- servis ----------
Adim "5/7" "Windows servisi kuruluyor..."
$servisAd = "AjansOS"
$nodeYol = (Get-Command node).Source

# eski servis varsa kaldir
$eski = Get-Service -Name $servisAd -ErrorAction SilentlyContinue
if ($eski) {
    Write-Host "      Eski servis kaldiriliyor..." -ForegroundColor Gray
    Stop-Service $servisAd -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    & sc.exe delete $servisAd 2>&1 | Out-Null
    Start-Sleep 2
}

# baslatici betik: .env okuyup node'u calistirir
$baslatici = Join-Path $Hedef "servis-baslat.cmd"
@"
@echo off
cd /d "$Hedef"
for /f "usebackq tokens=1,* delims==" %%a in ("$envDosya") do (
  if not "%%a"=="" if not "%%a:~0,1"=="#" set "%%a=%%b"
)
"$nodeYol" server.js >> "$Hedef\servis.log" 2>&1
"@ | Set-Content -Path $baslatici -Encoding ASCII -Force

# servisi olustur (NSSM olmadan, sc.exe ile)
& sc.exe create $servisAd binPath= "cmd.exe /c `"$baslatici`"" DisplayName= "Ajans OS" start= auto 2>&1 | Out-Null
& sc.exe description $servisAd "Tek kisilik sirket paneli - yapay zeka ekibi" 2>&1 | Out-Null
& sc.exe failure $servisAd reset= 86400 actions= restart/5000/restart/10000/restart/30000 2>&1 | Out-Null

Write-Host "      Servis olusturuldu." -ForegroundColor Green

# ---------- guvenlik duvari ----------
Adim "6/7" "Guvenlik duvari..."
$kural = "AjansOS-$Port"
Remove-NetFirewallRule -DisplayName $kural -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $kural -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
Write-Host "      Port $Port acildi." -ForegroundColor Green

# ---------- baslat ----------
Adim "7/7" "Servis baslatiliyor..."
Start-Service $servisAd
Start-Sleep 5

$durum = (Get-Service $servisAd).Status
Write-Host ""

if ($durum -eq "Running") {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
           Select-Object -First 1).IPAddress

    Baslik "KURULUM TAMAM"
    Write-Host "  Panel adresi : http://$ip`:$Port" -ForegroundColor Green
    Write-Host "  Yerel        : http://localhost:$Port" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  KULLANICI ADI: (sifre yok, sadece sifre)" -ForegroundColor Gray
    Write-Host "  SIFRE        : $Sifre" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Bu sifreyi kaydet! Tekrar gormek icin:" -ForegroundColor Gray
    Write-Host "    Get-Content $envDosya" -ForegroundColor Gray
    Write-Host ""

    # test
    try {
        $t = Invoke-WebRequest "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 10
        Write-Host "  Saglik kontrolu: $($t.Content)" -ForegroundColor Green
    } catch {
        Write-Host "  UYARI: Panel yanit vermiyor. Log:" -ForegroundColor Yellow
        Write-Host "    Get-Content $Hedef\servis.log -Tail 30" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "  YONETIM:" -ForegroundColor White
    Write-Host "    Get-Service AjansOS                    # durum" -ForegroundColor Gray
    Write-Host "    Restart-Service AjansOS                # yeniden baslat" -ForegroundColor Gray
    Write-Host "    Stop-Service AjansOS                   # durdur" -ForegroundColor Gray
    Write-Host "    Get-Content $Hedef\servis.log -Tail 50 -Wait   # canli log" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  ONEMLI: Sunucu saglayicisinin panelinden de $Port portunu ac" -ForegroundColor Yellow
    Write-Host "  (firewall / guvenlik grubu ayari)." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "  HATA: Servis baslamadi (durum: $durum)" -ForegroundColor Red
    Write-Host "  Log:" -ForegroundColor Gray
    if (Test-Path (Join-Path $Hedef "servis.log")) {
        Get-Content (Join-Path $Hedef "servis.log") -Tail 30
    }
}

Read-Host "Kapatmak icin Enter"
