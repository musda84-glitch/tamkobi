import AsyncStorage from "@react-native-async-storage/async-storage";

/** Yönetici ana ekranı: Genel Bakış (0) veya butonlar (1). Şirket + kullanıcıya özel. */

export type HomeStartPage = "overview" | "tiles";

export function homeStartPageKey(userId: string, companyId: string): string {
  return `tamkobi.home.start_page.v1:${userId}:${companyId}`;
}

/** "tiles" dışı her değer Genel Bakış’tır. */
export function parseHomeStartPage(raw: string | null | undefined): HomeStartPage {
  return raw === "tiles" ? "tiles" : "overview";
}

export function startPageIndex(page: HomeStartPage): number {
  return page === "tiles" ? 1 : 0;
}

export function readHomeStartPage(userId: string, companyId: string): Promise<HomeStartPage> {
  return AsyncStorage.getItem(homeStartPageKey(userId, companyId))
    .catch(() => null)
    .then((raw) => parseHomeStartPage(raw));
}

export function writeHomeStartPage(userId: string, companyId: string, page: HomeStartPage): Promise<unknown> {
  return AsyncStorage.setItem(homeStartPageKey(userId, companyId), page).catch(() => null);
}
