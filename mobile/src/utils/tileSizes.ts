/** Sabit kart + 2 satırlık etiket alanı; tek/çift satır farkı ızgarayı bozmaz. */
export const TILE_SIZES = {
  xs: { height: 68, badge: 26, radius: 10, icon: 14, font: 10, padding: 6, gap: 4, labelHeight: 24 },
  sm: { height: 96, badge: 36, radius: 12, icon: 18, font: 11, padding: 10, gap: 8, labelHeight: 30 },
  md: { height: 116, badge: 46, radius: 16, icon: 22, font: 12, padding: 14, gap: 8, labelHeight: 32 },
} as const;

export type TileSize = keyof typeof TILE_SIZES;
