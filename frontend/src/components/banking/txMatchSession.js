import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../context/AuthContext";

export const UNMATCH_CONFIRM = "Eşleşme geri alınsın mı? Cari/fatura/kasa etkileri iptal edilir.";

/** Eşleşmiş hareketi unmatch etmeden BankMatchModal'a mevcut değerlerle aç. */
export function replaceMatchSession(tx) {
  return { tx, replace: true };
}

/** İlk eşleştirme: replace gönderilmez. */
export function freshMatchSession(tx) {
  return { tx, replace: false };
}

/**
 * Onay sonrası POST /unmatch. Reddedilirse istek yok.
 * @returns {Promise<boolean>} liste yenilenecekse true
 */
export async function confirmAndUnmatch(tx) {
  const txId = tx?.id || tx?._id;
  if (!txId) return false;
  if (!window.confirm(UNMATCH_CONFIRM)) return false;
  try {
    await axios.post(`${API_URL}/banking/transactions/${txId}/unmatch`);
    toast.success("Eşleşme geri alındı.");
    return true;
  } catch (err) {
    toast.error(err.response?.data?.detail || "Eşleşme geri alınamadı.");
    return false;
  }
}
