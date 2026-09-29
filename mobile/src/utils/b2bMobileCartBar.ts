/** Badge / etiket metinleri — web MobileCartBar ile aynı kurallar. */
export function b2bMobileCartBarCopy(count: number, heldCount = 0): {
  visible: boolean;
  badge: number;
  title: string;
  action: string;
  actionTone: "go" | "held";
} {
  const c = Math.max(0, Number(count) || 0);
  const h = Math.max(0, Number(heldCount) || 0);
  if (c <= 0 && h <= 0) {
    return { visible: false, badge: 0, title: "", action: "", actionTone: "go" };
  }
  if (c > 0) {
    return { visible: true, badge: c, title: "Sepet", action: "Siparişe geç →", actionTone: "go" };
  }
  return { visible: true, badge: h, title: "Bekleyen sepetler", action: "Görüntüle →", actionTone: "held" };
}
