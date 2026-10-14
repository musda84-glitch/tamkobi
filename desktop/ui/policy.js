/* TamKobi masaüstü kabuğu.
 * Mod yönlendirmesi, alan adı kısıtı ve kiosk çıkış kararı.
 * Kiosk PIN kapısı backend/pos_cashier.kiosk_exit_decision ile aynı mesajları kullanır.
 * Oturum çerezi burada tutulmaz; hash kontrolü sunucudadır.
 */
(function (root, factory) {
  var api = factory();
  if (typeof window === "undefined" && typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
  root.TamkobiDesktopPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var APP_ORIGIN = "https://app.tamkobi.com";
  var MODE_KEY = "tamkobi.desktop.mode";

  var MODES = [
    { id: "atolye", label: "Atölye", path: "/atolye", permission: "/atolye" },
    { id: "sevk", label: "Depo Sevkiyatı", path: "/sevk", permission: "/sevk" },
    { id: "sayim", label: "Stok Sayımı", path: "/sayim", permission: "/sayim" },
    { id: "hizli-satis", label: "Hızlı Satış", path: "/hizli-satis", permission: "/hizli-satis", cashier: true },
  ];

  var OPEN_RULES = {
    can_change_price: true,
    can_refund: true,
    can_cancel: true,
    can_credit_sale: true,
    can_exit: true,
    can_delete_line: true,
    can_out_of_stock: true,
    can_open_drawer: true,
    can_approve: true,
  };
  var RESTRICTED_RULES = {
    can_change_price: false,
    can_refund: false,
    can_cancel: false,
    can_credit_sale: false,
    can_exit: false,
    can_delete_line: false,
    can_out_of_stock: false,
    can_open_drawer: false,
    can_approve: false,
  };
  var BOOL_RULES = Object.keys(OPEN_RULES);

  function normalizeRole(role) {
    var raw = String(role || "").trim().toLowerCase();
    if (raw === "owner" || raw === "yönetici" || raw === "yonetici") return "admin";
    if (raw === "müdür" || raw === "mudur") return "manager";
    return raw;
  }

  function defaultPosRules(role) {
    var code = normalizeRole(role);
    if (code === "admin" || code === "manager") return Object.assign({}, OPEN_RULES);
    return Object.assign({}, RESTRICTED_RULES);
  }

  function normalizePosRules(raw, role) {
    var base = defaultPosRules(role);
    var src = raw && typeof raw === "object" ? raw : {};
    BOOL_RULES.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(src, key)) base[key] = !!src[key];
    });
    if (normalizeRole(role) === "admin") return Object.assign(base, defaultPosRules("admin"));
    return base;
  }

  function exitIsBlocked(session, rules) {
    if (!session || !session.cashier_user_id) return false;
    if (session.exit_granted) return false;
    var applied = rules != null ? rules : session.rules || {};
    return !applied.can_exit;
  }

  function kioskExitDecision(input) {
    var pin = String((input && input.pin) || "").trim();
    if (!/^\d{4,6}$/.test(pin)) {
      return { allow: false, detail: "PIN 4-6 haneli rakam olmalı." };
    }
    var approver = (input && input.approver) || {};
    var approverId = String(approver.id || approver.user_id || "").trim();
    if (!approverId) return { allow: false, detail: "Kullanıcı seçin." };
    var rules = normalizePosRules(approver.rules || approver.pos_rules, approver.role);
    var session = input && input.session;
    var cashierId = String((session && session.cashier_user_id) || "").trim();
    if (cashierId && approverId === cashierId && exitIsBlocked(session)) {
      return { allow: false, detail: "Talebi açan kasiyer bu talebi onaylayamaz." };
    }
    if (!rules.can_approve) return { allow: false, detail: "Bu PIN yönetici onayı veremez." };
    return { allow: true, detail: "" };
  }

  function isKioskExitChord(event) {
    if (!event) return false;
    var key = String(event.key || "").toLowerCase();
    return !!(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === "l");
  }

  function canViewMode(user, path) {
    if (!user) return false;
    if (normalizeRole(user.role) === "admin") return true;
    var perms = user.permissions;
    if (!perms || typeof perms !== "object") return false;
    return perms[path] !== "none";
  }

  function moduleEnabled(user, license, path) {
    if (!user) return false;
    if (!license || !license.modules) return true;
    return license.modules[path] !== false;
  }

  function visibleModes(user, license) {
    if (!user) return [];
    return MODES.filter(function (mode) {
      return canViewMode(user, mode.permission) && moduleEnabled(user, license, mode.permission);
    });
  }

  function modeById(modeId) {
    for (var i = 0; i < MODES.length; i += 1) {
      if (MODES[i].id === modeId) return MODES[i];
    }
    return null;
  }

  function modeUrl(modeId, origin) {
    var mode = modeById(modeId);
    if (!mode) return null;
    var base = String(origin || APP_ORIGIN).replace(/\/+$/, "");
    if (classifyNavigation(base + "/", { dev: false }) !== "allow") return null;
    return base + mode.path;
  }

  function rememberedMode(storage) {
    try {
      var value = storage && storage.getItem(MODE_KEY);
      return value ? String(value) : null;
    } catch (err) {
      return null;
    }
  }

  function rememberMode(storage, modeId) {
    if (!storage || !modeById(modeId)) return false;
    storage.setItem(MODE_KEY, modeId);
    return true;
  }

  function startupSelection(savedId, user, license) {
    var modes = visibleModes(user, license);
    var selected = null;
    for (var i = 0; i < modes.length; i += 1) {
      if (modes[i].id === savedId) selected = savedId;
    }
    return { modes: modes, selected: selected };
  }

  function isTamkobiHost(hostname) {
    var host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    return host === "tamkobi.com" || host.slice(-12) === ".tamkobi.com";
  }

  function isShellUrl(url) {
    var protocol = url.protocol;
    var host = String(url.hostname || "").toLowerCase();
    if (protocol === "tauri:" || protocol === "asset:" || protocol === "ipc:") return true;
    if (host === "tauri.localhost" || host === "ipc.localhost") return true;
    return false;
  }

  function isDevShell(url) {
    var host = String(url.hostname || "").toLowerCase();
    return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
  }

  function classifyNavigation(input, options) {
    var dev = !!(options && options.dev);
    var url;
    try {
      url = new URL(String(input || ""));
    } catch (err) {
      return "deny";
    }
    if (isShellUrl(url)) return "allow";
    if (isDevShell(url)) return dev ? "allow" : "deny";
    if (url.protocol === "blob:" || url.protocol === "data:") return "allow";
    if (url.protocol === "about:") return "allow";
    if (url.protocol === "https:" && isTamkobiHost(url.hostname)) return "allow";
    if (url.protocol === "http:" || url.protocol === "https:") return "external";
    return "deny";
  }

  function isTamkobiUrl(input) {
    return classifyNavigation(input, { dev: false }) === "allow" && isTamkobiHost(safeHost(input));
  }

  function safeHost(input) {
    try {
      return new URL(String(input || "")).hostname;
    } catch (err) {
      return "";
    }
  }

  return {
    APP_ORIGIN: APP_ORIGIN,
    MODE_KEY: MODE_KEY,
    MODES: MODES,
    normalizeRole: normalizeRole,
    defaultPosRules: defaultPosRules,
    normalizePosRules: normalizePosRules,
    exitIsBlocked: exitIsBlocked,
    kioskExitDecision: kioskExitDecision,
    isKioskExitChord: isKioskExitChord,
    visibleModes: visibleModes,
    modeById: modeById,
    modeUrl: modeUrl,
    rememberedMode: rememberedMode,
    rememberMode: rememberMode,
    startupSelection: startupSelection,
    classifyNavigation: classifyNavigation,
    isTamkobiUrl: isTamkobiUrl,
    isTamkobiHost: isTamkobiHost,
  };
});
