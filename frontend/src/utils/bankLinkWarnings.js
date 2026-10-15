/** Aynı IBAN / hesap no bağlantısı ve aynı adlı entegre hesap uyarıları. */

export function normRef(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export function isIban(value) {
  const token = normRef(value);
  return token.startsWith("TR") && token.length >= 15 && /^[A-Z0-9]+$/.test(token);
}

export function connectionRefs(conn, account) {
  const ibans = new Set();
  const numbers = new Set();
  const add = (raw) => {
    const token = normRef(raw);
    if (!token || token === "-") return;
    if (isIban(token)) ibans.add(token);
    else numbers.add(token);
  };
  if (account) {
    add(account.iban);
    add(account.account_number);
  }
  add(conn && conn.bank_account_number);
  return { ibans, numbers };
}

export function bankLinkWarnings(connections, accounts) {
  const byId = new Map();
  (accounts || []).forEach((account) => {
    const id = String(account.id || account._id || "");
    if (id) byId.set(id, account);
  });
  const ibanGroups = new Map();
  const numberGroups = new Map();
  (connections || []).forEach((conn) => {
    const id = String(conn.id || conn._id || "");
    const account = byId.get(String(conn.linked_account_id || ""));
    const refs = connectionRefs(conn, account);
    refs.ibans.forEach((key) => {
      if (!ibanGroups.has(key)) ibanGroups.set(key, new Set());
      ibanGroups.get(key).add(id);
    });
    refs.numbers.forEach((key) => {
      if (!numberGroups.has(key)) numberGroups.set(key, new Set());
      numberGroups.get(key).add(id);
    });
  });
  const warnings = [];
  ibanGroups.forEach((ids, key) => {
    if (ids.size > 1) {
      warnings.push({
        tur: "cift_iban",
        anahtar: key,
        adet: ids.size,
        mesaj: `Aynı IBAN (${key}) ${ids.size} banka bağlantısına bağlı.`,
      });
    }
  });
  numberGroups.forEach((ids, key) => {
    if (ids.size > 1) {
      warnings.push({
        tur: "cift_hesap_no",
        anahtar: key,
        adet: ids.size,
        mesaj: `Aynı hesap no (${key}) ${ids.size} banka bağlantısına bağlı.`,
      });
    }
  });
  const nameGroups = new Map();
  const integrated = new Set(
    (connections || []).map((conn) => String(conn.linked_account_id || "")).filter(Boolean),
  );
  integrated.forEach((id) => {
    const account = byId.get(id);
    if (!account) return;
    const label = String(account.account_name || "").trim();
    const key = label.toLocaleLowerCase("tr-TR");
    if (!key) return;
    if (!nameGroups.has(key)) nameGroups.set(key, { label, ids: [] });
    nameGroups.get(key).ids.push(id);
  });
  nameGroups.forEach((group) => {
    if (group.ids.length > 1) {
      warnings.push({
        tur: "cift_hesap_adi",
        anahtar: group.label,
        adet: group.ids.length,
        mesaj: `Aynı adlı ${group.ids.length} entegre hesap var: ${group.label}.`,
      });
    }
  });
  return warnings;
}
