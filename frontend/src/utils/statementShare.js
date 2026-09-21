import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";

const fileSlug = (name) => String(name || "cari").trim().replace(/\s+/g, "-").slice(0, 40) || "cari";

export async function fetchStatementShare(contact) {
  const id = contact?.id || contact?._id;
  if (!id) throw new Error("Cari yok");
  const r = await axios.post(`${API_URL}/contacts/${id}/statement-link`, { base_url: window.location.origin });
  const link = r.data?.link || "";
  const token = String(link).split("/ekstre/")[1]?.split(/[?#]/)[0] || "";
  let origin = "";
  try { origin = link ? new URL(link).origin : ""; } catch { origin = ""; }
  const pdfUrl = r.data?.pdf_url || (token && origin ? `${origin}/api/public/statements/${token}/pdf` : "");
  if (!link) throw new Error("Link yok");
  return { link, pdfUrl };
}

export async function shareStatementLink(contact, { silent = false } = {}) {
  const { link } = await fetchStatementShare(contact);
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

export async function statementPdfFile(contact) {
  const id = contact?.id || contact?._id;
  if (!id) throw new Error("Cari yok");
  const r = await axios.get(`${API_URL}/contacts/${id}/statement.pdf`, { responseType: "blob" });
  const blob = r.data instanceof Blob ? r.data : new Blob([r.data]);
  const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  return new File([pdf], `ekstre-${fileSlug(contact.name)}.pdf`, { type: "application/pdf" });
}

export async function downloadStatementPdf(contact) {
  const file = await statementPdfFile(contact);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Ekstre PDF indirildi.");
}
