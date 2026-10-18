/** Sipariş toplama oturumu: "{N} kalem" ve "{X} / {Y} adet toplandı". */
export function pickProgressLabel(progress, itemCount) {
  const fmt = (value) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString("tr-TR");
  };
  const count = Number(itemCount);
  const lines = `${fmt(Number.isFinite(count) ? count : 0)} kalem`;
  const qty = `${fmt(progress?.picked)} / ${fmt(progress?.ordered)} adet toplandı`;
  return { lines, qty, text: `${lines} ${qty}` };
}
