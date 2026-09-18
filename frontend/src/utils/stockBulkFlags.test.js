import {
  BULK_FLAG_CHUNK_SIZE,
  bulkProgressPercent,
  chunkIds,
  formatElapsed,
  runBulkFlagChunks,
} from "./stockBulkFlags";

describe("chunkIds", () => {
  test("splits 1883 ids into 200-sized chunks", () => {
    const ids = Array.from({ length: 1883 }, (_, i) => `p${i}`);
    const chunks = chunkIds(ids, 200);
    expect(chunks).toHaveLength(10);
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[8]).toHaveLength(200);
    expect(chunks[9]).toHaveLength(83);
    expect(chunks.flat()).toHaveLength(1883);
    expect(BULK_FLAG_CHUNK_SIZE).toBe(200);
  });

  test("drops empty ids and keeps a single remainder chunk", () => {
    expect(chunkIds(["a", "", null, "b"], 10)).toEqual([["a", "b"]]);
    expect(chunkIds([], 200)).toEqual([]);
  });
});

describe("formatElapsed / bulkProgressPercent", () => {
  test("formats elapsed as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1000)).toBe("0:01");
    expect(formatElapsed(65000)).toBe("1:05");
    expect(formatElapsed(12 * 60 * 1000 + 3000)).toBe("12:03");
  });

  test("progress percent is 0–100", () => {
    expect(bulkProgressPercent(0, 1883)).toBe(0);
    expect(bulkProgressPercent(200, 1883)).toBe(11);
    expect(bulkProgressPercent(1883, 1883)).toBe(100);
    expect(bulkProgressPercent(50, 0)).toBe(0);
  });
});

describe("runBulkFlagChunks", () => {
  test("posts each chunk and reports running totals", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
    const calls = [];
    const progress = [];
    const posted = await runBulkFlagChunks({
      ids,
      flags: { show_in_b2b: false },
      companyId: "comp_1",
      chunkSize: 200,
      onProgress: (p) => progress.push({ ...p }),
      postChunk: async (body) => {
        calls.push(body);
        return { matched: body.ids.length, modified: body.ids.length };
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls[0].ids).toHaveLength(200);
    expect(calls[1].ids).toHaveLength(200);
    expect(calls[2].ids).toHaveLength(50);
    expect(calls[0].show_in_b2b).toBe(false);
    expect(calls[0].company_id).toBe("comp_1");
    expect(posted.succeeded).toHaveLength(450);
    expect(posted.matched).toBe(450);
    expect(posted.modified).toBe(450);
    expect(posted.failed).toBe(0);
    expect(posted.lastError).toBeNull();
    expect(progress.some((p) => p.done === 0 && p.total === 450)).toBe(true);
    expect(progress.some((p) => p.done === 200 && p.chunk === 1)).toBe(true);
    expect(progress[progress.length - 1]).toMatchObject({ done: 450, total: 450, chunks: 3 });
  });

  test("stops on failure and keeps earlier successes", async () => {
    const ids = ["a", "b", "c", "d"];
    const posted = await runBulkFlagChunks({
      ids,
      flags: { track_stock: true },
      companyId: "c1",
      chunkSize: 2,
      postChunk: async (body) => {
        if (body.ids.includes("c")) throw new Error("timeout");
        return { matched: 2, modified: 2 };
      },
    });
    expect(posted.succeeded).toEqual(["a", "b"]);
    expect(posted.failed).toBe(2);
    expect(posted.lastError).toBeInstanceOf(Error);
    expect(posted.lastError.message).toBe("timeout");
  });
});
