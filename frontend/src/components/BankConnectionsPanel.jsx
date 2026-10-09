
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plug, RefreshCw, Plus, X, Trash2, CheckCircle2, AlertCircle, FlaskConical, Link2, Loader2, Wand2, Settings2, Zap, Undo2, Pencil } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { BankMatchRow } from "./BankMatchRow";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { formatTrAmount } from "../utils/money";
import { matchActorName, matchActorTitle } from "../utils/bankMatchLabel";
import { downloadTextFile, generateJsencryptKeyPair } from "../utils/jsencryptKuveyt";
import { useInfiniteRows } from "../hooks/useInfiniteRows";

/** İlk ekranda DOM'u hafif tut — her satırda eşleştirme kontrolleri var. */
const UNMATCHED_PAGE_INITIAL = 25;
const UNMATCHED_PAGE_STEP = 25;

const LINKABLE_ACCOUNT_TYPES = new Set(["bank", "pos", "okc_pos"]);
const PROVIDER_BANK_HINTS = {
  enpara: ["enpara"],
  kuveytturk: ["kuveyt", "kt"],
  qnb: ["qnb", "finansbank"],
  finfree: ["finfree"],
};

function linkableAccounts(accounts, { currentId, provider } = {}) {
  const hints = PROVIDER_BANK_HINTS[provider] || [];
  const rank = (a) => {
    const hay = `${a.bank_name || ""} ${a.account_name || ""}`.toLowerCase();
    const hintHit = hints.some((h) => hay.includes(h));
    if (a.type === "bank" && hintHit) return 0;
    if (a.type === "bank") return 1;
    if (hintHit) return 2;
    return 3;
  };
  return (accounts || [])
    .filter((a) => {
      const id = a.id || a._id;
      if (!LINKABLE_ACCOUNT_TYPES.has(a.type)) return false;
      if (currentId && id === currentId) return true;
      return !a.is_integrated;
    })
    .sort((a, b) => rank(a) - rank(b) || String(a.bank_name || "").localeCompare(String(b.bank_name || ""), "tr"));
}

function accountOptionLabel(a) {
  const typeLabel = a.type === "pos" ? "POS" : a.type === "okc_pos" ? "ÖKC" : "Banka";
  return `${a.bank_name || "—"} — ${a.account_name || "—"} (${typeLabel})`;
}

const fmt = (n) => formatTrAmount((n || 0));
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const FIELD_LABELS = {
  client_id: "Client ID (Müşteri Id)",
  client_secret: "Client Secret",
  access_token: "Access Token",
  refresh_token: "Refresh Token",
  api_key: "Api Anahtarı (X-Gravitee-Api-Key)",
  private_key: "RSA Private Key (PKCS1 / JSEncrypt)",
  customer_number: "Müşteri Numarası",
  base_url: "API Base URL",
  token_url: "Token URL",
};
const SECRET_FIELDS = ["client_id", "client_secret", "access_token", "refresh_token", "api_key", "private_key"];
const emptySecrets = () => Object.fromEntries(SECRET_FIELDS.map((k) => [k, ""]));
const credentialsOnFile = (c) => SECRET_FIELDS.some((k) => !!c?.[k]);

