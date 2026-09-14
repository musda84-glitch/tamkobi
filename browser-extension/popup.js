const DEFAULT_BASE = "https://tamkobi.com";

const baseInput = document.getElementById("baseUrl");
const saveBtn = document.getElementById("saveBase");
const statusEl = document.getElementById("status");

function normalizeBase(url) {
  const raw = String(url || "").trim() || DEFAULT_BASE;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "") || u.origin;
  } catch {
    return DEFAULT_BASE;
  }
}

function flash(msg) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => {
    statusEl.hidden = true;
  }, 1800);
}

chrome.storage.sync.get({ baseUrl: DEFAULT_BASE }, (data) => {
  baseInput.value = data.baseUrl || DEFAULT_BASE;
});

saveBtn.addEventListener("click", () => {
  const baseUrl = normalizeBase(baseInput.value);
  baseInput.value = baseUrl;
  chrome.storage.sync.set({ baseUrl }, () => flash("Adres kaydedildi"));
});

const links = document.getElementById("links");
if (links) {
  links.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-path]");
    if (!btn) return;
    chrome.runtime.sendMessage({ type: "openPath", path: btn.dataset.path });
    window.close();
  });
}
