#!/usr/bin/env bash
# ============================================================
#  AJANS OS - Ubuntu/Debian kurulum betiği
#  Kullanım:  sudo bash kur.sh
# ============================================================
set -e

APP_DIR="/opt/ajans-os"
SERVIS="ajans-os"
KULLANICI="ajans"

echo ""
echo "=============================================="
echo "  AJANS OS - sunucu kurulumu"
echo "=============================================="
echo ""

# ---------- root kontrolü ----------
if [ "$EUID" -ne 0 ]; then
  echo "HATA: Bu betiği sudo ile çalıştır:  sudo bash kur.sh"
  exit 1
fi

# ---------- Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo "[1/6] Node.js kuruluyor..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[1/6] Node.js mevcut: $(node --version)"
fi

# ---------- sistem kullanıcısı ----------
if ! id "$KULLANICI" >/dev/null 2>&1; then
  echo "[2/6] '$KULLANICI' kullanıcısı oluşturuluyor..."
  useradd --system --create-home --shell /usr/sbin/nologin "$KULLANICI"
else
  echo "[2/6] '$KULLANICI' kullanıcısı mevcut"
fi

# ---------- dosyaları kopyala ----------
echo "[3/6] Dosyalar $APP_DIR konumuna kopyalanıyor..."
mkdir -p "$APP_DIR"
if [ "$(pwd)" != "$APP_DIR" ]; then
  rsync -a --exclude 'node_modules' --exclude '.git' ./ "$APP_DIR"/
fi
mkdir -p "$APP_DIR/uploads" "$APP_DIR/data" "$APP_DIR/runs"
chown -R "$KULLANICI":"$KULLANICI" "$APP_DIR"
chmod 700 "$APP_DIR/data"

# ---------- env dosyası ----------
echo "[4/6] Ortam değişkenleri hazırlanıyor..."

# hazır providers dosyası geldiyse yerine koy (anahtarlar içinde)
if [ -f "$APP_DIR/deploy/providers.hazir.json" ]; then
  if [ ! -f "$APP_DIR/data/providers.json" ] || grep -q "BURAYA_" "$APP_DIR/data/providers.json" 2>/dev/null; then
    cp "$APP_DIR/deploy/providers.hazir.json" "$APP_DIR/data/providers.json"
    echo "      API anahtarları data/providers.json içine yazıldı."
  fi
  rm -f "$APP_DIR/deploy/providers.hazir.json"
fi
chmod 600 "$APP_DIR/data/providers.json" 2>/dev/null || true

ENV_FILE="/etc/$SERVIS.env"
if [ ! -f "$ENV_FILE" ]; then
  SIFRE=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
  cat > "$ENV_FILE" <<EOF
# AJANS OS ayarları - bu dosyayı kimseyle paylaşma
PORT=7777
SUNUCU_MODU=1

# Panele giriş şifresi (boş bırakırsan şifresiz açılır - önerilmez)
ADMIN_PASSWORD=$SIFRE

# opencode.json içindeki sağlayıcı bilgileri
# (dosyayı ayrıca $APP_DIR/data/providers.json içine de koyabilirsin)
EOF
  chmod 600 "$ENV_FILE"
  echo ""
  echo "  ┌────────────────────────────────────────────┐"
  echo "  │  PANEL ŞİFREN (kaydet!):                   │"
  echo "  │  $SIFRE"
  echo "  └────────────────────────────────────────────┘"
  echo ""
else
  echo "      $ENV_FILE zaten var, korunuyor."
fi

# ---------- systemd servisi ----------
echo "[5/6] systemd servisi kuruluyor..."
cat > "/etc/systemd/system/$SERVIS.service" <<EOF
[Unit]
Description=Ajans OS - tek kisilik sirket paneli
After=network.target

[Service]
Type=simple
User=$KULLANICI
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVIS"
systemctl restart "$SERVIS"

# ---------- güvenlik duvarı ----------
echo "[6/6] Güvenlik duvarı kontrol ediliyor..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "      ufw: 22, 80, 443 açık"
else
  echo "      ufw yok, atlandı"
fi

# ---------- durum ----------
sleep 2
echo ""
if systemctl is-active --quiet "$SERVIS"; then
  echo "=============================================="
  echo "  KURULUM TAMAM ✓"
  echo "=============================================="
  echo ""
  echo "  Servis  : systemctl status $SERVIS"
  echo "  Log     : journalctl -u $SERVIS -f"
  echo "  Yeniden : systemctl restart $SERVIS"
  echo "  Durdur  : systemctl stop $SERVIS"
  echo ""
  echo "  Şifre   : sudo grep ADMIN_PASSWORD $ENV_FILE"
  echo ""
  echo "  Panel   : http://$(curl -s -4 ifconfig.me 2>/dev/null || echo 'SUNUCU-IP'):7777"
  echo ""
  echo "  ŞİMDİ YAPMAN GEREKEN:"
  echo "  1. opencode.json içindeki sağlayıcı bilgilerini"
  echo "     $APP_DIR/data/providers.json dosyasına taşı"
  echo "     (yoksa panel açılır ama modeller çalışmaz)"
  echo "  2. Ajans ajanlarını kopyala:"
  echo "     scp -r ~/.config/opencode/agents/* kullanici@sunucu:$APP_DIR/agents/"
  echo "  3. Tarayıcıdan panele gir ve şifreyle giriş yap"
  echo ""
else
  echo "HATA: Servis başlamadı. Log:"
  journalctl -u "$SERVIS" -n 30 --no-pager
  exit 1
fi
