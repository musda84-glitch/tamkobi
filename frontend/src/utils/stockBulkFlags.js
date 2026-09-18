/** Stok listesi toplu B2B / takip güncellemesi — parça parça istek + ilerleme. */

export const BULK_FLAG_CHUNK_SIZE = 200;
export const BULK_FLAG_TIMEOUT_MS = 120000;

export function chunkIds(ids, size = BULK_FLAG_CHUNK_SIZE) {
  const n = Math.max(1, Number(size) || BULK_FLAG_CHUNK_SIZE);
  const list = [...(ids || [])].map((id) => (id == null ? "" : String(id))).filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function bulkProgressPercent(done, total) {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  const d = Math.max(0, Number(done) || 0);
  return Math.min(100, Math.round((d / t) * 100));
}

/**
 * Send flag updates in chunks so ~2000-row selections finish instead of one
 * giant request timing out on the MySQL document store / proxy.
 */
export async function runBulkFlagChunks({
  ids,
  flags,
  companyId,
  postChunk,
  onProgress,
  chunkSize = BULK_FLAG_CHUNK_SIZE,
} = {}) {
  const list = [...(ids || [])].filter(Boolean);
  const chunks = chunkIds(list, chunkSize);
  let matched = 0;
  let modified = 0;
  const succeeded = [];
  let lastError = null;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    onProgress?.({
      done: succeeded.length,
      total: list.length,
      chunk: i + 1,
      chunks: chunks.length,
    });
    try {
      const data = await postChunk({
        ids: chunk,
        company_id: companyId,
        ...(flags || {}),
      });
      matched += Number(data?.matched ?? 0);
      modified += Number(data?.modified ?? 0);
      succeeded.push(...chunk);
      onProgress?.({
        done: succeeded.length,
        total: list.length,
        chunk: i + 1,
        chunks: chunks.length,
      });
    } catch (err) {
      lastError = err;
      break;
    }
  }

  return {
    matched,
    modified,
    succeeded,
    failed: list.length - succeeded.length,
    lastError,
    chunks: chunks.length,
  };
}
