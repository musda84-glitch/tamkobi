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
  inboxUnreadTotal,
  managerSelectGroups,
  mergeInboxWithDirectory,
  mergeManagerInbox,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  parsePeerValue,
  peerPostBody,
  peerQuery,
  peerSelectGroups,
  previewStaffMessages,
  requireManagerId,
  validateMessageBody,
  type PeerRef,
  type StaffMessage,
  type StaffMessagesPayload,
} from "../utils/staffMessages";
import { B2BSheet } from "./b2b/B2BSheet";
import { GroupedSelect } from "./GroupedSelect";
import { PrimaryButton } from "./kit";

function MessagePreviewRow({ m }: { m: StaffMessage }) {
  return (
    <View
      testID={`home-message-${m.id}`}
      style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 9, gap: 2, opacity: m.read_at || m.from_side === "staff" ? 0.78 : 1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{messageAuthor(m)}</Text>
        {m.created_at ? <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700" }}>{notificationAge(m.created_at)}</Text> : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={2}>{messagePreview(m)}</Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: selected ? colors.indigo50 : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.indigo : colors.border,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "800", color: selected ? colors.indigo : colors.text }}>{label}</Text>
    </Pressable>
  );
}

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
  const [selectedManager, setSelectedManager] = useState("");
  const [staffThread, setStaffThread] = useState<StaffMessage[]>([]);
  const [openPeer, setOpenPeer] = useState<PeerRef | null>(null);
  const [pickPeer, setPickPeer] = useState("");
  const [thread, setThread] = useState<StaffMessage[]>([]);
  const [threadName, setThreadName] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupUsers, setGroupUsers] = useState<string[]>([]);
  const [groupEmps, setGroupEmps] = useState<string[]>([]);

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
      return res;
    } catch (err) {
      setData(null);
      setError(apiErrorMessage(err, "Mesajlar yüklenemedi."));
      return null;
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const managers = data?.managers || [];
  const selfId = data?.self_user_id || "";
  const managerRows = useMemo(
    () => mergeManagerInbox(data?.manager_inbox, managers, selfId),
    [data?.manager_inbox, managers, selfId],
  );
  const managerGroups = useMemo(
    () => managerSelectGroups(managers, data?.manager_inbox, selfId),
    [managers, data?.manager_inbox, selfId],
  );

  useEffect(() => {
    if (selectedManager || !managerGroups.length) return;
    const first = managerGroups[0]?.options?.find((o) => o.value && o.value !== "_all") || managerGroups[0]?.options?.[0];
    if (first && managerGroups[0].options.filter((o) => o.value !== "_all").length === 1) {
      setSelectedManager(first.value);
    }
  }, [managerGroups, selectedManager]);

  const loadStaffThread = useCallback(async (managerId: string) => {
    if (!managerId) {
      setStaffThread([]);
      return;
    }
    try {
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages", peerQuery({ kind: "manager", id: managerId }));
      setStaffThread(res.thread || []);
      await post(client, "/personnel/messages/read", peerPostBody({ kind: "manager", id: managerId })).catch(() => null);
    } catch (err) {
      setError(apiErrorMessage(err, "Konuşma açılamadı."));
    }
  }, [client]);

  useEffect(() => {
    if (selectedManager) loadStaffThread(selectedManager);
  }, [selectedManager, loadStaffThread]);

  const sendOwn = async () => {
    const invalid = validateMessageBody(draft) || requireManagerId(selectedManager, managers.filter((m) => m.id !== selfId));
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/messages", peerPostBody(
        selectedManager ? { kind: "manager", id: selectedManager } : null,
        { body: draft },
      ));
      setDraft("");
      await load();
      if (selectedManager) await loadStaffThread(selectedManager);
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Mesaj gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openThread = async (peer: PeerRef, name: string) => {
    setOpenPeer(peer);
    setThreadName(name);
    setThreadDraft("");
    try {
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages", peerQuery(peer));
      setThread(res.thread || []);
      setThreadName(res.group?.title || res.to_user?.name || res.employee?.full_name || name);
      await post(client, "/personnel/messages/read", peerPostBody(peer)).catch(() => null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Konuşma açılamadı."));
    }
  };

  const sendThread = async () => {
    if (!openPeer) return;
    const invalid = validateMessageBody(threadDraft);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/messages", peerPostBody(openPeer, { body: threadDraft }));
      setThreadDraft("");
      const res = await get<StaffMessagesPayload>(client, "/personnel/messages", peerQuery(openPeer));
      setThread(res.thread || []);
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Mesaj gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupUsers.length && !groupEmps.length) {
      setError("Gruba en az bir kişi daha ekleyin.");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ group?: { id?: string; title?: string } }>(client, "/personnel/messages/groups", {
        title: groupTitle,
        member_user_ids: groupUsers,
        member_employee_ids: groupEmps,
      });
      setGroupOpen(false);
      setGroupTitle("");
      setGroupUsers([]);
      setGroupEmps([]);
      await load();
      if (res.group?.id) {
        await openThread({ kind: "group", id: res.group.id }, res.group.title || "Grup");
      }
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Grup oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  };

  const mode = data?.mode || "";
  const showStaff = mode === "staff" || mode === "both";
  const showInbox = mode === "manager" || mode === "both";
  const selectedPreview = previewStaffMessages(staffThread);
  const conversations = useMemo(
    () => mergeInboxWithDirectory(data?.inbox, data?.directory),
    [data?.inbox, data?.directory],
  );
  const pickGroups = useMemo(
    () => peerSelectGroups(data?.directory, managers, selfId),
    [data?.directory, managers, selfId],
  );
  const groups = data?.group_inbox || [];
  const badge = inboxUnreadTotal([
    ...(showInbox ? conversations : []),
    ...managerRows,
    ...groups,
  ]);
  const selectedName = managerRows.find((r) => r.user_id === selectedManager)?.name
    || managers.find((m) => m.id === selectedManager)?.name
    || (selectedManager === "_all" ? "Tüm yöneticiler" : "");

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

  const toggleId = (list: string[], id: string, set: (next: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

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
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }}>
                {selectedName ? `${selectedName} ile yazışma` : "Yönetici seçin"}
              </Text>
              {managerGroups.length ? (
                <GroupedSelect
                  label="Yönetici seç"
                  testID="home-manager-pick"
                  value={selectedManager}
                  onChange={setSelectedManager}
                  groups={managerGroups}
                  emptyLabel="Yönetici seçin"
                  dense
                />
              ) : null}
              {!selectedManager && managerGroups.length ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Yazışmak için yönetici seçin.</Text>
                </View>
              ) : !selectedPreview.length ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Henüz mesaj yok. Aşağıdan yazın.</Text>
                </View>
              ) : selectedPreview.map((m) => (
                <MessagePreviewRow key={m.id || m.created_at} m={m} />
              ))}
              <TextInput
                testID="home-message-draft"
                value={draft}
                onChangeText={setDraft}
                placeholder={selectedName ? `${selectedName} adlı yöneticiye yazın…` : "Yöneticiye yazın…"}
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
                  label="Personel veya yönetici seç"
                  testID="home-message-pick"
                  value={pickPeer}
                  onChange={(v) => {
                    setPickPeer(v);
                    const peer = parsePeerValue(v);
                    if (!peer) return;
                    const name = peer.kind === "manager"
                      ? (managers.find((m) => m.id === peer.id)?.name || "Yönetici")
                      : (conversations.find((r) => r.employee_id === peer.id)?.employee_name || "Personel");
                    openThread(peer, name);
                  }}
                  groups={pickGroups}
                  emptyLabel="Yeni yazışma başlat"
                  dense
                />
              ) : null}
              {managerRows.filter((r) => r.user_id !== "_all").length ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontWeight: "700", color: colors.muted, fontSize: 11 }}>Yöneticiler</Text>
                  {managerRows.filter((r) => r.user_id !== "_all").map((row) => (
                    <InboxRow
                      key={`m-${row.user_id}`}
                      title={row.name || "Yönetici"}
                      last={row.last}
                      unread={row.unread}
                      testID={`home-inbox-mgr-${row.user_id}`}
                      onPress={() => openThread({ kind: "manager", id: row.user_id }, row.name || "Yönetici")}
                    />
                  ))}
                </View>
              ) : null}
              {!conversations.length ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Kayıtlı personel yok.</Text>
              ) : conversations.map((row) => (
                <InboxRow
                  key={row.employee_id}
                  title={row.employee_name || "Personel"}
                  last={row.last}
                  unread={row.unread}
                  testID={`home-inbox-${row.employee_id}`}
                  onPress={() => openThread({ kind: "emp", id: row.employee_id }, row.employee_name || "Personel")}
                />
              ))}
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12, flex: 1 }}>Grup yazışmaları</Text>
              <Pressable
                testID="home-group-new"
                onPress={() => setGroupOpen(true)}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: tone.border }}
              >
                <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "800" }}>Yeni grup</Text>
              </Pressable>
            </View>
            {!groups.length ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>Henüz grup yok. Personel ve yöneticileri ekleyerek başlatın.</Text>
            ) : groups.map((row) => (
              <InboxRow
                key={row.group_id}
                title={row.name || "Grup"}
                last={row.last}
                unread={row.unread}
                testID={`home-inbox-group-${row.group_id}`}
                onPress={() => openThread({ kind: "group", id: row.group_id }, row.name || "Grup")}
              />
            ))}
          </View>

          {error && data ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
        </>
      )}

      <B2BSheet
        visible={!!openPeer}
        title={threadName}
        subtitle={openPeer?.kind === "group" ? "Grup yazışması" : "Mesaj"}
        onClose={() => { setOpenPeer(null); setPickPeer(""); }}
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

      <B2BSheet
        visible={groupOpen}
        title="Yeni grup"
        subtitle="Yönetici ve personel ekleyin"
        onClose={() => setGroupOpen(false)}
        testID="home-group-form"
      >
        <TextInput
          testID="home-group-title"
          value={groupTitle}
          onChangeText={setGroupTitle}
          placeholder="Grup adı"
          placeholderTextColor={colors.muted}
          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, marginBottom: 10, color: colors.text, fontWeight: "700" }}
        />
        {managers.filter((m) => m.id && m.id !== selfId).length ? (
          <View style={{ gap: 6, marginBottom: 10 }}>
            <Text style={{ fontWeight: "800", fontSize: 12, color: colors.text }}>Yöneticiler</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {managers.filter((m) => m.id && m.id !== selfId).map((m) => (
                <Chip
                  key={m.id}
                  label={m.name || "Yönetici"}
                  selected={groupUsers.includes(String(m.id))}
                  testID={`home-group-user-${m.id}`}
                  onPress={() => toggleId(groupUsers, String(m.id), setGroupUsers)}
                />
              ))}
            </View>
          </View>
        ) : null}
        {(data.directory || []).length ? (
          <View style={{ gap: 6, marginBottom: 10 }}>
            <Text style={{ fontWeight: "800", fontSize: 12, color: colors.text }}>Personel</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(data.directory || []).filter((e) => e.id).map((e) => (
                <Chip
                  key={e.id}
                  label={e.full_name || "Personel"}
                  selected={groupEmps.includes(String(e.id))}
                  testID={`home-group-emp-${e.id}`}
                  onPress={() => toggleId(groupEmps, String(e.id), setGroupEmps)}
                />
              ))}
            </View>
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>Eklenecek personel yok.</Text>
        )}
        <PrimaryButton title={busy ? "Oluşturuluyor…" : "Grup oluştur"} onPress={createGroup} disabled={busy} testID="home-group-create" />
      </B2BSheet>
    </View>
  );
}

function InboxRow({
  title,
  last,
  unread,
  onPress,
  testID,
}: {
  title: string;
  last?: StaffMessage | null;
  unread?: number;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 9, opacity: pressed ? 0.75 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{title}</Text>
        {unread ? (
          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.danger }}>
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{unread}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>{last ? messagePreview(last) : "Yeni yazışma"}</Text>
    </Pressable>
  );
}
