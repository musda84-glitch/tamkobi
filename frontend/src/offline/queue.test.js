import { createMemoryQueue, enqueue, flushQueue } from "./queue";

function netErr() {
  const err = new Error("network");
  err.code = "ERR_NETWORK";
  return err;
}

test("kuyruk sırayı korur", async () => {
  const store = createMemoryQueue();
  const sent = [];
  await enqueue(store, { idempotencyKey: "a", url: "/api/pos/checkout", kind: "pos_checkout", critical: true }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await enqueue(store, { idempotencyKey: "b", url: "/api/orders", kind: "order_create", critical: true }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await flushQueue(store, {
    send: async (item) => { sent.push(item.idempotencyKey); return { ok: true }; },
    sleep: async () => {},
  });
  expect(sent).toEqual(["a", "b"]);
  expect((await store.pending())).toEqual([]);
});

test("ağ hatasında 1-2-4-8 sn bekler ve sonraki işleme geçmez", async () => {
  const store = createMemoryQueue();
  const sleeps = [];
  const sent = [];
  await enqueue(store, { idempotencyKey: "a", url: "/api/pos/checkout", critical: true }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await enqueue(store, { idempotencyKey: "b", url: "/api/orders", critical: true }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await flushQueue(store, {
    send: async (item) => { sent.push(item.idempotencyKey); throw netErr(); },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  expect(sent).toEqual(["a", "a", "a", "a", "a"]);
  const pending = await store.pending();
  expect(pending.map((row) => row.idempotencyKey)).toEqual(["a", "b"]);
});

test("sunucu reddederse işlem kuyruktan düşer ve geri alma çağrılır, sıra sürer", async () => {
  const store = createMemoryQueue();
  const rejected = [];
  const sent = [];
  await enqueue(store, { idempotencyKey: "a", url: "/api/pos/checkout", critical: true, rollback: { stock: 1 } }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await enqueue(store, { idempotencyKey: "b", url: "/api/orders", critical: true }, { online: false, offlineSince: Date.now(), maxMinutes: 10, now: Date.now() });
  await flushQueue(store, {
    send: async (item) => {
      sent.push(item.idempotencyKey);
      if (item.idempotencyKey === "a") {
        const err = new Error("stok");
        err.response = { status: 409, data: { detail: { code: "stock_conflict", message: "Stok yetersiz" } } };
        throw err;
      }
      return { ok: true };
    },
    sleep: async () => {},
    onReject: async (item) => { rejected.push(item.idempotencyKey); },
  });
  expect(sent).toEqual(["a", "b"]);
  expect(rejected).toEqual(["a"]);
  expect(await store.pending()).toEqual([]);
  expect((await store.all()).find((row) => row.idempotencyKey === "a").status).toBe("rejected");
});

test("süre dolunca yeni kritik işlem eklenmez, kuyruk durur", async () => {
  const store = createMemoryQueue();
  const start = 1_000_000;
  await enqueue(store, { idempotencyKey: "keep", url: "/api/pos/checkout", critical: true }, { online: false, offlineSince: start, maxMinutes: 10, now: start + 1000 });
  await expect(enqueue(store, { idempotencyKey: "late", url: "/api/pos/checkout", critical: true }, {
    online: false, offlineSince: start, maxMinutes: 10, now: start + 10 * 60 * 1000,
  })).rejects.toMatchObject({ code: "OFFLINE_EXPIRED" });
  expect((await store.pending()).map((row) => row.idempotencyKey)).toEqual(["keep"]);
});
