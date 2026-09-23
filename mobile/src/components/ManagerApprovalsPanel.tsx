import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage } from "../auth/AuthContext";
import { goHref } from "../nav";
import { colors } from "../theme";
import { idOf } from "../utils/money";
import {
  pendingRequestDecision,
  pendingRequestDecisionMessage,
  requestDecisionActions,
  requestKindLabel,
  type PendingRequest,
  type RequestDecision,
} from "../utils/personnel";
import { Card, Muted, Row } from "./kit";

function Chip({
  title,
  color,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: color,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 8,
        minHeight: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{title}</Text>
    </Pressable>
  );
}

type CashApproval = {
  id?: string;
  _id?: string;
  kind?: string;
  kind_label?: string;
  summary?: string;
  requested_by_name?: string;
  can_approve?: boolean;
};

type Client = Parameters<typeof get>[0];

export function ManagerApprovalsPanel({
  client,
  companyId,
  onChanged,
}: {
  client: Client;
  companyId?: string | null;
  onChanged?: () => void;
}) {
  const [staff, setStaff] = useState<PendingRequest[]>([]);
  const [cash, setCash] = useState<CashApproval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [reqs, cashRows] = await Promise.all([
        get<{ items?: PendingRequest[] }>(client, "/personnel/pending-requests", { company_id: companyId }).catch(() => ({ items: [] })),
        get<CashApproval[]>(client, "/banking/cash-approvals", { company_id: companyId, status: "pending" }).catch(() => []),
      ]);
      setStaff(reqs?.items || []);
      setCash(cashRows || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Onaylar yüklenemedi."));
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decideStaff = async (it: PendingRequest, approved: RequestDecision) => {
    const spec = pendingRequestDecision(it, approved);
    if (!spec) {
      goHref("/personnel");
      return;
    }
    const key = `${it.kind}-${it.id}`;
    setBusyId(key);
    try {
      await post(client, spec.path, spec.body);
      setMessage(pendingRequestDecisionMessage(it, approved));
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const decideCash = async (row: CashApproval, approved: boolean) => {
    const id = idOf(row);
    if (!id) return;
    setBusyId(`cash-${id}`);
    try {
      await post(client, `/banking/cash-approvals/${id}/${approved ? "approve" : "reject"}`, {});
      setMessage(approved ? "Kasa işlemi onaylandı." : "Kasa işlemi reddedildi.");
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const count = staff.length + cash.length;

  return (
    <Card testID="home-approvals">
      <Row style={{ alignItems: "center", gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: "#D97706", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="checkmark-done" size={16} color="#fff" />
        </View>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1 }}>Yönetici onayları</Text>
        {count ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.danger }}>
            <Text testID="home-approvals-count" style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{count}</Text>
          </View>
        ) : null}
      </Row>
      {error ? <Muted>{error}</Muted> : null}
      {message ? <Muted>{message}</Muted> : null}
      {!count ? (
        <Muted testID="home-approvals-empty">Bekleyen onay yok.</Muted>
      ) : (
        <View style={{ gap: 10, marginTop: 4 }}>
          {staff.map((it) => {
            const key = `${it.kind}-${it.id}`;
            const busy = busyId === key;
            return (
              <View key={key} style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }} testID={`home-approval-${it.kind}-${it.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1, minWidth: 0 }} numberOfLines={1}>
                    {it.employee_name || "Personel"} · {requestKindLabel(it.kind)}
                  </Text>
                  {it.kind === "dispute" ? (
                    <Chip title="Puantajda aç" color={colors.secondary} testID={`home-approval-view-${it.id}`} onPress={() => goHref("/personnel")} />
                  ) : (
                    <>
                      {requestDecisionActions(it.kind).map((btn) => (
                        <Chip
                          key={btn.key}
                          title={busy ? "…" : btn.title}
                          color={btn.color === "danger" ? colors.danger : btn.color === "warning" ? colors.warning : btn.color === "secondary" ? colors.secondary : colors.primary}
                          testID={`home-approval-${btn.key}-${it.kind}-${it.id}`}
                          onPress={() => decideStaff(it, btn.decision)}
                          disabled={busy}
                        />
                      ))}
                    </>
                  )}
                </View>
                <Muted>{it.title || "Talep"}{it.detail ? ` · ${it.detail}` : ""}</Muted>
              </View>
            );
          })}
          {cash.map((row) => {
            const id = idOf(row);
            const busy = busyId === `cash-${id}`;
            return (
              <View key={`cash-${id}`} style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }} testID={`home-approval-cash-${id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1, minWidth: 0 }} numberOfLines={1}>
                    {row.kind_label || row.kind || "Kasa"} · onay bekliyor
                  </Text>
                  {row.can_approve === false ? null : (
                    <>
                      <Chip title={busy ? "…" : "Onayla"} color={colors.primary} testID={`home-approval-cash-ok-${id}`} onPress={() => decideCash(row, true)} disabled={busy} />
                      <Chip title={busy ? "…" : "Reddet"} color={colors.danger} testID={`home-approval-cash-no-${id}`} onPress={() => decideCash(row, false)} disabled={busy} />
                    </>
                  )}
                </View>
                <Muted>{[row.summary, row.requested_by_name].filter(Boolean).join(" · ")}</Muted>
                {row.can_approve === false ? <Muted>Diğer yönetici onayı bekleniyor</Muted> : null}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