/** Kuveyt invalid_client / RSA PEM duvar metnini kartta kısa checklist’e çevir. */
function ConnErrorBox({ connection, onEdit }) {
  const err = connection?.last_error || "";
  if (!err) return null;
  const isKuveyt = connection?.provider === "kuveytturk";
  const isEnpara = connection?.provider === "enpara";
  const invalidClient = /invalid_client/i.test(err);
  const signatureInvalid = isKuveyt && /signature\s*invalid|invalid\s*signature|imza\s*(hatası|geçersiz)|Signature Invalid|imza\/yetki/i.test(err);
  const rsaBad = !signatureInvalid && /RSA özel anahtar|RSA anahtarı|PRIVATE KEY|PKCS8|PKCS1|PUBLIC KEY|CERTIFICATE|imza anahtar|2048-bit|JSEncrypt Invalid key|openssl genrsa/i.test(err);
  const kuveytTimeout = isKuveyt && /ReadTimeout|ConnectTimeout|zaman aşımı|süresi aşıldı|gateway zaman aşımı|Identity zaman aşımı/i.test(err);
  const enparaIban = isEnpara && /364737|IBAN veya hesap no|Hesap numarası yada IBAN|26 haneli Enpara IBAN/i.test(err);
  if (enparaIban) {
    return (
      <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1.5" data-testid="conn-last-error-enpara-iban">
        <div className="font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> Enpara IBAN gerekli</div>
        <p className="text-rose-700 leading-snug">
          Enpara artık yalnızca tarih ile ekstre vermiyor. POST /v1/account-statement gövdesinde 26 haneli IBAN (veya hesap no) zorunlu.
        </p>
        <ol className="list-decimal list-inside text-rose-700 space-y-0.5 pl-0.5">
          <li>Hesaplar’da bağlı Enpara hesabının IBAN’ını 26 karakter, boşluksuz yazın.</li>
          <li>Düzenle → Hesap No/IBAN alanına aynı IBAN’ı yapıştırın (TR…).</li>
          <li>Kaydet &amp; Test Et, sonra Senkron.</li>
        </ol>
        {onEdit && (
          <button type="button" onClick={onEdit} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700" data-testid="conn-error-edit-iban-btn">
            <Pencil className="w-3 h-3" /> Düzenle &amp; IBAN gir
          </button>
        )}
        <details className="text-[10px] text-rose-500">
          <summary className="cursor-pointer select-none">Teknik ayrıntı</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-600/90">{err}</pre>
        </details>
      </div>
    );
  }
  if (!isKuveyt || (!invalidClient && !rsaBad && !kuveytTimeout && !signatureInvalid)) {
    return <div className="text-[11px] text-rose-600 bg-rose-50 rounded-lg p-2" data-testid="conn-last-error">{err}</div>;
  }
  if (signatureInvalid && !invalidClient) {
    return (
      <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1.5" data-testid="conn-last-error-kuveyt-signature">
        <div className="font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> İmza hatası (Signature Invalid)</div>
        <p className="text-rose-700 leading-snug">
          TamKobi’deki Private Key, API Market’e yüklediğiniz .crt / Public Key ile eşleşmiyor.
        </p>
        <ol className="list-decimal list-inside text-rose-700 space-y-0.5 pl-0.5">
          <li>Düzenle → <b>JSEncrypt 2048-bit anahtar üret</b> (Private Key forma yazılır).</li>
          <li><b>.crt indir</b> → aynı dosyayı Kuveyt API Market uygulamasına yükleyin.</li>
          <li>Eski Public Key/sertifikayı portalde değiştirin; Private Key’i portala vermeyin.</li>
          <li>Kaydet &amp; Test Et — test GET /v1/fx/rates imzayı doğrular.</li>
        </ol>
        {onEdit && (
          <button type="button" onClick={onEdit} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700" data-testid="conn-error-edit-signature-btn">
            <Pencil className="w-3 h-3" /> Düzenle &amp; anahtar/.crt yenile
          </button>
        )}
        <details className="text-[10px] text-rose-500">
          <summary className="cursor-pointer select-none">Teknik ayrıntı</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-600/90">{err}</pre>
        </details>
      </div>
    );
  }
  if (kuveytTimeout && !invalidClient && !rsaBad) {
    const hostMatch = err.match(/https?:\/\/[^\s,)]+/gi) || [];
    const hosts = [...new Set(hostMatch)].slice(0, 3);
    return (
      <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1.5" data-testid="conn-last-error-kuveyt-timeout">
        <div className="font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> Banka yanıt vermedi (zaman aşımı / IP)</div>
        <p className="text-rose-700 leading-snug">
          Identity veya Gateway zamanında yanıt vermedi. Canlı onay formundaki sunucu IP’si dışından istek gelirse gateway engeller; testleri tanımlı üretim sunucusundan tetikleyin.
        </p>
        {hosts.length > 0 && (
          <p className="text-rose-600 font-mono text-[10px] break-all">Denenen: {hosts.join(" · ")}</p>
        )}
        <ol className="list-decimal list-inside text-rose-700 space-y-0.5 pl-0.5">
          <li>Üretim çıkış IP’sinin Kuveyt API Market / canlı onay whitelist’te olduğunu doğrulayın.</li>
          <li>Mod (Sandbox/Canlı) portal uygulamasıyla aynı olsun.</li>
          <li>Tanımlı sunucu üzerinden Kaydet &amp; Test Et’i tekrar deneyin.</li>
        </ol>
        {onEdit && (
          <button type="button" onClick={onEdit} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700" data-testid="conn-error-edit-timeout-btn">
            <Pencil className="w-3 h-3" /> Düzenle &amp; yeniden dene
          </button>
        )}
        <details className="text-[10px] text-rose-500">
          <summary className="cursor-pointer select-none">Teknik ayrıntı</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-600/90">{err}</pre>
        </details>
      </div>
    );
  }
  if (rsaBad && !invalidClient) {
    const isPublic = /PUBLIC KEY|genel anahtar/i.test(err);
    const isCert = /CERTIFICATE|sertifika/i.test(err);
    return (
      <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1.5" data-testid="conn-last-error-kuveyt-rsa">
        <div className="font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> RSA imza anahtarı okunamadı</div>
        <p className="text-rose-700 leading-snug">
          {isPublic
            ? "Yapıştırılan metin public.pem (PUBLIC KEY). openssl rsa -pubout çıktısı imza için kullanılmaz — private.pem gerekir."
            : isCert
              ? "Yapıştırılan metin sertifika. İmza için PRIVATE KEY PEM gerekir."
              : "RSA Private Key alanı boş, bozuk veya 2048-bit değil. JSEncrypt Invalid key = BEGIN/END satırları eksik."}
        </p>
        <ol className="list-decimal list-inside text-rose-700 space-y-0.5 pl-0.5">
          <li><b>2048-bit anahtar üret</b> veya{" "}
            <a href="https://travistidwell.com/jsencrypt/demo/" target="_blank" rel="noreferrer" className="underline font-semibold">JSEncrypt demo</a>
            {" "}(Key Size 2048) Private Key yapıştırın.
          </li>
          <li>İlk satır <b>-----BEGIN RSA PRIVATE KEY-----</b> olmalı; BEGIN/END satırlarını silmeyin.</li>
          <li><b>Public Key</b> / PUBLIC KEY / sertifika / Api Anahtarı UUID’sini bu alana yapıştırmayın.</li>
          <li>JSEncrypt varsayılan 1024-bit demo anahtarı olmaz — Key Size 2048 (Golive şartı).</li>
          <li>Düzenle → RSA alanını temizleyip yeniden yapıştırın → Kaydet &amp; Test Et.</li>
        </ol>
        {onEdit && (
          <button type="button" onClick={onEdit} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700" data-testid="conn-error-edit-rsa-btn">
            <Pencil className="w-3 h-3" /> Düzenle &amp; RSA anahtarını yenile
          </button>
        )}
        <details className="text-[10px] text-rose-500">
          <summary className="cursor-pointer select-none">Teknik ayrıntı</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-600/90">{err}</pre>
        </details>
      </div>
    );
  }
  const bothHosts = /hem Canlı.*Sandbox|hem Canlı hem Sandbox/i.test(err);
  const modeMismatch = /aynı Müşteri Id\/Secret|Sandbox.*Identity|prep-identity|idprep/i.test(err) && !bothHosts;
  const secretUuid = /secret≈uuid|UUID formatında|secret=api_key/i.test(err);
  const idIsKey = /client_id=api_key|Müşteri Id ile Api Anahtarı aynı/i.test(err);
  return (
    <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1.5" data-testid="conn-last-error-kuveyt">
      <div className="font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> Token alınamadı — invalid_client</div>
      <p className="text-rose-700 leading-snug">
        {bothHosts
          ? "Canlı ve Sandbox Identity aynı kimlikleri reddetti: Müşteri Id / Client Secret portaldeki değerlerle eşleşmiyor."
          : modeMismatch
            ? "Kimlik diğer ortamda çalışıyor olabilir — bağlantı modunu (Canlı/Sandbox) portal uygulamasıyla eşleştirin."
            : "Identity Server Müşteri Id / Client Secret’i kabul etmedi."}
      </p>
      <ol className="list-decimal list-inside text-rose-700 space-y-0.5 pl-0.5">
        <li>Portalden <b>Müşteri Id</b> ve <b>Client Secret</b>’i yeniden kopyalayın (Api Anahtarı değil).</li>
        <li>Canlı uygulama → mod <b>Canlı</b>; test uygulaması → <b>Sandbox</b>.</li>
        {secretUuid && <li className="font-semibold">Kayıtlı Client Secret UUID gibi — Api Anahtarı yanlışlıkla Secret alanına yazılmış olabilir.</li>}
        {idIsKey && <li className="font-semibold">Müşteri Id = Api Anahtarı — alanları karıştırmayın.</li>}
        <li>Düzenle → yapıştır → Kaydet &amp; Test Et.</li>
      </ol>
      {onEdit && (
        <button type="button" onClick={onEdit} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700" data-testid="conn-error-edit-btn">
          <Pencil className="w-3 h-3" /> Düzenle &amp; kimlikleri yenile
        </button>
      )}
      <details className="text-[10px] text-rose-500">
        <summary className="cursor-pointer select-none">Teknik ayrıntı</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-rose-600/90">{err}</pre>
      </details>
    </div>
  );
}

const StatusBadge = ({ status }) => {
  const map = {
    connected: ["bg-emerald-50 text-emerald-700 border-emerald-200", "CANLI BAĞLI", CheckCircle2],
    simulated: ["bg-amber-50 text-amber-700 border-amber-200", "SİMÜLE", FlaskConical],
    error: ["bg-rose-50 text-rose-700 border-rose-200", "HATA", AlertCircle],
    disconnected: ["bg-slate-100 text-slate-600 border-slate-200", "BAĞLI DEĞİL", Plug]
  };
  const [cls, label, Icon] = map[status] || map.disconnected;
  return <span className={`inline-flex items-center gap-1 border rounded-md px-2 py-0.5 text-[10px] font-bold ${cls}`} data-testid={`conn-status-${status}`}><Icon className="w-3 h-3" /> {label}</span>;
};

