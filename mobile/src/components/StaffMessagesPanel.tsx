import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { apiErrorMessage } from "../auth/AuthContext";
import { get, post } from "../api/client";
import type { ApiClient } from "../api/client";
import { colors } from "../theme";
import { notificationAge } from "../utils/notifications";
import { QUICK_TONE_COLORS } from "../utils/quickMenu";
import {
  MESSAGES_HIDDEN_KEY,
  employeeSelectGroups,
  inboxUnreadTotal,
  mergeInboxWithDirectory,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  previewStaffMessages,
  validateMessageBody,
  type StaffInboxRow,
  type StaffMessage,
  type StaffMessagesPayload,
} from "../utils/staffMessages";
import { B2BSheet } from "./b2b/B2BSheet";
import { GroupedSelect } from "./GroupedSelect";
import { PrimaryButton } from "./kit";

export function StaffMessagesPanel({
  client,
  onChanged,
}: {
  client: ApiClient;
  onChanged?: () => void;
}) {
  const tone = QUICK_TONE_COLORS.violet;
  const [data, setData] = useState<StaffMessagesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [openEmp, setOpenEmp] = useState<string | null>(null);
  const [pickEmp, setPickEmp] = useState("");
  const [thread, setThread] = useState<StaffMessage[]>([]);
  const [threadName, setThreadName] = useState("");
  const [threadDraft, setThreadDraft] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(MESSAGES_HIDDEN_KEY).then((raw) => setHidden(parseHiddenFlag(raw))).catch(() => null);
  }, []);

  const toggleHidden = async () => {
    const next = !hidden;
    setHidden(next);
    await AsyncStorage.setItem(MESSAGES_HIDDEN_KEY, next ? "1" : "0").catch(() => null);
  };

  const load = useCallback(async () => {
    try {
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages");
      setData(res);
      setError(null);
    } catch (err) {
      setData(null);
      setError(apiErrorMessage(err, "Mesajlar yüklenemedi."));
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const sendOwn = async () => {
    const invalid = validateMessageBody(draft);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/messages", { body: draft });
      setDraft("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Mesaj gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openInbox = async (row: StaffInboxRow) => {
    setOpenEmp(row.employee_id);
    setThreadName(row.employee_name || "Personel");
    setThreadDraft("");
    try {
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages", { employee_id: row.employee_id });
      setThread(res.thread || []);
      setThreadName(res.employee?.full_name || row.employee_name || "Personel");
      await post(client, "/personnel/messages/read", { employee_id: row.employee_id }).catch(() => null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Konuşma açılamadı."));
    }
  };

  const sendThread = async () => {
    if (!openEmp) return;
    const invalid = validateMessageBody(threadDraft);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/messages", { body: threadDraft, employee_id: openEmp });
      setThreadDraft("");
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages", { employee_id: openEmp });
      setThread(res.thread || []);
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Mesaj gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const markOwnRead = async () => {
    await post(client, "/personnel/messages/read", {}).catch(() => null);
    await load();
    onChanged?.();
  };

  const mode = data?.mode || "";
  const showStaff = mode === "staff" || mode === "both";
  const showInbox = mode === "manager" || mode === "both";
  const preview = previewStaffMessages(data?.thread);
  const unread = Number(data?.unread || 0);
  const conversations = useMemo(
    () => mergeInboxWithDirectory(data?.inbox, data?.directory),
    [data?.inbox, data?.directory],
  );
  const inboxUnread = inboxUnreadTotal(conversations);
  const pickGroups = useMemo(() => employeeSelectGroups(data?.directory), [data?.directory]);
  const badge = showInbox ? inboxUnread : unread;

  const chrome = {
    backgroundColor: tone.bg,
    borderWidth: 1,
    borderColor: tone.border,
    borderRadius: 20,
    padding: 10,
    gap: 8,
    ...Platform.select({
      web: { boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)" },
      default: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
    }),
  } as const;

  if (error && !data) {
    return (
      <View testID="home-messages-panel" style={chrome}>
        <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>
      </View>
    );
  }
  if (!data) return null;

  return (
    <View testID="home-messages-panel" style={chrome}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: tone.solid, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chatbubbles" size={16} color="#fff" />
        </View>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1 }}>Mesajlar</Text>
        {badge ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.danger }}>
            <Text testID="home-messages-unread" style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{badge} yeni</Text>
          </View>
        ) : null}
        <Pressable
          testID="home-messages-toggle"
          onPress={toggleHidden}
          style={({ pressed }) => ({
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: tone.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "800" }}>{hidden ? "Göster" : "Gizle"}</Text>
        </Pressable>
      </View>

      {hidden ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Yazışmalar gizli. Göster ile açın.</Text>
      ) : (
        <>
          {showStaff ? (
            <View style={{ gap: 8 }}>
              <Pressable testID="home-messages-mark" onPress={markOwnRead}>
                <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }}>Yönetici ile yazışma</Text>
              </Pressable>
              {!preview.length ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Henüz mesaj yok. Aşağıdan yazın.</Text>
                </View>
              ) : preview.map((m) => (
                <View
                  key={m.id || m.created_at}
                  testID={`home-message-${m.id}`}
                  style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 9, gap: 2, opacity: m.read_at || m.from_side === "staff" ? 0.78 : 1 }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{messageAuthor(m)}</Text>
                    {m.created_at ? <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700" }}>{notificationAge(m.created_at)}</Text> : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={2}>{messagePreview(m)}</Text>
                </View>
              ))}
              <TextInput
                testID="home-message-draft"
                value={draft}
                onChangeText={setDraft}
                placeholder="Yöneticiye yazın…"
                placeholderTextColor={colors.muted}
                multiline
                style={{ minHeight: 44, borderWidth: 1, borderColor: tone.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fff", color: colors.text, fontWeight: "600", fontSize: 13 }}
              />
              <PrimaryButton title={busy ? "Gönderiliyor…" : "Gönder"} onPress={sendOwn} disabled={busy} testID="home-message-send" />
            </View>
          ) : null}

          {showInbox ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }}>Tüm yazışmalar</Text>
              {pickGroups.length ? (
                <GroupedSelect
                  label="Personel seç"
                  testID="home-message-pick"
                  value={pickEmp}
                  onChange={(v) => {
                    setPickEmp(v);
                    if (v) {
                      const row = conversations.find((r) => r.employee_id === v) || { employee_id: v, employee_name: "Personel" };
                      openInbox(row);
                    }
                  }}
                  groups={pickGroups}
                  emptyLabel="Yeni yazışma başlat"
                  dense
                />
              ) : null}
              {!conversations.length ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Kayıtlı personel yok.</Text>
              ) : conversations.map((row) => (
                <Pressable
                  key={row.employee_id}
                  testID={`home-inbox-${row.employee_id}`}
                  onPress={() => openInbox(row)}
                  style={({ pressed }) => ({ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 9, opacity: pressed ? 0.75 : 1 })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{row.employee_name || "Personel"}</Text>
                    {row.unread ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.danger }}>
                        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{row.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>{row.last ? messagePreview(row.last) : "Yeni yazışma"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {error && data ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
        </>
      )}

      <B2BSheet
        visible={!!openEmp}
        title={threadName}
        subtitle="Mesaj"
        onClose={() => { setOpenEmp(null); setPickEmp(""); }}
        testID="home-message-thread"
      >
        {(thread || []).slice().reverse().map((m) => (
          <View key={m.id || m.created_at} style={{ paddingVertical: 6 }}>
            <Text style={{ fontWeight: "800", fontSize: 11, color: m.from_side === "manager" ? colors.indigo : colors.text }}>{messageAuthor(m)}</Text>
            <Text style={{ color: colors.text, fontSize: 13 }}>{m.body}</Text>
          </View>
        ))}
        <TextInput
          testID="home-thread-draft"
          value={threadDraft}
          onChangeText={setThreadDraft}
          placeholder="Mesaj yazın…"
          placeholderTextColor={colors.muted}
          multiline
          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, color: colors.text }}
        />
        <PrimaryButton title={busy ? "Gönderiliyor…" : "Gönder"} onPress={sendThread} disabled={busy} testID="home-thread-send" />
      </B2BSheet>
    </View>
  );
}
