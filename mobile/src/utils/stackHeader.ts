/** Nav geçmişi yoksa listeye dön. */
export function headerBackAction(canGoBack: boolean, fallback: string): "back" | string {
  return canGoBack ? "back" : fallback || "/";
}
