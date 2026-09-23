export type ConfirmAsk = {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};

export type ConfirmHandler = (ask: ConfirmAsk | null) => void;

let handler: ConfirmHandler | null = null;

export function bindConfirmHost(next: ConfirmHandler | null): void {
  handler = next;
}

export function requestConfirm(
  title: string,
  message: string,
  confirmLabel = "Tamam",
): Promise<boolean> {
  if (handler) {
    return new Promise((resolve) => {
      handler?.({
        title: String(title || "").trim() || "Onay",
        message: String(message || "").trim(),
        confirmLabel: String(confirmLabel || "").trim() || "Tamam",
        resolve,
      });
    });
  }
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return Promise.resolve(window.confirm(message));
  }
  return Promise.resolve(false);
}
