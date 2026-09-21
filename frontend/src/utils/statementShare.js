import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";

const fileSlug = (name) => String(name || "cari").trim().replace(/\s+/g, "-").slice(0, 40) || "cari";

export async function shareStatementLink(contact, { silent = false } = {}) {
  const id = contact?.id || contact?._id;
  if (!id) throw new Error("Cari yok");
  const r = await axios.post(`${API_URL}/contacts/${id}/statement-link`, { base_url: window.location.origin });
  const link = r.data?.link || "";
  if (!link) throw new Error("Link yok");
  if (!silent) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Ekstre linki kopyalandı.", { description: link });
    } catch {
      toast.success("Ekstre linki hazır.", { description: link });
    }
  }
  return link;
}

export async function downloadStatementPdf(contact) {
  const id = contact?.id || contact?._id;
  if (!id) throw new Error("Cari yok");
  const r = await axios.get(`${API_URL}/contacts/${id}/statement.pdf`, { responseType: "blob" });
  const blob = new Blob([r.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ekstre-${fileSlug(contact.name)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Ekstre PDF indirildi.");
}
