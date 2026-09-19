/** Platform şirket listesi: alt şirketleri bağlı oldukları ana şirketin altına yerleştirir. */

export function parentIdOf(row) {
  if (!row) return null;
  const id = row.id || row._id;
  const explicit = (row.parent_company_id || "").trim();
  if (explicit && explicit !== id) return explicit;
  if (row.is_primary) return null;
  const lid = row.license_id;
  if (lid && lid !== id) return lid;
  return null;
}

export function descendantIds(rows, rootId) {
  const kids = new Map();
  for (const r of rows || []) {
    const pid = parentIdOf(r);
    if (!pid) continue;
    if (!kids.has(pid)) kids.set(pid, []);
    kids.get(pid).push(r.id);
  }
  const out = new Set();
  const stack = [...(kids.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) || []));
  }
  return out;
}

function recency(a, b) {
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

/** Filtrelenmiş satırları ağaç sırasına dizer; ebeveyn listede yoksa çocuk kök olur. */
export function sortCompanyTree(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const children = new Map();
  const roots = [];
  for (const r of list) {
    const pid = parentIdOf(r);
    if (pid && byId.has(pid) && pid !== r.id) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(r);
    } else {
      roots.push(r);
    }
  }
  roots.sort(recency);
  for (const bunch of children.values()) bunch.sort(recency);
  const out = [];
  const walk = (node, depth) => {
    out.push({ ...node, tree_depth: depth });
    for (const ch of children.get(node.id) || []) walk(ch, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