export const BankConnectionsPanel = ({ companyId, accounts, contacts, onSynced }) => {
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [busy, setBusy] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ provider: "kuveytturk", linked_account_id: "", mode: "live", client_id: "", client_secret: "", access_token: "", refresh_token: "", api_key: "", private_key: "", customer_number: "", bank_account_number: "", base_url: "", auto_sync: true });
  const [editConn, setEditConn] = useState(null);
  const [editForm, setEditForm] = useState({ provider: "enpara", linked_account_id: "", client_id: "", client_secret: "", access_token: "", refresh_token: "", api_key: "", private_key: "", customer_number: "", bank_account_number: "", mode: "live" });
  const [rules, setRules] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState({ pattern: "", contact_id: "", category: "", target_account_id: "" });
  const [invoices, setInvoices] = useState([]);
  const [matched, setMatched] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [genKeyBusy, setGenKeyBusy] = useState(false);
  const [ktPublicPem, setKtPublicPem] = useState("");
  const [ktCrtPem, setKtCrtPem] = useState("");

  const fillJsencryptKey = async (target) => {
    if (genKeyBusy) return;
    setGenKeyBusy(true);
    toast.info("2048-bit RSA üretiliyor… (Web Crypto; genelde 1–3 sn)");
    try {
      const { privateKey, publicKey, certificatePem } = await generateJsencryptKeyPair();
      if (target === "add") setForm((f) => ({ ...f, private_key: privateKey }));
      else setEditForm((f) => ({ ...f, private_key: privateKey }));
      setKtPublicPem(publicKey || "");
      setKtCrtPem(certificatePem || "");
      toast.success("Private Key forma yazıldı. .crt indirip API Market’e yükleyin (Private Key burada kalır).");
    } catch (err) {
      toast.error(err?.message || "RSA anahtar üretilemedi");
    } finally {
      setGenKeyBusy(false);
    }
  };

  const downloadKtCrt = () => {
    if (!ktCrtPem) {
      toast.error(".crt henüz yok — önce anahtar üretin.");
      return;
    }
    downloadTextFile("kuveyt-public.crt", ktCrtPem);
    toast.success("kuveyt-public.crt indirildi — API Market’e yükleyin.");
  };

  const load = useCallback(async () => {
    try {
      const [p, c, u, r, m, sug] = await Promise.all([
        axios.get(`${API_URL}/banking/providers`),
        axios.get(`${API_URL}/banking/connections?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/transactions/unmatched?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/match-rules?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/transactions/matched?company_id=${companyId}&limit=50`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/banking/match-rule-suggestions?company_id=${companyId}`).catch(() => ({ data: [] })),
      ]);
      const unmatchedList = Array.isArray(u.data) ? u.data : [];
      setProviders(p.data);
      setConnections(c.data);
      setUnmatched(unmatchedList);
      setRules(r.data);
      setMatched(m.data);
      setSuggestions(sug.data);
      // Faturalar yalnızca eşleştirme için; büyük listede ilk boyayı bloklamasın.
      if (unmatchedList.length === 0) {
        setInvoices([]);
      } else {
        setTimeout(() => {
          axios.get(`${API_URL}/invoices?company_id=${companyId}&type=all`)
            .then((inv) => setInvoices(Array.isArray(inv.data) ? inv.data : []))
            .catch(() => setInvoices([]));
        }, 0);
      }
    } catch { toast.error("Banka bağlantıları yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const {
    visible: visibleUnmatched,
    hasMore: unmatchedHasMore,
    sentinelRef: unmatchedSentinelRef,
    shown: unmatchedShown,
    total: unmatchedTotal,
  } = useInfiniteRows(unmatched, {
    initial: UNMATCHED_PAGE_INITIAL,
    step: UNMATCHED_PAGE_STEP,
    resetKey: unmatched.length,
  });

  const provider = providers.find((p) => p.code === form.provider);

  const save = async (e) => {
    e.preventDefault();
    const linkables = linkableAccounts(accounts, { provider: form.provider });
    const linked = form.linked_account_id || linkables[0]?.id || linkables[0]?._id;
    if (!linked) {
      toast.error("Bağlanacak banka/POS hesabı seçin. Önce Hesaplar sekmesinden Enpara/Kuveyt hesabı ekleyin.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/banking/connections`, { company_id: companyId, provider_name: "", ...form, linked_account_id: linked });
      toast[res.data.test_result?.ok ? "success" : "error"](res.data.test_result?.message);
      setForm((f) => ({ ...f, ...emptySecrets() }));
      setShowAdd(false); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Bağlantı eklenemedi."); }
  };

  const testConn = async (id) => {
    setBusy(id + "-test");
    try {
      const r = await axios.post(`${API_URL}/banking/connections/${id}/test`);
      if (r.data.ok) toast.success(r.data.message);
      else {
        const msg = String(r.data.message || "Test başarısız.");
        toast.error(/invalid_client/i.test(msg)
          ? "Kuveyt: invalid_client — Müşteri Id / Client Secret’i portalden yeniden yapıştırıp test edin (Api Anahtarı değil)."
          : msg.length > 180 ? `${msg.slice(0, 180)}…` : msg);
      }
      load();
    }
    catch { toast.error("Test başarısız."); } finally { setBusy(null); }
  };

  const sync = async (id) => {
    setBusy(id + "-sync");
    try { const r = await axios.post(`${API_URL}/banking/connections/${id}/sync`); toast.success(r.data.message); load(); onSynced?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Senkronizasyon başarısız."); } finally { setBusy(null); }
  };

  const syncAll = async () => {
    setBusy("all");
    try { const r = await axios.post(`${API_URL}/banking/sync-all?company_id=${companyId}`); toast.success(`${r.data.results.length} bağlantı senkronize edildi.`); load(); onSynced?.(); }
    catch { toast.error("Toplu senkronizasyon başarısız."); } finally { setBusy(null); }
  };

  const openEdit = (c) => {
    setEditConn(c);
    setEditForm({
      provider: c.provider || "enpara",
      linked_account_id: c.linked_account_id || "",
      ...emptySecrets(),
      customer_number: c.customer_number || "",
      bank_account_number: c.bank_account_number || "",
      mode: c.mode || "live",
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editConn) return;
    try {
      const payload = { ...editForm };
      Object.keys(payload).forEach((k) => { if (payload[k] === "" || payload[k] == null) delete payload[k]; });
      SECRET_FIELDS.forEach((k) => {
        if (payload[k] && String(payload[k]).startsWith("••••")) delete payload[k];
      });
      await axios.put(`${API_URL}/banking/connections/${editConn.id}`, payload);
      toast.success("Bağlantı güncellendi.");
      setEditForm((f) => ({ ...f, ...emptySecrets() }));
      setEditConn(null);
      const r = await axios.post(`${API_URL}/banking/connections/${editConn.id}/test`);
      if (r.data.ok) toast.success(r.data.message);
      else {
        const msg = String(r.data.message || "Test başarısız.");
        toast.error(/invalid_client/i.test(msg)
          ? "Kuveyt: invalid_client — Müşteri Id / Client Secret portalle eşleşmiyor. Karttaki adımları izleyin."
          : msg.length > 180 ? `${msg.slice(0, 180)}…` : msg);
      }
      load();
      onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };

  const remove = async (id) => {
    try { await axios.delete(`${API_URL}/banking/connections/${id}`); toast.success("Bağlantı kaldırıldı."); load(); onSynced?.(); } catch { toast.error("Silinemedi."); }
  };

  const acceptSuggestion = async (sg) => {
    try {
      const r = await axios.post(`${API_URL}/banking/match-rule-suggestions/accept`, { company_id: companyId, pattern: sg.pattern, contact_id: sg.contact_id, target_account_id: sg.target_account_id, category: sg.category, apply_now: true });
      toast.success(r.data.message); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kural oluşturulamadı."); }
  };

  const toggleAutoSync = async (c) => {
    try {
      const turningOn = c.auto_sync === false;
      await axios.put(`${API_URL}/banking/connections/${c.id}`, { auto_sync: turningOn });
      toast.success(turningOn
        ? "Arka plan senkronu AKTİF: sunucu her 2 dakikada hareketleri çeker; yeni hareket telefona push gider."
        : "Arka plan senkronu PASİF: yalnızca manuel «Hareketleri Çek» çalışır.");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };

  const toggleAutoMatch = async (c) => {
    try {
      const turningOn = !c.auto_match;
      const r = await axios.put(`${API_URL}/banking/connections/${c.id}`, { auto_match: turningOn });
      if (turningOn) {
        const n = r.data?.auto_matched_now ?? r.data?.auto_matched ?? 0;
        toast.success(r.data?.auto_match_message || r.data?.message || (n
          ? `Otomatik işleme AKTİF: ${n} bekleyen hareket işlendi.`
          : "Otomatik işleme AKTİF: önceki eşleşme veya cari adı varsa hareket işlenir."));
      } else {
        toast.success("Otomatik işleme PASİF: hareketler manuel eşleştirme bekleyecek.");
      }
      load();
      if (turningOn) onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };

  const unmatch = async (tx) => {
    if (!window.confirm("Eşleşme geri alınsın mı? Cari/fatura/kasa etkileri iptal edilir.")) return;
    try { await axios.post(`${API_URL}/banking/transactions/${tx.id}/unmatch`); toast.success("Eşleşme geri alındı."); load(); onSynced?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Geri alınamadı."); }
  };

  const autoMatch = async (useSuggestions) => {
    setBusy("auto");
    try {
      const r = await axios.post(`${API_URL}/banking/transactions/auto-match?company_id=${companyId}&use_suggestions=${useSuggestions}`);
      toast[r.data.matched > 0 ? "success" : "info"](r.data.message); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Otomatik eşleştirme başarısız."); } finally { setBusy(null); }
  };

  const addRule = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/banking/match-rules`, { company_id: companyId, ...newRule, contact_id: newRule.contact_id || null, category: newRule.category || null, target_account_id: newRule.target_account_id || null });
      toast.success("Kural eklendi."); setNewRule({ pattern: "", contact_id: "", category: "", target_account_id: "" }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kural eklenemedi."); }
  };

  const deleteRule = async (id) => {
    try { await axios.delete(`${API_URL}/banking/match-rules/${id}`); load(); } catch { toast.error("Kural silinemedi."); }
  };

  return (
    <div className="space-y-5" data-testid="bank-connections-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600"><Link2 className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Banka Entegrasyonu — Canlı Veri</h2>
            <p className="text-xs text-slate-500">Açık bankacılık API'si ile hesap hareketlerini arka planda (2 dk) çekin; yeni hareket telefona push gider, cari/fatura ile eşleştirin</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncAll} disabled={busy === "all" || !connections.length} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" data-testid="sync-all-btn">{busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Tümünü Senkronize Et</button>
          <button onClick={() => { const linkables = linkableAccounts(accounts, { provider: form.provider }); setForm({ ...form, linked_account_id: linkables[0]?.id || linkables[0]?._id || "" }); setShowAdd(true); }} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="add-bank-connection-btn"><Plus className="w-4 h-4" /> Banka Bağla</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {connections.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm" data-testid={`bank-conn-card-${c.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-slate-900 text-sm">{c.provider_name}</div>
                <div className="text-[11px] text-slate-500">→ {c.linked_account_name}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={c.status} />
                <span className="text-[10px] font-mono text-slate-400 uppercase">{c.mode}</span>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4">
              <span>Son senk: <b className="text-slate-700">{c.last_synced_at ? new Date(c.last_synced_at).toLocaleString("tr-TR") : "—"}</b></span>
              <span>Çekilen: <b className="text-slate-700">{c.synced_count}</b></span>
              {credentialsOnFile(c) ? <span>Kimlik bilgisi <b>sunucuda kayıtlı</b></span> : <span className="text-amber-600 font-semibold">Anahtar girilmedi</span>}
            </div>
            {c.last_error && <ConnErrorBox connection={c} onEdit={() => openEdit(c)} />}
            <button type="button" onClick={() => toggleAutoSync(c)} className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${c.auto_sync !== false ? "bg-sky-50 border-sky-300" : "bg-slate-50 border-slate-200"}`} data-testid={`auto-sync-toggle-${c.id}`} aria-pressed={c.auto_sync !== false}>
              <span className="flex items-center gap-2 text-[11px]"><RefreshCw className={`w-3.5 h-3.5 ${c.auto_sync !== false ? "text-sky-600" : "text-slate-400"}`} /><span><b className={c.auto_sync !== false ? "text-sky-800" : "text-slate-700"}>Arka plan senkron</b> <span className="text-slate-500">— kimlik bilgisi varsa her 2 dakikada otomatik çekilir</span></span></span>
              <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${c.auto_sync !== false ? "bg-sky-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${c.auto_sync !== false ? "left-[18px]" : "left-0.5"}`} /></span>
            </button>
            <button type="button" onClick={() => toggleAutoMatch(c)} className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${c.auto_match ? "bg-violet-50 border-violet-300" : "bg-slate-50 border-slate-200"}`} data-testid={`auto-match-toggle-${c.id}`} aria-pressed={!!c.auto_match}>
              <span className="flex items-center gap-2 text-[11px]"><Zap className={`w-3.5 h-3.5 ${c.auto_match ? "text-violet-600" : "text-slate-400"}`} /><span><b className={c.auto_match ? "text-violet-800" : "text-slate-700"}>Otomatik İşle</b> <span className="text-slate-500">— önceki eşleşme veya cari adı varsa otomatik işle{c.auto_matched_count ? ` (${c.auto_matched_count} işlendi)` : ""}</span></span></span>              <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${c.auto_match ? "bg-violet-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${c.auto_match ? "left-[18px]" : "left-0.5"}`} /></span>
            </button>
            <div className="text-[10px] text-slate-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Bu hesaba manuel gelir/gider/virman girişi kapalıdır; hareketler bankadan gelir.</div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => sync(c.id)} disabled={!!busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50" data-testid={`sync-conn-btn-${c.id}`}>{busy === c.id + "-sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Hareketleri Çek</button>
              <button type="button" onClick={() => testConn(c.id)} disabled={!!busy} className="px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50" data-testid={`test-conn-btn-${c.id}`}>Bağlantıyı Test Et</button>
              <button type="button" onClick={() => openEdit(c)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg text-[11px] font-semibold hover:bg-emerald-100" data-testid={`edit-conn-btn-${c.id}`} title="Sağlayıcı, token ve hesap bilgilerini düzenle"><Pencil className="w-3.5 h-3.5" /> Düzenle</button>
              <button type="button" onClick={() => remove(c.id)} className="ml-auto p-1.5 text-slate-300 hover:text-rose-600" data-testid={`delete-conn-btn-${c.id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {connections.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">Henüz banka bağlantısı yok. "Banka Bağla" ile Kuveyt Türk, Enpara, QNB veya Finfree bağlayın.</div>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-sm font-bold text-slate-900">Eşleştirme Bekleyen Banka Hareketleri</span>
            <span className="ml-2 text-xs text-slate-400" data-testid="unmatched-count">
              {unmatchedTotal} hareket
              {unmatchedTotal > unmatchedShown ? ` · ${unmatchedShown} gösteriliyor` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => autoMatch(true)} disabled={!!busy || !unmatched.length} className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-[11px] font-semibold hover:bg-violet-700 disabled:opacity-50" title="Öğrenilen kurallar, önceki eşleşmeler ve cari adı karşılığıyla otomatik işle" data-testid="auto-match-btn">
              {busy === "auto" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Önceki Eşleşme / Cari ile Otomatik İşle
            </button>
            <button onClick={() => autoMatch(true)} disabled={!!busy || !unmatched.length} className="px-3 py-1.5 border border-violet-200 text-violet-700 rounded-lg text-[11px] font-semibold hover:bg-violet-50 disabled:opacity-50" title="Kurallar + önceki eşleşmeler + cari adı önerilerini uygula" data-testid="auto-match-suggestions-btn">+ Önerileri de Uygula</button>
            <button onClick={() => setShowRules(!showRules)} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50" data-testid="toggle-rules-btn"><Settings2 className="w-3.5 h-3.5" /> Kurallar ({rules.length})</button>
            <button onClick={() => setShowMatched(!showMatched)} className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50 ${showMatched ? "bg-slate-900 text-white border-slate-900" : ""}`} data-testid="toggle-matched-btn"><CheckCircle2 className="w-3.5 h-3.5" /> Eşleşenler ({matched.length})</button>
          </div>
        </div>
        {showMatched && (
          <div className="border-b border-slate-100 max-h-72 overflow-auto" data-testid="matched-list">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold"><tr><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Açıklama</th><th className="px-4 py-2">Eşleşme</th><th className="px-4 py-2">Yol</th><th className="px-4 py-2">Kullanıcı</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {matched.length === 0 && <tr><td colSpan={7} className="px-4 py-4 text-center text-slate-400">Henüz eşleştirilmiş hareket yok.</td></tr>}
                {matched.map((t) => (
                  <tr key={t.id} data-testid={`matched-tx-${t.id}`}>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{t.date}</td>
                    <td className="px-4 py-1.5">{t.description}</td>
                    <td className="px-4 py-1.5 font-semibold text-slate-800">{t.contact_name || t.target_account_name || t.category}{t.related_invoice_number ? <span className="text-slate-400 font-normal"> · {t.related_invoice_number}</span> : ""}{t.target_account_name ? <span className="text-indigo-600 font-normal"> (virman)</span> : ""}</td>
                    <td className="px-4 py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${t.matched_via === "auto" ? "bg-violet-100 text-violet-700" : t.matched_via === "rule" ? "bg-indigo-100 text-indigo-700" : t.matched_via === "suggestion" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>{t.matched_via === "auto" ? "OTOMATİK" : t.matched_via === "rule" ? "KURAL" : t.matched_via === "suggestion" ? "ÖNERİ" : "MANUEL"}</span></td>
                    <td className="px-4 py-1.5 text-slate-700" title={matchActorTitle(t)} data-testid={`matched-by-${t.id}`}>{matchActorName(t) || "—"}</td>
                    <td className={`px-4 py-1.5 text-right font-bold ${t.type === "inflow" ? "text-emerald-600" : "text-rose-600"}`}>{t.type === "inflow" ? "+" : "-"}{fmt(t.amount)} ₺</td>
                    <td className="px-4 py-1.5"><button onClick={() => unmatch(t)} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-rose-600" data-testid={`unmatch-btn-${t.id}`}><Undo2 className="w-3 h-3" /> Geri al</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-100 text-xs space-y-1.5" data-testid="rule-suggestions">
            <div className="font-bold text-amber-900 flex items-center gap-1.5"><Wand2 className="w-3.5 h-3.5" /> {suggestions.length} kural önerisi — aynı açıklama kalıbıyla tekrar eden eşleşmeler</div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((sg) => (
                <div key={sg.pattern} className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl px-3 py-1.5" data-testid={`rule-suggestion-${sg.pattern.replace(/\s+/g, "-")}`}>
                  <div><div className="font-mono text-[11px] text-slate-800">"{sg.pattern}"</div><div className="text-[10px] text-slate-500">{sg.count}× → {[sg.contact_name, sg.target_account_name ? `${sg.target_account_name} (virman)` : null, sg.category].filter(Boolean).join(" · ")}{!sg.consistent && <span className="text-rose-600"> · farklı eşleşmeler var</span>}</div></div>
                  <button onClick={() => acceptSuggestion(sg)} className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-[11px] font-semibold hover:bg-violet-700 whitespace-nowrap" data-testid={`rule-suggestion-accept-${sg.pattern.replace(/\s+/g, "-")}`}>Kural yap</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {showRules && (
          <div className="px-5 py-3 bg-violet-50/40 border-b border-violet-100 space-y-2 text-xs" data-testid="match-rules-panel">
            <p className="text-[11px] text-slate-500">Her manuel eşleştirme otomatik kural olarak öğrenilir. İsterseniz anahtar kelime → cari/kategori kuralı da ekleyebilirsiniz.</p>
            <form onSubmit={addRule} className="flex flex-wrap gap-2 items-center">
              <input value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} placeholder="Anahtar kelime (örn: trendyol)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" required data-testid="rule-pattern-input" />
              <select value={newRule.contact_id} onChange={(e) => setNewRule({ ...newRule, contact_id: e.target.value })} className="bg-white border border-slate-200 rounded-lg p-1.5 w-44" data-testid="rule-contact-select"><option value="">Cari (opsiyonel)</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input value={newRule.category} onChange={(e) => setNewRule({ ...newRule, category: e.target.value })} placeholder="Kategori (örn: Pazaryeri Hakediş)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" data-testid="rule-category-input" />
              <PaymentTargetSelect companyId={companyId} accounts={accounts.filter((a) => !a.is_integrated)} value={newRule.target_account_id} onChange={(v) => setNewRule({ ...newRule, target_account_id: v })} testId="rule-target-select" excludeIntegrated includePartners emptyLabel="Kasa/Hesap/Ortak virman (ops.)" className="w-52" />              <button type="submit" className="px-3 py-1.5 bg-violet-600 text-white rounded-lg font-semibold" data-testid="add-rule-btn">Kural Ekle</button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {rules.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 bg-white border border-violet-200 rounded-md px-2 py-1 text-[11px]" data-testid={`rule-chip-${r.id}`}>
                  <b className="font-mono text-violet-800">"{r.pattern}"</b> → {[r.contact_name, r.target_account_name ? `${r.target_account_name} (virman)` : null, r.category].filter(Boolean).join(" · ") || "—"} <span className="text-slate-400">({r.hits}x)</span>
                  <button onClick={() => deleteRule(r.id)} className="text-slate-300 hover:text-rose-600"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {rules.length === 0 && <span className="text-slate-400">Henüz öğrenilmiş kural yok.</span>}
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold">
              <tr><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Hesap</th><th className="px-4 py-2">Açıklama</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2">Eşleştirme (Cari / Fatura / Kasa / Kategori)</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="unmatched-tx-tbody">
              {unmatched.length === 0 && <tr><td colSpan={6} className="px-4 py-5 text-center text-slate-400">Eşleştirme bekleyen hareket yok.</td></tr>}
              {visibleUnmatched.map((t) => (
                <BankMatchRow
                  key={t.id}
                  tx={t}
                  contacts={contacts}
                  accounts={accounts}
                  invoices={invoices}
                  companyId={companyId}
                  onDone={() => { load(); onSynced?.(); }}
                />
              ))}
              {unmatchedHasMore && (
                <tr data-testid="unmatched-load-more">
                  <td colSpan={6} className="px-4 py-3 text-center text-[11px] text-slate-500" ref={unmatchedSentinelRef}>
                    Daha fazla hareket yükleniyor… ({unmatchedShown} / {unmatchedTotal})
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="add-bank-connection-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Banka Bağlantısı Ekle</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-3 text-xs">
              <div><label className="block font-semibold mb-1">Sağlayıcı</label>
                <select className={inputCls} value={form.provider} onChange={(e) => {
                  const next = e.target.value;
                  const linkables = linkableAccounts(accounts, { provider: next });
                  setForm({ ...form, provider: next, linked_account_id: linkables[0]?.id || linkables[0]?._id || "" });
                }} data-testid="conn-provider-select">{providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
                {provider?.docs && <a href={provider.docs} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 hover:underline">Geliştirici portalı: {provider.docs}</a>}
                {provider?.hint && <p className="text-[10px] text-slate-500 mt-1">{provider.hint}</p>}
                {provider?.live_url && <p className="text-[10px] font-mono text-slate-400 mt-0.5">API: {provider.live_url}</p>}
              </div>
              <div><label className="block font-semibold mb-1">Bağlanacak Hesap (TamKobi)</label>
                <select className={inputCls} value={form.linked_account_id} onChange={(e) => setForm({ ...form, linked_account_id: e.target.value })} required data-testid="conn-account-select">
                  <option value="">Hesap seçin…</option>
                  {linkableAccounts(accounts, { provider: form.provider }).map((a) => <option key={a.id || a._id} value={a.id || a._id}>{accountOptionLabel(a)}</option>)}
                </select>
                <p className="text-[10px] text-amber-700 mt-1">Banka hesabı seçin (POS de mümkün). Bağlanan hesapta Hesaplar sekmesinde ENTEGRE rozeti görünür. Enpara için Enpara banka hesabı oluşturmanız önerilir.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, mode: "sandbox" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "sandbox" ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid="conn-mode-sandbox">Sandbox / Test</button>
                <button type="button" onClick={() => setForm({ ...form, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="conn-mode-live">Canlı</button>
              </div>
              {(provider?.fields || []).filter((f) => form.provider !== "kuveytturk" || !["access_token", "refresh_token", "customer_number", "scope"].includes(f)).map((f) => (
                <div key={f}>
                  <label className="block font-semibold mb-1">{FIELD_LABELS[f] || f}{" "}
                    <span className="text-slate-400 font-normal">
                      {f === "access_token" ? "(hareket için müşteri token)" : f === "refresh_token" ? "(token yenileme)" : f === "private_key" ? "(JSEncrypt Private Key — Public Key değil)" : f === "api_key" ? "(X-Gravitee — token değil)" : form.provider === "kuveytturk" ? "" : "(opsiyonel — boşsa simüle)"}
                    </span>
                  </label>
                  {f === "private_key" ? (
                    <>
                      <textarea className={`${inputCls} font-mono min-h-[88px]`} value={form[f] || ""} onChange={(e) => setForm({ ...form, [f]: e.target.value })} data-testid={`conn-field-${f}`} autoComplete="off" placeholder={"-----BEGIN RSA PRIVATE KEY-----\n(JSEncrypt demo / getPrivateKey — Public Key değil)\n-----END RSA PRIVATE KEY-----"} spellCheck={false} />
                      {form.provider === "kuveytturk" && (
                        <div className="mt-1 space-y-1">
                          <button type="button" onClick={() => fillJsencryptKey("add")} disabled={genKeyBusy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-white font-semibold hover:bg-slate-700 disabled:opacity-50" data-testid="conn-jsencrypt-generate-btn">
                            {genKeyBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} {genKeyBusy ? "Üretiliyor…" : "2048-bit RSA anahtar üret"}
                          </button>
                          <p className="text-[10px] text-slate-500">
                            PKCS1 Private Key (JSEncrypt <code className="font-mono">signSha256</code> /{" "}
                            <a href="https://github.com/KuveytTurk/SignatureGenerator2048" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">SignatureGenerator2048</a>
                            {" "}uyumlu, 2048-bit). Private Key burada; eşleşen <b>.crt</b> API Market’e yüklenir.
                            Alternatif:{" "}
                            <a href="https://travistidwell.com/jsencrypt/demo/" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">JSEncrypt demo</a>.
                          </p>
                          {ktPublicPem && (
                            <div className="mt-1 space-y-1" data-testid="conn-jsencrypt-public-box">
                              <label className="block font-semibold text-slate-700">Portal Public Key / .crt</label>
                              <textarea className={`${inputCls} font-mono min-h-[72px]`} readOnly value={ktCrtPem || ktPublicPem} data-testid="conn-jsencrypt-public-pem" />
                              <div className="flex flex-wrap gap-1">
                                <button type="button" className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold disabled:opacity-50" onClick={downloadKtCrt} disabled={!ktCrtPem} data-testid="conn-jsencrypt-download-crt-btn">.crt indir</button>
                                <button type="button" className="px-2 py-1 rounded-md border text-[10px] font-semibold" onClick={() => { navigator.clipboard?.writeText(ktPublicPem); toast.success("Public Key kopyalandı."); }} data-testid="conn-jsencrypt-copy-public-btn">Public Key kopyala</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <input type={SECRET_FIELDS.includes(f) ? "password" : "text"} className={`${inputCls} font-mono`} value={form[f] || ""} onChange={(e) => setForm({ ...form, [f]: e.target.value })} data-testid={`conn-field-${f}`} autoComplete="new-password" />
                  )}
                </div>
              ))}
              <div><label className="block font-semibold mb-1">Banka Hesap No / IBAN <span className="text-slate-400 font-normal">{form.provider === "kuveytturk" ? "(Kuveyt: ek no veya IBAN)" : form.provider === "enpara" ? "(Enpara: 26 haneli IBAN — zorunlu)" : "(opsiyonel)"}</span></label><input className={`${inputCls} font-mono`} value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} data-testid="conn-field-bank-account" placeholder={form.provider === "kuveytturk" ? "Örn. 1 veya TR… IBAN" : form.provider === "enpara" ? "TR… 26 karakter, boşluksuz" : ""} /></div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.auto_sync} onChange={(e) => setForm({ ...form, auto_sync: e.target.checked })} data-testid="conn-auto-sync" /><span className="font-semibold">Arka planda otomatik senkron (2 dk)</span></label>
              <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-bank-connection-btn">Bağla & Test Et</button></div>
            </form>
          </div>
        </div>
      )}

      {editConn && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="edit-bank-connection-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Pencil className="w-4 h-4 text-emerald-600" /> Bağlantıyı Düzenle</h3>
              <button type="button" onClick={() => setEditConn(null)} className="text-slate-400" data-testid="edit-conn-close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-slate-500">Mevcut: <b>{editConn.provider_name}</b> → {editConn.linked_account_name}</p>
            {editForm.provider === "enpara" && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Portal uçları: <code className="font-mono">POST /v1/account-statement</code> JSON gövde <code className="font-mono">startDateTime</code>/<code className="font-mono">endDateTime</code>, <code className="font-mono">/ticket</code>, <code className="font-mono">/list</code>.
                Yapıştırın: <b>Access Token</b>, <b>Refresh Token</b>, <b>Client ID</b> (sunucuda saklanır, listede görünmez). Client Secret opsiyonel.
                401 access_denied genelde IP listesi — production çıkış 85.95.240.136 ve 85.95.240.184 portala ekli olmalı (405 METHOD NOT ALLOWED IP değildir). IBAN 26 karakter zorunlu (resultCode 364737).
              </p>
            )}
            {editForm.provider === "kuveytturk" && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5" data-testid="kuveyt-edit-hint">
                <p>
                  Canlı:{" "}
                  <a href="https://identity.kuveytturk.com.tr" target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">identity.kuveytturk.com.tr</a>
                  {" "}(token) ·{" "}
                  <a href="https://gateway.kuveytturk.com.tr" target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">gateway.kuveytturk.com.tr</a>
                  {" "}(API). Prep/test:{" "}
                  <a href="https://prep-identity.kuveytturk.com.tr" target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">prep-identity</a>
                  {" · "}
                  <a href="https://prep-gateway.kuveytturk.com.tr" target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">prep-gateway</a>.
                </p>
                <p data-testid="kuveyt-golive-links">
                  Golive kaynakları:{" "}
                  <a href="https://developer.kuveytturk.com.tr/" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">API Market</a>
                  {" · "}
                  <a href="https://developer.kuveytturk.com.tr/documentation" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Dokümantasyon</a>
                  {" · "}
                  <a href="https://github.com/KuveytTurk/SignatureGenerator2048" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">SignatureGenerator2048</a>
                  {" · "}
                  <a href="https://travistidwell.com/jsencrypt/demo/" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">JSEncrypt demo</a>
                  {" · "}
                  <a href="https://developer.kuveytturk.com.tr/contactus" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">İletişim</a>
                  {" "}(<a href="mailto:apiekibi@kuveytturk.com.tr" className="text-indigo-700 hover:underline">apiekibi@kuveytturk.com.tr</a>)
                </p>
                <p>
                  Abonelik: <code className="font-mono">GET /v1/fx/rates</code> (bağlantı testi),{" "}
                  <code className="font-mono">GET /v3/accounts/&#123;ekNo&#125;/transactions</code> (hesap hareketleri),{" "}
                  <code className="font-mono">POST /v1/vpos/getMerchantOrderDetail</code>.
                  EFT/Havale ve <code className="font-mono">non3DPayment</code> otomatik çağrılmaz.
                </p>
                <ol className="list-decimal list-inside space-y-0.5 text-amber-900" data-testid="kuveyt-live-checklist">
                  <li><b>İmza:</b> Private Key (.pem) burada; eşleşen <b>.crt</b> API Market’te olmalı — aksi halde Signature Invalid. SHA256RSA(PrivateKey, AccessToken, GET ?query | POST body).</li>
                  <li><b>IP:</b> Canlı onay formundaki sunucu IP’sinden test edin; diğer IP’ler gateway tarafından engellenir.</li>
                  <li><b>Scope:</b> Hesap hareketi token’ı <code className="font-mono">grant_type=client_credentials&amp;scope=accounts</code> (client_credentials; kullanıcı girişi gerekmez). Invalid Scope = Accounts aboneliği yok veya Test/Prep host’a canlı kimlik gönderilmiş.</li>
                  <li><b>Hesap ek no:</b> Path <code className="font-mono">/v3/accounts/&#123;suffix&#125;/transactions</code> — müşteri numarası değil, hesap ek no (suffix).</li>
                  <li><b>GoLive:</b> API Market → Uygulamalar → GoLive Talep Yönetimi → +Yeni Talep (yetkili kurumsal kullanıcı adı / müşteri no).</li>
                </ol>
              </div>
            )}
            <form onSubmit={saveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Sağlayıcı</label>
                <select className={inputCls} value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} data-testid="edit-conn-provider">
                  {providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Bağlı TamKobi Hesabı</label>
                <select className={inputCls} value={editForm.linked_account_id} onChange={(e) => setEditForm({ ...editForm, linked_account_id: e.target.value })} data-testid="edit-conn-account" required>
                  {linkableAccounts(accounts, { currentId: editConn.linked_account_id, provider: editForm.provider }).map((a) => (
                    <option key={a.id || a._id} value={a.id || a._id}>{accountOptionLabel(a)}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Hesaplar sekmesinde bu hesapta <b>ENTEGRE</b> rozeti görünür (Kuveyt örneği gibi). Enpara bağlantısını Enpara banka hesabına bağlayın.</p>
              </div>
              {editForm.provider === "enpara" ? (
                <>
                  <div><label className="block font-semibold mb-1">Access Token <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><textarea className={`${inputCls} font-mono min-h-[72px]`} value={editForm.access_token} onChange={(e) => setEditForm({ ...editForm, access_token: e.target.value })} data-testid="edit-conn-access-token" autoComplete="off" placeholder="Yeni token yapıştırın — mevcut değer sunucuda kalır" /></div>
                  <div><label className="block font-semibold mb-1">Refresh Token <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><textarea className={`${inputCls} font-mono min-h-[56px]`} value={editForm.refresh_token} onChange={(e) => setEditForm({ ...editForm, refresh_token: e.target.value })} data-testid="edit-conn-refresh-token" autoComplete="off" placeholder="Yeni refresh token — boşsa değişmez" /></div>
                  <div><label className="block font-semibold mb-1">Client ID <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.client_id} onChange={(e) => setEditForm({ ...editForm, client_id: e.target.value })} data-testid="edit-conn-client-id" autoComplete="new-password" placeholder="Kayıtlıysa boş bırakın" /></div>
                  <div><label className="block font-semibold mb-1">Client Secret <span className="text-slate-400 font-normal">(opsiyonel — boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.client_secret} onChange={(e) => setEditForm({ ...editForm, client_secret: e.target.value })} data-testid="edit-conn-client-secret" autoComplete="new-password" /></div>
                  <div><label className="block font-semibold mb-1">API Key <span className="text-slate-400 font-normal">(opsiyonel — X-Gravitee-Api-Key, boşsa değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.api_key} onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })} data-testid="edit-conn-api-key" autoComplete="new-password" /></div>
                </>
              ) : (
                <>
                  <div><label className="block font-semibold mb-1">Client ID <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.client_id} onChange={(e) => setEditForm({ ...editForm, client_id: e.target.value })} data-testid="edit-conn-client-id" autoComplete="new-password" placeholder="Kayıtlıysa boş bırakın" /></div>
                  <div><label className="block font-semibold mb-1">Client Secret <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.client_secret} onChange={(e) => setEditForm({ ...editForm, client_secret: e.target.value })} data-testid="edit-conn-client-secret" autoComplete="new-password" /></div>
                  {editForm.provider === "kuveytturk" ? (
                    <>
                      <div><label className="block font-semibold mb-1">Api Anahtarı <span className="text-slate-400 font-normal">(X-Gravitee-Api-Key — boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.api_key} onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })} data-testid="edit-conn-api-key" autoComplete="new-password" placeholder="Portal Api Anahtarı UUID" /></div>
                      <div>
                        <label className="block font-semibold mb-1">RSA Private Key (JSEncrypt PKCS1) <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label>
                        <textarea className={`${inputCls} font-mono min-h-[88px]`} value={editForm.private_key} onChange={(e) => setEditForm({ ...editForm, private_key: e.target.value })} data-testid="edit-conn-private-key" autoComplete="off" placeholder={"-----BEGIN RSA PRIVATE KEY-----\n(JSEncrypt getPrivateKey — PUBLIC KEY değil)\n-----END RSA PRIVATE KEY-----"} spellCheck={false} />
                        <div className="mt-1 space-y-1">
                          <button type="button" onClick={() => fillJsencryptKey("edit")} disabled={genKeyBusy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-white font-semibold hover:bg-slate-700 disabled:opacity-50" data-testid="edit-jsencrypt-generate-btn">
                            {genKeyBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} {genKeyBusy ? "Üretiliyor…" : "2048-bit RSA anahtar üret"}
                          </button>
                          <p className="text-[10px] text-slate-500">
                            İmza <code className="font-mono">JSEncrypt.signSha256</code> (
                            <a href="https://github.com/travist/jsencrypt" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">github.com/travist/jsencrypt</a>
                            , Golive SHA256RSA). Private Key bu alanda kalır; <b>.crt indir</b> → API Market’e yükleyin.
                            Araç:{" "}
                            <a href="https://github.com/KuveytTurk/SignatureGenerator2048" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">SignatureGenerator2048</a>.
                          </p>
                          {ktPublicPem && (
                            <div className="mt-1 space-y-1" data-testid="edit-jsencrypt-public-box">
                              <label className="block font-semibold text-slate-700">Portal .crt (Public Key sertifikası)</label>
                              <textarea className={`${inputCls} font-mono min-h-[72px]`} readOnly value={ktCrtPem || ktPublicPem} data-testid="edit-jsencrypt-public-pem" />
                              <div className="flex flex-wrap gap-1">
                                <button type="button" className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold disabled:opacity-50" onClick={downloadKtCrt} disabled={!ktCrtPem} data-testid="edit-jsencrypt-download-crt-btn">.crt indir</button>
                                <button type="button" className="px-2 py-1 rounded-md border text-[10px] font-semibold" onClick={() => { navigator.clipboard?.writeText(ktPublicPem); toast.success("Public Key kopyalandı."); }} data-testid="edit-jsencrypt-copy-public-btn">Public Key kopyala</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div><label className="block font-semibold mb-1">Access Token <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><textarea className={`${inputCls} font-mono min-h-[72px]`} value={editForm.access_token} onChange={(e) => setEditForm({ ...editForm, access_token: e.target.value })} data-testid="edit-conn-access-token" autoComplete="off" placeholder="Yeni token — boşsa değişmez" /></div>
                      <div><label className="block font-semibold mb-1">Refresh Token <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><textarea className={`${inputCls} font-mono min-h-[56px]`} value={editForm.refresh_token} onChange={(e) => setEditForm({ ...editForm, refresh_token: e.target.value })} data-testid="edit-conn-refresh-token" autoComplete="off" /></div>
                    </>
                  )}
                </>
              )}
              {editForm.provider !== "kuveytturk" && (
                <div><label className="block font-semibold mb-1">Müşteri No</label><input className={`${inputCls} font-mono`} value={editForm.customer_number} onChange={(e) => setEditForm({ ...editForm, customer_number: e.target.value })} data-testid="edit-conn-customer" /></div>
              )}
              <div><label className="block font-semibold mb-1">Hesap No / IBAN {editForm.provider === "enpara" ? <span className="text-rose-600">(Enpara hareket için gerekli)</span> : editForm.provider === "kuveytturk" ? <span className="text-slate-500 font-normal">(ek no veya IBAN)</span> : <span className="text-slate-400 font-normal">(opsiyonel)</span>}</label>
                <input className={`${inputCls} font-mono`} value={editForm.bank_account_number} onChange={(e) => setEditForm({ ...editForm, bank_account_number: e.target.value })} data-testid="edit-conn-iban" placeholder={editForm.provider === "kuveytturk" ? "Örn. 1 veya TR… IBAN" : "TR… veya hesap no"} autoComplete="off" />
                <p className="text-[10px] text-slate-500 mt-1">{editForm.provider === "kuveytturk" ? "Hareket: GET /v3/accounts/{ekNo}/transactions (beginDate, endDate, itemCount; yanıt accountActivities). v4/v1 yok. Bağlantı testi GET /v1/fx/rates. Boşsa bağlı hesabın IBAN’ı / ek no kullanılır." : editForm.provider === "enpara" ? "Enpara resultCode 364737: IBAN veya hesap no zorunlu. 26 karakter, boşluksuz. Boşsa bağlı TamKobi hesabının IBAN’ı kopyalanır." : "Boşsa bağlı TamKobi hesabının IBAN’ı kullanılır."}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setEditForm({ ...editForm, mode: "sandbox" })} className={`p-2 rounded-lg border font-semibold ${editForm.mode === "sandbox" ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid="edit-conn-mode-sandbox">Sandbox</button>
                <button type="button" onClick={() => setEditForm({ ...editForm, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${editForm.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="edit-conn-mode-live">Canlı</button>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={() => setEditConn(null)} className="px-3 py-1.5 border rounded-lg">İptal</button>
                <button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-edit-conn-btn">Kaydet & Test Et</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
