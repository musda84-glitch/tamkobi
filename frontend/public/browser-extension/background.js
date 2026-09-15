const DEFAULT_BASE = "https://tamkobi.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ baseUrl: DEFAULT_BASE }, (data) => {
    if (!data.baseUrl) {
      chrome.storage.sync.set({ baseUrl: DEFAULT_BASE });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "openPath" && typeof msg.path === "string") {
    chrome.storage.sync.get({ baseUrl: DEFAULT_BASE }, (data) => {
      const base = String(data.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
      const path = msg.path.startsWith("/") ? msg.path : `/${msg.path}`;
      chrome.tabs.create({ url: `${base}${path}` });
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
