/** Yazma kuyruğu: sıra korunur, terminal ret geri alınır, ağ hatasında 1-2-4-8 sn. */

import { BACKOFF_MS, criticalBlock } from "./policy";

export function createMemoryQueue() {
  const items = [];
  let seq = 0;
  return {
    async add(item) {
      seq += 1;
      const row = { ...item, seq, status: item.status || "pending" };
      items.push(row);
      return row;
    },
    async pending() {
      return items.filter((row) => row.status === "pending").sort((a, b) => a.seq - b.seq).map((row) => ({ ...row }));
    },
    async update(seqNo, patch) {
      const row = items.find((item) => item.seq === seqNo);
      if (row) Object.assign(row, patch);
      return row ? { ...row } : null;
    },
    async all() {
      return items.map((row) => ({ ...row }));
    },
  };
}

function terminalStatus(err) {
  const status = Number(err?.response?.status || err?.status || 0);
  if (!status) return false;
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

export async function enqueue(store, item, clock = {}) {
  const block = criticalBlock({
    online: clock.online === true,
    offlineSince: clock.offlineSince,
    maxMinutes: clock.maxMinutes,
    now: clock.now,
    critical: !!item.critical,
  });
  if (block) {
    const err = new Error(block.message);
    err.code = block.code;
    err.response = { status: 409, data: { detail: block.message, code: block.code } };
    throw err;
  }
  return store.add({
    idempotencyKey: item.idempotencyKey,
    companyId: item.companyId || "",
    url: item.url,
    body: item.body || {},
    headers: item.headers || {},
    kind: item.kind || "write",
    critical: !!item.critical,
    rollback: item.rollback || null,
    createdAt: item.createdAt || new Date().toISOString(),
  });
}

export async function flushQueue(store, { send, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onReject } = {}) {
  const pending = await store.pending();
  const report = [];
  for (const item of pending) {
    let finished = false;
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
      try {
        const result = await send(item);
        if (result && result.rejected) {
          await store.update(item.seq, { status: "rejected", error: result });
          if (onReject) await onReject(item, result);
          report.push({ seq: item.seq, status: "rejected" });
          finished = true;
          break;
        }
        await store.update(item.seq, { status: "done" });
        report.push({ seq: item.seq, status: "done" });
        finished = true;
        break;
      } catch (err) {
        if (terminalStatus(err)) {
          const error = {
            rejected: true,
            status: err.response?.status,
            detail: err.response?.data?.detail || err.message,
          };
          await store.update(item.seq, { status: "rejected", error });
          if (onReject) await onReject(item, error);
          report.push({ seq: item.seq, status: "rejected" });
          finished = true;
          break;
        }
        if (attempt === BACKOFF_MS.length) break;
        await sleep(BACKOFF_MS[attempt]);
      }
    }
    if (!finished) {
      report.push({ seq: item.seq, status: "pending" });
      break;
    }
  }
  return report;
}
