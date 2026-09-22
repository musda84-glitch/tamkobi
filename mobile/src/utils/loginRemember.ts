export function emailToRemember(remember: boolean, email: string): string | null {
  const value = (email || "").trim().toLowerCase();
  return remember && value ? value : null;
}
