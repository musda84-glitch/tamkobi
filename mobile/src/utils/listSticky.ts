/** Sticky filtre kaydırınca gizlensin; küçük titreşimde açılıp kapanmasın. */
export function nextStickyFilterHidden(
  hidden: boolean,
  scrollY: number,
  hideAt = 36,
  showAt = 8,
): boolean {
  const y = Number(scrollY) || 0;
  if (hidden) return y > showAt;
  return y > hideAt;
}
