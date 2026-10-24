import { idbReady, sharedDb } from "./db";

export function createDexieQueue(db = sharedDb()) {
  if (!db || !idbReady()) {
    return {
      async add() { throw new Error("IndexedDB yok"); },
      async pending() { return []; },
      async update() { return null; },
    };
  }
  return {
    async add(item) {
      const seq = await db.queue.add({ ...item, status: item.status || "pending" });
      return { ...item, seq, status: "pending" };
    },
    async pending() {
      const rows = await db.queue.where("status").equals("pending").toArray();
      return rows.sort((a, b) => a.seq - b.seq);
    },
    async update(seq, patch) {
      await db.queue.update(seq, patch);
      return db.queue.get(seq);
    },
  };
}
