# Üretim çıkış IP — 85.95.240.184

Sağlayıcı ataması:

| | |
|---|---|
| IP | `85.95.240.184` |
| Netmask | `255.255.255.0` (`/24`) |
| Gateway | `85.95.240.1` |

## 1) VPS’e ekle + reboot

```bash
cd /var/www/tamkobi.com   # veya repo yolu
sudo bash deploy/add-production-ip.sh
```

Sağlayıcı paneli: **power off → power on**.

Mevcut netplan dosyanızda `addresses` altına şunu ekleyin (DHCP/static şablonunu bozmadan):

```yaml
- 85.95.240.184/24
```

Çıkışın yeni IP’den gitmesi için (whitelist için şart):

```bash
sudo ip route replace default via 85.95.240.1 src 85.95.240.184
curl -4 https://api.ipify.org   # → 85.95.240.184
```

## 2) DNS

`tamkobi.com` (ve `www`) **A** kaydı → `85.95.240.184`.

## 3) İşNet

Canlı SOAP kimlik doğrulama = çıkış IP + VKN.

Kayıt metni örneği:

> VKN: … · IP: 85.95.240.184 · InvoiceService / einvoiceservice.isnet.net.tr SOAP WCF

→ `efaturadestek@nettefatura.com.tr`

Uygulama: Ayarlar → E-Fatura → İşNet canlı IP paneli / destek paketi.

## 4) Bankalar

- Enpara Şirketim API portal whitelist → `85.95.240.184`
- Kuveyt Türk canlı onay / API Market IP listesi → `85.95.240.184`

Eski `85.95.240.136` kaldırılabilir (artık kullanılmıyorsa).

## 5) Uygulama sabiti

Kodda yedek: `TAMKOBI_PRODUCTION_IP` env (varsayılan `85.95.240.184`).
Destek paketindeki `declared_isnet_ip` önce DNS A kaydını, yoksa bu sabiti kullanır.
