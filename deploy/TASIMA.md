# Sanal Sunucuya Taşıma

Bu klasör, paneli kendi sunucunda 7/24 çalıştırmak için gerekli her şeyi içerir.

---

## Hangi işletim sistemi?

| Sunucun | Sayfa |
|---|---|
| **Windows Server** (2016 / 2019 / 2022 / 2025) | [Windows kurulumu](#windows-server-kurulumu) — aşağıda |
| Ubuntu / Debian | [Linux kurulumu](#linux-kurulumu-tek-komut) — aşağıda |

---

## Windows Server kurulumu

Sunucun **Windows Server** ise (RDP ile bağlandığın makine) bu yolu izle.

### 1) Dosyaları sunucuya taşı

Yerel bilgisayarında **PowerShell** aç:

```powershell
cd "C:\Users\esesl\OneDrive\Masaüstü\ajans-os"
tar -czf "$env:TEMP\ajans-os.tar.gz" server.js lib public agents deploy data/companies README.md package.json
```

Sunucuya kopyala (RDP üzerinden dosya kopyalayabilirsin, ya da):

```powershell
# sunucuda OpenSSH kuruluysa
scp "$env:TEMP\ajans-os.tar.gz" administrator@SUNUCU_IP:C:/Users/administrator/Desktop/
```

> SSH kapalıysa: RDP ile bağlan, dosyayı sürükle-bırak ile masaüstüne at. Windows Server'da RDP üzerinden dosya kopyalamak çalışır.

### 2) Sunucuda aç

Masaüstündeki arşivi bir klasöre çıkar:

```powershell
cd $env:USERPROFILE\Desktop
mkdir ajans-kur -Force
tar -xzf ajans-os.tar.gz -C ajans-kur
cd ajans-kur
```

### 3) Kurulumu çalıştır

PowerShell'i **yönetici olarak** aç (Başlat → PowerShell → sağ tık → Yönetici olarak çalıştır), sonra:

```powershell
cd $env:USERPROFILE\Desktop\ajans-kur
powershell -ExecutionPolicy Bypass -File deploy\kur-windows.ps1
```

Betik şunları yapar:

- Node.js kurar (yoksa, otomatik indirir)
- Dosyaları `C:\ajans-os` konumuna kopyalar
- API anahtarlarını `data\providers.json` içine yerleştirir
- **Rastgele güçlü şifre üretir ve ekrana yazar**
- `AjansOS` adında **Windows servisi** kurar → sunucu yeniden başlasa bile kendiliğinden kalkar
- Çöktüğünde otomatik yeniden başlatma (5sn / 10sn / 30sn)
- Windows güvenlik duvarında 7777 portunu açar

### 4) Sunucu sağlayıcısında portu aç

Bu adım **atlanmamalı**. Windows güvenlik duvarı açık olsa bile, barındırma sağlayıcısının kendi güvenlik duvarı (firewall / security group) portu kapatıyor olabilir.

Sağlayıcının kontrol paneline gir, **7777 TCP** portuna gelen izin ekle.

### 5) Aç

Tarayıcıda:

```
http://SUNUCU_IP:7777
```

Şifre: kurulumda ekrana yazılan değer. Kaybettiysen sunucuda:

```powershell
Get-Content C:\ajans-os\.env
```

### Yönetim komutları (Windows)

| Ne | Komut |
|---|---|
| Durum | `Get-Service AjansOS` |
| Yeniden başlat | `Restart-Service AjansOS` |
| Durdur | `Stop-Service AjansOS` |
| Başlat | `Start-Service AjansOS` |
| Canlı log | `Get-Content C:\ajans-os\servis.log -Tail 50 -Wait` |
| Şifre gör | `Get-Content C:\ajans-os\.env` |
| Otomatik başlatmayı kapat | `Set-Service AjansOS -StartupType Manual` |

### Güncelleme (Windows)

Yerel bilgisayarında değişiklik yaptıysan dosyaları sunucuya kopyala, sonra:

```powershell
Copy-Item "C:\yeni\server.js" "C:\ajans-os\server.js" -Force
Copy-Item "C:\yeni\lib\*" "C:\ajans-os\lib\" -Recurse -Force
Restart-Service AjansOS
```

> `C:\ajans-os\data` klasörünün üzerine **yazma** — şirket ayarların orada.

### Windows'ta sorun giderme

**Servis başlamıyor**
```powershell
Get-Service AjansOS | Format-List *
Get-Content C:\ajans-os\servis.log -Tail 40
```

**Panel açılmıyor**
```powershell
Test-NetConnection -ComputerName localhost -Port 7777
Get-NetFirewallRule -DisplayName "AjansOS-7777"
```
Firewall kuralı yoksa: `New-NetFirewallRule -DisplayName "AjansOS-7777" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow`

**Dışarıdan açılmıyor, içeriden açılıyor** → sağlayıcının güvenlik duvarında port kapalı. Kontrol panelinden aç.

**Node.js bulunamıyor (servis çalışmıyor)**
```powershell
(Get-Command node).Source
```
Boşsa Node.js kurulu değil veya PATH'te yok. Kur, sunucuyu yeniden başlat.

---

## Linux kurulumu (tek komut)

## Önce şunu bil

Panel şu an **sadece senin bilgisayarından** açılıyor (`127.0.0.1`). Sunucuya taşıyınca **internete açılır**:

- İçinde API anahtarları var → şifresiz bırakırsan, IP'yi bulan herkes senin hesabınla LLM çağırır, faturası sana gelir.
- Botlar internete açık tüm IP'leri düzenli tarar. IP'yi kimseye söylememen koruma değildir.

Bu yüzden kurulum betiği **otomatik şifre üretir**. Şifre istemiyorsan `/etc/ajans-os.env` içindeki `ADMIN_PASSWORD` satırını silersin — ama o zaman panel şifresiz açılır.

---

## Gereken bilgiler

Taşımaya başlamadan şunları hazırla:

| Ne | Örnek |
|---|---|
| Sunucu IP adresi | `185.12.34.56` |
| SSH kullanıcı adı | `root` veya `ubuntu` |
| SSH şifresi veya anahtar | — |
| Sunucu işletim sistemi | Ubuntu 22.04 / 24.04 (Debian da olur) |
| Alan adı (varsa) | `panel.seninmarkan.com` |

---

## Yöntem 1 — Tek komutla (önerilen)

### 1) Dosyaları sunucuya gönder

Windows'ta **PowerShell** aç, proje klasörüne git:

```powershell
cd "C:\Users\esesl\OneDrive\Masaüstü\ajans-os"
```

Sonra (kullanıcı adı ve IP'yi kendi sunucuna göre değiştir):

```powershell
scp -r server.js lib public deploy agents data README.md root@SUNUCU_IP:/tmp/ajans-os
```

> `uploads` ve `runs` klasörlerini gönderme — onlar senin yerel geçmişin. Sunucuda boş başlar.

### 2) Sunucuya bağlan

```powershell
ssh root@SUNUCU_IP
```

### 3) Betiği çalıştır

```bash
cd /tmp/ajans-os
sudo bash deploy/kur.sh
```

Betik şunları yapar:
- Node.js kurar (yoksa)
- `ajans` sistem kullanıcısı açar
- Dosyaları `/opt/ajans-os` içine kopyalar
- Rastgele şifre üretir ve **ekrana yazar** (hemen kaydet)
- systemd servisi kurar → **sunucu kapansa bile otomatik başlar**
- Güvenlik duvarında 22/80/443 açar

### 4) API anahtarlarını gir

```bash
sudo nano /opt/ajans-os/data/providers.json
```

`BURAYA_EVREN_ANAHTARI` ve `BURAYA_NVIDIA_ANAHTARI` yazılarının yerine kendi anahtarlarını yaz. Kaydet: `Ctrl+O`, `Enter`, `Ctrl+X`.

```bash
sudo chmod 600 /opt/ajans-os/data/providers.json
sudo systemctl restart ajans-os
```

### 5) Aç ve giriş yap

Tarayıcıda:

```
http://SUNUCU_IP:7777
```

Şifre: kurulumda ekrana yazılan değer. Kaybettiysen:

```bash
sudo grep ADMIN_PASSWORD /etc/ajans-os.env
```

✅ Bitti. Artık bilgisayarını kapatsan da panel çalışır.

---

## Yöntem 2 — Alan adı + HTTPS (daha iyi)

Yöntem 1'i yaptıktan sonra:

### 1) DNS ayarı

Alan adı sağlayıcında bir **A kaydı** ekle:

```
panel.seninmarkan.com  →  SUNUCU_IP
```

5-30 dakika bekle.

### 2) Nginx kur

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

### 3) Site ayarı

```bash
sudo cp /opt/ajans-os/deploy/nginx.conf /etc/nginx/sites-available/ajans-os
sudo nano /etc/nginx/sites-available/ajans-os
```

`server_name panel.ornek.com;` satırını kendi alan adınla değiştir.

```bash
sudo ln -s /etc/nginx/sites-available/ajans-os /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4) Ücretsiz SSL

```bash
sudo certbot --nginx -d panel.seninmarkan.com
```

Sertifika otomatik yenilenir.

### 5) Paneli dışarıya kapat

Artık sadece Nginx üzerinden erişilsin:

```bash
sudo nano /etc/ajans-os.env
```

`SUNUCU_MODU=1` satırını `SUNUCU_MODU=0` yap, kaydet.

```bash
sudo nano /etc/systemd/system/ajans-os.service
```

`EnvironmentFile` satırının altına şunu ekle:

```
Environment=SUNUCU_MODU_HARICI=0
```

Sonra:

```bash
sudo systemctl daemon-reload && sudo systemctl restart ajans-os
```

Ve 7777 portunu dışarı kapat:

```bash
sudo ufw deny 7777/tcp
```

Artık panel `https://panel.seninmarkan.com` adresinde, kilitli.

---

## Yönetim komutları

| Ne | Komut |
|---|---|
| Durum | `sudo systemctl status ajans-os` |
| Canlı log | `sudo journalctl -u ajans-os -f` |
| Yeniden başlat | `sudo systemctl restart ajans-os` |
| Durdur | `sudo systemctl stop ajans-os` |
| Başlat | `sudo systemctl start ajans-os` |
| Otomatik başlatma kapat | `sudo systemctl disable ajans-os` |
| Şifre gör | `sudo grep ADMIN_PASSWORD /etc/ajans-os.env` |
| Şifre değiştir | `sudo nano /etc/ajans-os.env` sonra restart |

---

## Güncelleme (kod değişince)

Bilgisayarında değişiklik yaptıysan:

```powershell
cd "C:\Users\esesl\OneDrive\Masaüstü\ajans-os"
scp -r server.js lib public agents root@SUNUCU_IP:/opt/ajans-os/
ssh root@SUNUCU_IP "chown -R ajans:ajans /opt/ajans-os && systemctl restart ajans-os"
```

> `data/` klasörünü **üzerine yazma** — şirket ayarların orada.

---

## Yeni ajan eklemek

Yerel bilgisayarında `~/.config/opencode/agents/` içine `.md` dosyası koyduysan:

```powershell
scp ~/.config/opencode/agents/yeni-ajan.md root@SUNUCU_IP:/opt/ajans-os/agents/
ssh root@SUNUCU_IP "systemctl restart ajans-os"
```

Panelde sayfayı yenile, ajan listede görünür.

---

## Yedekleme

Şirket ayarları ve iş geçmişi sunucuda. Haftada bir al:

```bash
# sunucuda
sudo tar -czf /root/ajans-yedek-$(date +%Y%m%d).tar.gz \
  /opt/ajans-os/data /opt/ajans-os/runs /etc/ajans-os.env
```

Bilgisayarına indir:

```powershell
scp root@SUNUCU_IP:/root/ajans-yedek-*.tar.gz .
```

---

## Sorun giderme

**Panel açılmıyor**
```bash
sudo systemctl status ajans-os
sudo journalctl -u ajans-os -n 50 --no-pager
```

**"Port kullanımda"**
```bash
sudo lsof -i :7777
sudo systemctl restart ajans-os
```

**Modeller çalışmıyor / "API anahtarı bulunamadı"**
```bash
sudo nano /opt/ajans-os/data/providers.json   # anahtarları kontrol et
sudo systemctl restart ajans-os
```
Panelde sağ üstteki **Modelleri test et** butonu hangisinin çalıştığını gösterir.

**Ajan listesi boş**
```bash
ls /opt/ajans-os/agents/*.md | wc -l    # 44 civarı olmalı
```
Yoksa bilgisayarından tekrar gönder.

**Uzun iş yarıda kesiliyor (proxy)**
Nginx kullanıyorsan `deploy/nginx.conf` içindeki `proxy_read_timeout 600s` satırının olduğundan emin ol.

**Şifremi unuttum**
```bash
sudo grep ADMIN_PASSWORD /etc/ajans-os.env
```

**Şifreyi tamamen kapatmak istiyorum**
```bash
sudo sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' /etc/ajans-os.env
sudo systemctl restart ajans-os
```
Panel şifresiz açılır. **Önermem** — API anahtarların açıkta kalır.

---

## Güvenlik kontrol listesi

Kurulumdan sonra sırayla:

- [ ] `/etc/ajans-os.env` izni `600` (`sudo chmod 600 /etc/ajans-os.env`)
- [ ] `/opt/ajans-os/data/providers.json` izni `600`
- [ ] `ADMIN_PASSWORD` boş değil
- [ ] SSH şifre girişi kapalı, anahtar kullanılıyor (`PasswordAuthentication no`)
- [ ] `ufw` açık, sadece 22/80/443
- [ ] HTTPS kurulu (Yöntem 2)
- [ ] `sudo apt install unattended-upgrades` ile otomatik güncelleme
- [ ] Haftalık yedek alınıyor

---

## Ne kadar kaynak gerekiyor

Panel çok hafif:

| Kaynak | Gereken |
|---|---|
| RAM | ~120 MB (Node süreci) |
| Disk | ~50 MB kod + iş geçmişi (her iş ~50 KB) |
| CPU | Neredeyse yok (iş modelde, sunucuda değil) |

**1 vCPU / 1 GB RAM sunucu fazlasıyla yeter.** Model çağrıları dışarıda (EVREN/NVIDIA) çalıştığı için sunucu zorlanmaz.
