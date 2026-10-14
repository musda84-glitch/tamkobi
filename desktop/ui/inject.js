/* Uzak TamKobi sayfasına kabuk tarafından eklenir. İş kuralı yazmaz. */
(function boot() {
  var P = globalThis.TamkobiDesktopPolicy;
  if (!P || !globalThis.__TAURI_INTERNALS__) {
    globalThis.setTimeout(boot, 40);
    return;
  }

  var companyId = "";
  var currentNonce = "";
  var nativePrint = globalThis.print ? globalThis.print.bind(globalThis) : function () {};

  function invoke(cmd, args) {
    return globalThis.__TAURI_INTERNALS__.invoke(cmd, args || {});
  }

  globalThis.print = function () {
    if (!P.isTamkobiUrl(globalThis.location && globalThis.location.href)) {
      nativePrint();
      return;
    }
    invoke("silent_print").catch(function () { nativePrint(); });
  };

  globalThis.addEventListener("keydown", function (event) {
    if (!P.isKioskExitChord(event)) return;
    event.preventDefault();
    event.stopPropagation();
    invoke("request_kiosk_exit").catch(function () {});
  }, true);

  function overlay() {
    var existing = document.getElementById("tamkobi-kiosk-exit");
    if (existing) return existing;
    var root = document.createElement("div");
    root.id = "tamkobi-kiosk-exit";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.72);display:none;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;";
    root.innerHTML = ''
      + '<form style="width:min(420px,92vw);background:#fff;color:#0f172a;border-radius:20px;padding:22px;display:grid;gap:12px;">'
      + '<strong style="font-size:20px;">Kiosk çıkışı</strong>'
      + '<p style="margin:0;color:#64748b;font-size:13px;">Yönetici PIN’i, Hızlı Satış kasiyer kilidi ile aynı kuralla doğrulanır.</p>'
      + '<label style="display:grid;gap:6px;font-size:13px;font-weight:700;">Onaylayan<select name="user" style="font:inherit;padding:10px;border:1px solid #e2e8f0;border-radius:10px;"></select></label>'
      + '<label style="display:grid;gap:6px;font-size:13px;font-weight:700;">PIN<input name="pin" inputmode="numeric" autocomplete="off" maxlength="6" style="font:inherit;padding:10px;border:1px solid #e2e8f0;border-radius:10px;letter-spacing:.3em;" /></label>'
      + '<p data-error style="margin:0;color:#b91c1c;font-size:13px;"></p>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button type="button" data-cancel style="border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:10px 12px;font:inherit;">Vazgeç</button>'
      + '<button type="submit" style="border:0;background:#0f172a;color:#fff;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;">Çık</button>'
      + '</div></form>';
    document.documentElement.appendChild(root);
    root.querySelector("[data-cancel]").addEventListener("click", function () {
      root.style.display = "none";
    });
    root.addEventListener("submit", function (event) {
      event.preventDefault();
      submitExit(root);
    });
    return root;
  }

  function terminalId() {
    try { return localStorage.getItem("pos_terminal_id") || ""; } catch (err) { return ""; }
  }

  async function loadApprovers(select) {
    select.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Kullanıcı seçin";
    select.appendChild(empty);
    if (!companyId) return;
    var response = await fetch("/api/pos/cashiers?company_id=" + encodeURIComponent(companyId), { credentials: "include" });
    if (!response.ok) return;
    var rows = await response.json();
    if (!Array.isArray(rows)) return;
    rows.forEach(function (row) {
      var rules = P.normalizePosRules(row.pos_rules, row.role);
      if (!rules.can_approve) return;
      var option = document.createElement("option");
      option.value = row.id;
      option.textContent = (row.name || row.email || row.id) + (row.role_name ? " · " + row.role_name : "");
      option.dataset.role = row.role || "";
      option.dataset.rules = JSON.stringify(row.pos_rules || {});
      select.appendChild(option);
    });
  }

  async function submitExit(root) {
    var error = root.querySelector("[data-error]");
    var select = root.querySelector("select");
    var option = select.options[select.selectedIndex];
    var pin = root.querySelector("input").value;
    var approver = {
      id: select.value,
      role: option ? option.dataset.role : "",
      rules: {},
    };
    try { approver.rules = JSON.parse((option && option.dataset.rules) || "{}"); } catch (err) { approver.rules = {}; }
    var decision = P.kioskExitDecision({ pin: pin, approver: approver, session: null });
    if (!decision.allow) {
      error.textContent = decision.detail;
      return;
    }
    var response = await fetch("/api/desktop/kiosk-exit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: approver.id,
        pin: String(pin || "").trim(),
        company_id: companyId,
        terminal_id: terminalId(),
      }),
    });
    var data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    if (!response.ok || !data.allow) {
      error.textContent = data.detail || "PIN hatalı.";
      return;
    }
    await invoke("complete_kiosk_exit", { nonce: currentNonce });
  }

  globalThis.__tamkobiShowKioskExit = function (nonce) {
    currentNonce = String(nonce || "");
    var root = overlay();
    root.style.display = "flex";
    root.querySelector("[data-error]").textContent = "";
    loadApprovers(root.querySelector("select")).catch(function () {});
    var input = root.querySelector("input");
    input.value = "";
    input.focus();
  };

  async function reportSession() {
    if (!P.isTamkobiUrl(globalThis.location && globalThis.location.href)) return false;
    var response = await fetch("/api/auth/me", { credentials: "include" });
    if (!response.ok) return false;
    var me = await response.json();
    var user = me && me.user;
    if (user && user.active_company_id) companyId = user.active_company_id;
    await invoke("report_session", {
      payload: {
        authenticated: !!(me && me.authenticated && user),
        user: user ? {
          id: user.id || "",
          role: user.role || "",
          name: user.name || "",
          activeCompanyId: user.active_company_id || "",
          permissions: user.permissions || {},
        } : null,
        license: me && me.license ? { modules: me.license.modules || null } : null,
      },
    });
    return !!(me && me.authenticated && user);
  }

  if (P.isTamkobiUrl(globalThis.location && globalThis.location.href)) {
    var timer = globalThis.setInterval(function () {
      reportSession().then(function (ok) {
        if (ok) globalThis.clearInterval(timer);
      }).catch(function () {});
    }, 1500);
    reportSession().catch(function () {});
  }
})();
