import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import {
  filterPartnerTxs,
  partnerBalanceMeta,
  partnerCardCashFlow,
  partnerCardTone,
  partnerTxEffect,
  partnerTxLabel,
  partnerTxSign,
  type BankAccount,
  type Partner,
  type PartnerTx,
} from "../utils/finance";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { B2BSheet } from "./b2b/B2BSheet";
import { confirmAction } from "./chips";
import { ErrorBanner, Field, Muted, PrimaryButton } from "./kit";
import { MoneyInput } from "./MoneyInput";
import { PartnerAvatar } from "./PartnerAvatar";
import { PartnerTxSheet, PARTNER_TX_KIND_LABEL, type PartnerTxKind } from "./PartnerTxSheet";

type LedgerRow = {
  drift?: boolean;
  stored?: number;
  ledger?: number;
  count?: number;
  netMatchesCard?: boolean;
};

const ACTIONS: { key: PartnerTxKind; filled: boolean; color: string }[] = [
  { key: "capital_in", filled: true, color: "#059669" },
  { key: "withdrawal", filled: true, color: "#E11D48" },
  { key: "credit", filled: false, color: "#E11D48" },
  { key: "debit", filled: false, color: "#BE123C" },
];

function salaryText(value?: number | null): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return fmtMoney(n);
}

function ledgerLine(row: LedgerRow): { text: string; color: string } {
  if (row.drift) {
    const stored = partnerBalanceMeta(row.stored).display;
    const movement = partnerBalanceMeta(row.ledger).display;
    return {
      text: `Sapma: kayıtlı ${fmtMoney(stored)} ≠ hareket ${fmtMoney(movement)}`,
      color: "#E11D48",
    };
  }
  return { text: "✓ Bakiye hareketlerle uyumlu", color: "#059669" };
}

function effectColor(tx: PartnerTx): string {
  const side = partnerTxEffect(tx).side;
  if (side === "giris") return "#059669";
  if (side === "cikis") return "#E11D48";
  return colors.text;
}

