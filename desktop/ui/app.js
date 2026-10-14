(function () {
  var P = globalThis.TamkobiDesktopPolicy;
  var selected = null;

  function invoke(cmd, args) {
    var api = globalThis.__TAURI_INTERNALS__;
    if (!api || !api.invoke) return Promise.reject(new Error("Masaüstü kabuğu bağlı değil."));
    return api.invoke(cmd, args || {});
  }

  function showError(message) {
    var el = document.getElementById("error");
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function render(state, keepPrefs) {
    var hello = document.getElementById("hello");
    var box = document.getElementById("modes");
    var user = state.user;
    hello.textContent = user && user.name ? user.name + " · " + (user.role || "") : "Giriş yapılmadı";
    if (!keepPrefs) document.getElementById("kiosk").checked = !!state.kiosk;
    selected = state.selected || null;
    box.innerHTML = "";
    var modes = state.modes || [];
    if (!modes.length) {
      var empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = user
        ? "Bu rol için açık masaüstü modu yok. Yetki sunucudaki rol izinlerinden gelir."
        : "Modlar, TamKobi oturumu açılınca role göre listelenir.";
      box.appendChild(empty);
    }
    modes.forEach(function (mode) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "mode" + (mode.id === selected ? " selected" : "");
      var title = document.createElement("strong");
      title.textContent = mode.label;
      var hint = document.createElement("span");
      hint.textContent = mode.cashier ? "Kasiyer modu · " + mode.path : mode.path;
      button.appendChild(title);
      button.appendChild(hint);
      button.addEventListener("click", function () {
        selected = mode.id;
        render(Object.assign({}, state, { selected: selected, modes: modes }), true);
      });
      box.appendChild(button);
    });
    document.getElementById("open").disabled = !selected;
  }

  function fillPrinters(snapshot, current) {
    var select = document.getElementById("printer");
    var note = document.getElementById("printer-note");
    var value = current || "";
    select.innerHTML = "";
    var fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = snapshot && snapshot.defaultPrinter
      ? "Windows varsayılan (" + snapshot.defaultPrinter + ")"
      : "Windows varsayılan yazıcı";
    select.appendChild(fallback);
    (snapshot && snapshot.printers || []).forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = value;
    if (snapshot && snapshot.supported === false) {
      note.textContent = "Yazıcı listesi Windows kurulumunda dolar. USB barkod okuyucu klavye girişi olarak kalır.";
    }
  }

  function boot() {
    invoke("get_shell_state").then(function (state) {
      render(state);
      return invoke("list_printers").then(function (printers) {
        fillPrinters(printers, state.printer);
      });
    }).catch(function (err) {
      showError(err && err.message ? err.message : String(err));
    });
    invoke("check_update").then(function (update) {
      if (!update || !update.available) return;
      var box = document.getElementById("update");
      box.hidden = false;
      document.getElementById("update-text").textContent = "Yeni sürüm " + update.version;
    }).catch(function () {});
  }

  document.getElementById("open").addEventListener("click", function () {
    if (!selected) return;
    showError("");
    var kiosk = document.getElementById("kiosk").checked;
    invoke("open_mode", { modeId: selected, kiosk: kiosk }).catch(function (err) {
      showError(err && err.message ? String(err) : "Mod açılamadı.");
    });
  });

  document.getElementById("login").addEventListener("click", function () {
    invoke("open_login").catch(function (err) {
      showError(String(err));
    });
  });

  document.getElementById("kiosk").addEventListener("change", function (event) {
    invoke("set_prefs", { kiosk: event.target.checked }).catch(function () {});
  });

  document.getElementById("printer").addEventListener("change", function (event) {
    invoke("set_prefs", { printer: event.target.value }).catch(function () {});
  });

  document.getElementById("update-btn").addEventListener("click", function () {
    var button = document.getElementById("update-btn");
    button.disabled = true;
    invoke("install_update").catch(function (err) {
      button.disabled = false;
      showError(err && err.message ? String(err) : "Güncelleme yüklenemedi.");
    });
  });

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();
  void P;
})();
