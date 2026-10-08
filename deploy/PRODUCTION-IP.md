# Üretim IP’leri (çift adres)

Her iki IP de kullanılacak:

| Rol | IP | Netmask | Gateway |
|-----|-----|---------|---------|
| Birincil (mevcut) | `85.95.240.136` | `/24` | `85.95.240.1` |
| İkincil (yeni) | `85.95.240.184` | `/24` | `85.95.240.1` |

## 1) VPS’e ikincil IP ekle + reboot

```bash
cd /var/www/tamkobi.com   # veya repo yolu
sudo bash deploy/add-production-ip.sh
```

- Birincil `85.95.240.136` korunur (varsayılan çıkış).
- İkincil `85.95.240.184` alias olarak eklenir.
- Sağlayıcı paneli: **power off → power on**.

Netplan `addresses` örneği:

```yaml
addresses:
  - 85.95.240.136/24
  - 85.95.240.184/24
```

Çıkışı bilinçli olarak ikincilden almak isterseniz (genelde gerekmez):

```bash
TAMKOBI_EGRESS_SRC=secondary sudo bash deploy/add-production-ip.sh
```

## 2) DNS

- Ana A kaydı: `tamkobi.com` → `85.95.240.136` (mevcut kalsın).
- İsteğe bağlı ikinci A: `tamkobi.com` → `85.95.240.184` (aynı hosta iki A; istemciler rastgele seçer).

## 3) İşNet

Canlı SOAP = çıkış IP + VKN. **İki IP’yi de** allow-list’e yazdırın:

> VKN: … · IP: 85.95.240.136 ve 85.95.240.184 · InvoiceService / einvoiceservice.isnet.net.tr SOAP WCF

→ `efaturadestek@nettefatura.com.tr`

## 4) Bankalar

Enpara ve Kuveyt portal whitelist’e **her iki IP**:

- `85.95.240.136`
- `85.95.240.184`

## 5) Uygulama

Env (virgüllü liste):

```bash
TAMKOBI_PRODUCTION_IPS=85.95.240.136,85.95.240.184
```

Destek paketindeki `declared_isnet_ip` = DNS A + bu liste birleşimi.