export function PartnerDetail({
  partner,
  accounts,
  txs,
  partners,
  onBack,
  onExpense,
  onChanged,
  onMessage,
}: {
  partner: Partner;
  accounts: BankAccount[];
  txs: PartnerTx[];
  partners?: Partner[];
  onBack: () => void;
  onExpense: () => void;
  onChanged: () => void | Promise<void>;
  onMessage?: (message: string) => void;
}) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const pid = idOf(partner);
  const tone = partnerCardTone(pid || partner.name || "");
  const flow = partnerCardCashFlow(partner, txs, pid);
  const meta = partnerBalanceMeta(partner.balance);
  const mine = filterPartnerTxs(txs, pid).slice(0, 40);
  const [ledger, setLedger] = useState<LedgerRow | null>(null);
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txKind, setTxKind] = useState<PartnerTxKind | null>(null);
  const [menu, setMenu] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [name, setName] = useState(partner.name || "");
  const [share, setShare] = useState(String(partner.share_percent ?? ""));
  const [phone, setPhone] = useState(partner.phone || "");
  const [email, setEmail] = useState(partner.email || "");
  const [salary, setSalary] = useState<number | "">(partner.monthly_salary ?? "");

  useEffect(() => {
    let cancel = false;
    setLedger(null);
    get<Record<string, LedgerRow>>(client, "/banking/partners/ledgers", { company_id: companyId })
      .then((data) => {
        if (cancel) return;
        const row = data && typeof data === "object" ? data[pid] : null;
        setLedger(row && typeof row === "object" ? row : null);
      })
      .catch(() => {
        if (!cancel) setLedger(null);
      });
    return () => { cancel = true; };
  }, [client, companyId, pid, tick]);

  const tell = (text: string) => {
    setMessage(text);
    setError(null);
    onMessage?.(text);
  };

  const saved = async (text: string) => {
    tell(text);
    setTick((n) => n + 1);
    await onChanged();
  };

  const openEdit = () => {
    setName(partner.name || "");
    setShare(String(partner.share_percent ?? ""));
    setPhone(partner.phone || "");
    setEmail(partner.email || "");
    setSalary(partner.monthly_salary ?? "");
    setMenu(false);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!name.trim()) {
      setError("Ortak adı gerekli.");
      return;
    }
    const shareN = Number(String(share).replace(",", "."));
    if (!Number.isFinite(shareN) || shareN < 0) {
      setError("Ortaklık payı geçersiz.");
      return;
    }
    const salaryN = Number(salary || 0);
    setEditBusy(true);
    try {
      await put(client, `/banking/partners/${pid}`, {
        name: name.trim(),
        share_percent: shareN,
        phone: phone.trim(),
        email: email.trim(),
        monthly_salary: Number.isFinite(salaryN) ? salaryN : 0,
      });
      setEditOpen(false);
      await saved("Ortak güncellendi.");
    } catch (err) {
      setError(apiErrorMessage(err, "Ortak güncellenemedi."));
    } finally {
      setEditBusy(false);
    }
  };

  const accrue = () => {
    setMenu(false);
    confirmAction(
      "Aylık maaş tahakkuku",
      `${partner.name || "Ortak"} için aylık maaş ortak alacağına yazılsın mı?`,
      async () => {
        try {
          const res = await post<{ status?: string; message?: string }>(client, "/banking/partners/accrue-salary", {
            company_id: companyId,
            partner_id: pid,
          });
          await saved(res?.status === "pending_approval" ? (res.message || "Onay bekliyor.") : (res?.message || "Aylık maaş tahakkuku kaydedildi."));
        } catch (err) {
          setError(apiErrorMessage(err, "Maaş tahakkuku yapılamadı."));
        }
      },
      "Onayla",
    );
  };

  const remove = () => {
    setMenu(false);
    confirmAction("Ortağı sil", `${partner.name || "Ortak"} silinsin mi?`, async () => {
      try {
        await del(client, `/banking/partners/${pid}`);
        tell("Ortak silindi.");
        onBack();
        await onChanged();
      } catch (err) {
        setError(apiErrorMessage(err, "Ortak silinemedi."));
      }
    }, "Sil");
  };

  const check = ledger ? ledgerLine(ledger) : null;

  return (
    <View testID="partner-detail" style={{ gap: 12 }}>
      <Pressable testID="partner-detail-back" onPress={onBack} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
        <Text style={{ color: colors.indigo, fontWeight: "800" }}>‹ Ortaklar</Text>
      </Pressable>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}

      <View
        testID={`partner-card-${partner.name}`}
        style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: tone.border, borderRadius: 16, padding: 14, gap: 10 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <PartnerAvatar name={partner.name} photoUrl={partner.photo_url} tone={tone} size={56} testID={`partner-avatar-${pid}`} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 18 }}>{partner.name}</Text>
            <Muted>{`pay %${partner.share_percent || 0} · aylık maaş ${salaryText(partner.monthly_salary)}`}</Muted>
          </View>
          {canEdit ? (
            <Pressable
              testID={`partner-more-${pid}`}
              onPress={() => setMenu(true)}
              style={{ width: 42, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}
            >
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>⋯</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Muted>Bakiye</Muted>
            <Text testID={`partner-balance-${pid}`} style={{ fontWeight: "800", color: meta.color, fontSize: 16 }}>{fmtMoney(meta.display)}</Text>
            <Text testID={`partner-badge-${pid}`} style={{ fontSize: 11, fontWeight: "800", color: meta.color }}>{meta.badge}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Muted>Giriş</Muted>
            <Text style={{ fontWeight: "800", color: "#059669" }}>{fmtMoney(flow.giris)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Muted>Çıkış</Muted>
            <Text style={{ fontWeight: "800", color: "#E11D48" }}>{fmtMoney(flow.cikis)}</Text>
          </View>
        </View>
        <Muted testID={`partner-flow-${pid}`}>
          {flow.receivedLabel} {fmtMoney(flow.giris)} · {flow.paidLabel} {fmtMoney(flow.cikis)}
        </Muted>
      </View>

      {check ? (
        <Text testID="partner-ledger-check" style={{ color: check.color, fontWeight: "800" }}>{check.text}</Text>
      ) : null}

      {canEdit ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              testID={`partner-tx-btn-${action.key}`}
              onPress={() => setTxKind(action.key)}
              style={{
                flexBasis: "47%",
                flexGrow: 1,
                minHeight: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: action.color,
                backgroundColor: action.filled ? action.color : "#fff",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 8,
              }}
            >
              <Text style={{ color: action.filled ? "#fff" : action.color, fontWeight: "800" }}>{PARTNER_TX_KIND_LABEL[action.key]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View testID={`partner-moves-${pid}`} style={{ gap: 8 }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>ORTAK HAREKETLERİ</Text>
        {!mine.length ? <Muted>Hareket yok.</Muted> : mine.map((tx) => {
          const color = effectColor(tx);
          const id = idOf(tx);
          return (
            <View
              key={id}
              testID={`partner-tx-${id}`}
              style={{ backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontWeight: "800", color }}>{partnerTxLabel(tx)}</Text>
                <Text style={{ marginLeft: "auto", fontWeight: "800", color }}>{`${partnerTxSign(tx.type, tx)}${fmtMoney(tx.amount)}`}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{[fmtDate(tx.date), tx.account_name, tx.description].filter(Boolean).join(" · ")}</Text>
            </View>
          );
        })}
      </View>

      <PartnerTxSheet
        visible={txKind != null}
        onClose={() => setTxKind(null)}
        partners={partners && partners.length ? partners : [partner]}
        accounts={accounts}
        partnerId={pid}
        type={txKind}
        lockPartner
        lockType
        onSaved={saved}
      />

      <B2BSheet visible={menu} title={partner.name || "Ortak"} onClose={() => setMenu(false)} testID="partner-more-sheet">
        <Pressable testID={`partner-edit-${pid}`} onPress={openEdit} style={{ paddingVertical: 12 }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Düzenle</Text>
        </Pressable>
        <Pressable testID={`partner-accrue-${pid}`} onPress={accrue} style={{ paddingVertical: 12 }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Aylık maaş tahakkuku</Text>
        </Pressable>
        {canExp ? (
          <Pressable
            testID={`partner-expense-btn-${pid}`}
            onPress={() => { setMenu(false); onExpense(); }}
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ fontWeight: "800", color: colors.danger }}>Masraf</Text>
          </Pressable>
        ) : null}
        <Pressable testID={`partner-delete-${pid}`} onPress={remove} style={{ paddingVertical: 12 }}>
          <Text style={{ fontWeight: "800", color: colors.danger }}>Sil</Text>
        </Pressable>
      </B2BSheet>

      <B2BSheet visible={editOpen} title="Ortağı düzenle" onClose={() => setEditOpen(false)} testID="partner-edit-sheet">
        <Field label="Ad" testID="partner-edit-name" value={name} onChangeText={setName} />
        <Field label="Pay %" testID="partner-edit-share" value={share} onChangeText={setShare} keyboardType="decimal-pad" />
        <Field label="Telefon" testID="partner-edit-phone" value={phone} onChangeText={setPhone} />
        <Field label="E-posta" testID="partner-edit-email" value={email} onChangeText={setEmail} />
        <MoneyInput label="Aylık maaş" testID="partner-edit-salary" value={salary} onChange={(n) => setSalary(n ?? "")} />
        <PrimaryButton title={editBusy ? "Kaydediliyor…" : "Kaydet"} onPress={saveEdit} loading={editBusy} testID="partner-edit-save" />
      </B2BSheet>
    </View>
  );
}
