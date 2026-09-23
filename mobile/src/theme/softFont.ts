export const SOFT_FONT = {
  regular: "Nunito_400Regular",
  medium: "Nunito_500Medium",
  semibold: "Nunito_600SemiBold",
  bold: "Nunito_700Bold",
  extrabold: "Nunito_800ExtraBold",
  black: "Nunito_900Black",
} as const;

export type SoftFontWeight = "400" | "500" | "600" | "700" | "800" | "900" | "normal" | "bold";

const WEIGHT_FACE: Record<string, string> = {
  normal: SOFT_FONT.regular,
  "400": SOFT_FONT.regular,
  "500": SOFT_FONT.medium,
  "600": SOFT_FONT.semibold,
  bold: SOFT_FONT.bold,
  "700": SOFT_FONT.bold,
  "800": SOFT_FONT.extrabold,
  "900": SOFT_FONT.black,
};

export function fontFamilyForWeight(weight?: string | number | null): string {
  const key = String(weight ?? "400");
  return WEIGHT_FACE[key] ?? SOFT_FONT.regular;
}

export function typeface(weight: SoftFontWeight = "400"): { fontFamily: string } {
  return { fontFamily: fontFamilyForWeight(weight) };
}

const KEEP_FAMILY = /ionicon|ionicons|material|fontawesome|awesome|symbol|menlo|mono|courier|notosansmono|ui-monospace/i;

export function shouldReplaceFontFamily(family?: string | null): boolean {
  if (!family) return true;
  return !KEEP_FAMILY.test(String(family));
}
