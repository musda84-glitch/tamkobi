/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { RoleHelpPanel } from "./RoleHelpPanel";
import { collectRoleHelpImages } from "./roleHelpContent";
import { UsersRolesPanel } from "../UsersRolesPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api", useAuth: () => ({ user: { id: "admin" } }) }));
jest.mock("../../utils/modalBackdrop", () => ({
  backdropDismissProps: (onClose) => ({
    onClick: () => onClose?.(),
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SECTION_IDS = ["seviyeler", "finans", "satis", "stok", "uretim", "ik", "diger", "gelismis"];
const ITEM_TITLES = [
  "Faturalar & e-Belge",
  "Banka, Kasa & POS",
  "Çek / Senet",
  "Masraflar",
  "Krediler & Taksitler",
  "Cari Hesaplar",
  "Teklif & Sipariş",
  "Hızlı Satış (POS)",
  "B2B Bayi Portalı",
  "Stok & Ürünler",
  "Depo, Sayım & Sevkiyat",
  "Verilen Siparişler",
  "Üretim & Reçete",
  "Atölye Ekranı",
  "Personel & Bordro",
  "Mesai",
  "Raporlar",
  "İletişim",
  "AI Asistan",
  "Firma Ayarları · Çöp Kutusu · Mali Müşavir Paneli · Destek",
  "Fiyatları görebilir",
  "Personel portalı ve mobil saha",
  "Kısayollar (yalnızca görünüm)",
  "Sipariş ve sevk butonları",
  "Hesap",
];
const IMAGE_FILES = {
  "yetki-seviyeleri": [1452, 912],
  "fatura-gorur": [1440, 900],
  "banka-eslestirme": [1440, 900],
  "cari-ekstre-paylas": [1440, 900],
  "tablet-sayim": [640, 900],
  "atolye-pin": [1440, 900],
  "fiyat-acik-kapali": [1184, 852],
  "personel-mobil-menu": [390, 844],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.style.overflow = "";
});

async function renderPanel(props) {
  await act(async () => {
    root.render(<RoleHelpPanel open onClose={() => {}} {...props} />);
  });
}

test("panel opens and closes from the roles tab", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/users")) return Promise.resolve({ data: { users: [], invites: [], assignable_companies: [] } });
    if (u.includes("/roles")) {
      return Promise.resolve({
        data: {
          roles: [
            { id: "r1", code: "sales", name: "Satış", permissions: {}, features: {}, is_system: true, user_count: 1 },
            { id: "r2", code: "admin", name: "Yönetici", permissions: {}, features: {}, is_system: true, user_count: 1 },
          ],
          modules: [],
          levels: ["none", "view", "edit", "delete"],
          policies: {},
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
  await act(async () => { root.render(<UsersRolesPanel companyId="c1" />); });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  expect(document.querySelector('[data-testid="role-help-open"]')).toBeNull();
  expect(document.querySelector('[data-testid="role-help-panel"]')).toBeNull();
  await act(async () => { host.querySelector('[data-testid="ur-tab-roles"]').click(); });
  const open = host.querySelector('[data-testid="role-help-open"]');
  expect(open.textContent).toContain("Açıklama");
  await act(async () => { open.click(); });
  const panel = document.querySelector('[data-testid="role-help-panel"]');
  expect(panel).toBeTruthy();
  expect(panel.className).toContain("bottom-0");
  expect(panel.className).toContain("md:right-0");
  expect(panel.className).toContain("md:w-[440px]");
  expect(panel.getAttribute("role")).toBe("dialog");
  await act(async () => { document.querySelector('[data-testid="role-help-close"]').click(); });
  expect(document.querySelector('[data-testid="role-help-panel"]')).toBeNull();
});

test("open panel renders every section and screenshot", async () => {
  const onClose = jest.fn();
  await act(async () => { root.render(<RoleHelpPanel open onClose={onClose} />); });
  const panel = document.querySelector('[data-testid="role-help-panel"]');
  expect(panel.textContent).toContain("Yardım · Roller ve yetkiler");
  SECTION_IDS.forEach((id) => {
    expect(document.querySelector(`[data-testid="role-help-section-${id}"]`)).toBeTruthy();
  });
  ITEM_TITLES.forEach((title) => {
    expect(panel.textContent).toContain(title);
  });
  ["Kapalı", "Görür", "Ekler/Düzenler", "Siler"].forEach((label) => {
    expect(document.querySelector('[data-testid="role-help-levels"]').textContent).toContain(label);
  });
  [
    "e-Fatura oluşturma, Faturalar yetkisinde Ekler/Düzenler ister",
    "sunucu okuma isteklerini varsayılan olarak reddeder",
    "masraf bütçeleri bu yetkiye bağlıdır",
    "portal ayarları ve bayi şifresi bu yetkiyle yönetilir",
    "kanal fiyat kuralları ve etiket şablonları",
    "Başlat, duraklat ve bitir Ekler/Düzenler ister",
    "İşNet kayıt ve test uçları Firma Ayarları seviyesine bakmaz",
  ].forEach((snippet) => {
    expect(panel.textContent).toContain(snippet);
  });
  [
    "RBAC_GET_ENFORCE",
    "/api/e-invoice/create",
    "/api/expense-budgets",
    "yalnızca menüyü etkiler",
    "/api/pricing/rules",
    "iş emri işletmeye izin verir",
    "yalnızca okuma (GET)",
  ].forEach((snippet) => {
    expect(panel.textContent).not.toContain(snippet);
  });
  const images = collectRoleHelpImages();
  expect(images).toHaveLength(Object.keys(IMAGE_FILES).length);
  images.forEach((image) => {
    const [width, height] = IMAGE_FILES[image.id];
    const node = document.querySelector(`[data-testid="role-help-shot-${image.id}"]`);
    expect(node).toBeTruthy();
    expect(node.tagName).toBe("IMG");
    expect(node.getAttribute("src")).toBe(`/help/roller/${image.id}.png`);
    expect(node.getAttribute("alt")).toBeTruthy();
    expect(node.getAttribute("loading")).toBe("lazy");
    expect(node.getAttribute("width")).toBe(String(width));
    expect(node.getAttribute("height")).toBe(String(height));
    expect(document.querySelector(`[data-testid="role-help-shot-placeholder-${image.id}"]`)).toBeNull();
  });
  await act(async () => { document.querySelector('[data-testid="role-help-backdrop"]').click(); });
  expect(onClose).toHaveBeenCalled();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("missing screenshot falls back to a placeholder", async () => {
  await renderPanel({
    sections: [{
      id: "bos",
      kicker: "Grup",
      title: "Görselsiz konu",
      items: [{
        id: "yok",
        title: "Kayıp görsel",
        paragraphs: ["Metin durur."],
        image: { id: "yok", src: "", width: 640, height: 400, alt: "Olmayan ekran", caption: "Dosya yok" },
      }, {
        id: "kirik",
        title: "Kırık görsel",
        paragraphs: ["Yüklenemez."],
        image: { id: "kirik", src: "/help/roller/yok.png", width: 800, height: 600, alt: "Kırık ekran görüntüsü", caption: "Yüklenemedi" },
      }],
    }],
  });
  expect(document.querySelector('[data-testid="role-help-shot-yok"]')).toBeNull();
  const empty = document.querySelector('[data-testid="role-help-shot-placeholder-yok"]');
  expect(empty.textContent).toContain("Ekran görüntüsü yer tutucu");
  expect(empty.textContent).toContain("Dosya yok");
  const broken = document.querySelector('[data-testid="role-help-shot-kirik"]');
  expect(broken.getAttribute("src")).toBe("/help/roller/yok.png");
  await act(async () => { broken.dispatchEvent(new Event("error")); });
  expect(document.querySelector('[data-testid="role-help-shot-kirik"]')).toBeNull();
  expect(document.querySelector('[data-testid="role-help-shot-placeholder-kirik"]').textContent).toContain("Yüklenemedi");
});

test("closed panel renders nothing", async () => {
  await act(async () => { root.render(<RoleHelpPanel open={false} onClose={() => {}} />); });
  expect(document.querySelector('[data-testid="role-help-panel"]')).toBeNull();
});
