import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { apiErrorMessage } from "../auth/AuthContext";
import { get, post } from "../api/client";
import type { ApiClient } from "../api/client";
import { colors } from "../theme";
import { QUICK_TONE_COLORS } from "../utils/quickMenu";
import {
  announceAudienceLabel,
  buildChatList,
  chatAvatarColor,
  chatInitials,
  chatPeer,
  chatTimeLabel,
  filterChatList,
  inboxUnreadTotal,
  isOwnMessage,
  mergeInboxWithDirectory,
  mergeManagerInbox,
  parsePeerValue,
  peerPostBody,
  peerQuery,
  peerSelectGroups,
  threadInOrder,
  validateMessageBody,
  type ChatListRow,
  type PeerRef,
  type StaffAnnouncement,
  type StaffMessage,
  type StaffMessagesPayload,
} from "../utils/staffMessages";
import { B2BSheet } from "./b2b/B2BSheet";
import { GroupedSelect } from "./GroupedSelect";
import { PrimaryButton } from "./kit";

function Avatar({ name, tint, icon }: { name: string; tint: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tint, alignItems: "center", justifyContent: "center" }}>
      {icon ? <Ionicons name={icon} size={18} color="#fff" /> : (
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{chatInitials(name)}</Text>
      )}
    </View>
  );
}

function Bubble({ m, own, showAuthor }: { m: StaffMessage; own: boolean; showAuthor?: boolean }) {
  return (
    <View style={{ alignItems: own ? "flex-end" : "flex-start", marginBottom: 6 }}>
      <View
        style={{
          maxWidth: "82%",
          backgroundColor: own ? "#DCFCE7" : "#fff",
          borderWidth: own ? 0 : 1,
          borderColor: colors.border,
          borderRadius: 16,
          borderBottomRightRadius: own ? 4 : 16,
          borderBottomLeftRadius: own ? 16 : 4,
          paddingHorizontal: 10,
          paddingVertical: 6,
        }}
      >
        {showAuthor && !own ? (
          <Text style={{ color: colors.indigo, fontSize: 10, fontWeight: "800", marginBottom: 1 }}>{m.from_name || "Kişi"}</Text>
        ) : null}
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>{m.body}</Text>
        {m.created_at ? (
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700", marginTop: 2, textAlign: "right" }}>{chatTimeLabel(m.created_at)}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ChatRow({
  row,
  onPress,
  testID,
}: {
  row: ChatListRow;
  onPress: () => void;
  testID: string;
}) {
  const icon = row.kind === "group" ? "people" : row.kind === "announce" ? "megaphone" : undefined;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={row.name} tint={chatAvatarColor(row.key)} icon={icon} />
      <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.slate100, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontWeight: row.unread ? "800" : "700", color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{row.name}</Text>
          {row.at ? <Text style={{ color: row.unread ? colors.primary : colors.muted, fontSize: 10, fontWeight: "700" }}>{chatTimeLabel(row.at)}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1, fontWeight: row.unread ? "700" : "500" }} numberOfLines={1}>{row.preview}</Text>
          {row.unread ? (
            <View style={{ minWidth: 18, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.primary, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{row.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
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
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [openPeer, setOpenPeer] = useState<PeerRef | null>(null);
  const [pickPeer, setPickPeer] = useState("");
  const [thread, setThread] = useState<StaffMessage[]>([]);
  const [threadName, setThreadName] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupUsers, setGroupUsers] = useState<string[]>([]);
  const [groupEmps, setGroupEmps] = useState<string[]>([]);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [announceEmps, setAnnounceEmps] = useState<string[]>([]);
  const [announceAll, setAnnounceAll] = useState(true);
  const [openAnnounce, setOpenAnnounce] = useState<StaffAnnouncement | null>(null);

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
  const mode = data?.mode || "";
  const showStaff = mode === "staff" || mode === "both";
  const showInbox = mode === "manager" || mode === "both";

  const chats = useMemo(() => buildChatList({
    managers: mergeManagerInbox(data?.manager_inbox, managers, selfId),
    employees: mergeInboxWithDirectory(data?.inbox, data?.directory),
    groups: data?.group_inbox || [],
    announcements: data?.announcements || [],
    selfId,
    includeEmptyManagers: showStaff,
    includeEmptyEmployees: false,
  }), [data, managers, selfId, showStaff]);

  const visibleChats = useMemo(() => filterChatList(chats, query), [chats, query]);
  const pickGroups = useMemo(
    () => peerSelectGroups(data?.directory, managers, selfId, data?.manager_inbox),
    [data?.directory, managers, selfId, data?.manager_inbox],
  );
  const badge = inboxUnreadTotal(chats);

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

  const openChat = (row: ChatListRow) => {
    if (row.kind === "announce") {
      const found = (data?.announcements || []).find((a) => a.id === row.id);
      if (found) openAnnouncement(found);
      return;
    }
    const peer = chatPeer(row);
    if (peer) openThread(peer, row.name);
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

  const createAnnounce = async () => {
    const invalid = validateMessageBody(announceBody);
    if (invalid) { setError(invalid); return; }
    if (!announceAll && !announceEmps.length) {
      setError("Duyuru için personel seçin.");
      return;
    }
    setBusy(true);
    try {
      await post(client, "/personnel/messages/announce", {
        title: announceTitle,
        body: announceBody,
        employee_ids: announceAll ? [] : announceEmps,
      });
      setAnnounceOpen(false);
      setAnnounceTitle("");
      setAnnounceBody("");
      setAnnounceEmps([]);
      setAnnounceAll(true);
      await load();
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Duyuru gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openAnnouncement = async (row: StaffAnnouncement) => {
    setOpenAnnounce(row);
    if (row.id) {
      await post(client, "/personnel/messages/announce/read", { id: row.id }).catch(() => null);
      await load();
      onChanged?.();
    }
  };

  const chrome = {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tone.border,
    borderRadius: 20,
    padding: 10,
    gap: 6,
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

  const ordered = threadInOrder(thread);

  return (
    <View testID="home-messages-panel" style={chrome}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: tone.solid, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chatbubbles" size={16} color="#fff" />
        </View>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13, flex: 1 }}>Mesajlar</Text>
        {badge ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.primary }}>
            <Text testID="home-messages-unread" style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{badge}</Text>
          </View>
        ) : null}
        <Pressable
          testID="home-messages-compose"
          onPress={() => setComposeOpen((v) => !v)}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: tone.solid,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>

      {composeOpen ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Chip
            label="Grup"
            selected={false}
            testID="home-group-new"
            onPress={() => { setComposeOpen(false); setGroupOpen(true); }}
          />
          {showInbox ? (
            <Chip
              label="Duyuru"
              selected={false}
              testID="home-announce-new"
              onPress={() => { setComposeOpen(false); setAnnounceOpen(true); }}
            />
          ) : null}
        </View>
      ) : null}

      {composeOpen && pickGroups.length ? (
        <GroupedSelect
          label="Kişi seç"
          testID="home-message-pick"
          value={pickPeer}
          onChange={(v) => {
            setPickPeer(v);
            const peer = parsePeerValue(v);
            if (!peer) return;
            const name = peer.kind === "manager"
              ? (managers.find((m) => m.id === peer.id)?.name || "Yönetici")
              : ((data.directory || []).find((e) => e.id === peer.id)?.full_name || "Personel");
            setComposeOpen(false);
            openThread(peer, name);
          }}
          groups={pickGroups}
          emptyLabel="Kişi seçin"
          dense
        />
      ) : null}

      <TextInput
        testID="home-messages-search"
        value={query}
        onChangeText={setQuery}
        placeholder="Ara"
        placeholderTextColor={colors.muted}
        style={{
          height: 36,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 10,
          backgroundColor: colors.slate50,
          color: colors.text,
          fontWeight: "600",
          fontSize: 13,
        }}
      />

      {!visibleChats.length ? (
        <View style={{ backgroundColor: colors.slate50, borderRadius: 14, paddingVertical: 18, alignItems: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>
            {query ? "Sonuç yok." : showStaff ? "Yöneticinize yazmak için + ile başlayın." : "Henüz yazışma yok. + ile başlatın."}
          </Text>
        </View>
      ) : visibleChats.map((row) => (
        <ChatRow
          key={row.key}
          row={row}
          testID={
            row.kind === "manager" ? `home-inbox-mgr-${row.id}`
              : row.kind === "group" ? `home-inbox-group-${row.id}`
                : row.kind === "announce" ? `home-announce-${row.id}`
                  : `home-inbox-${row.id}`
          }
          onPress={() => openChat(row)}
        />
      ))}

      {error && data ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}

      <B2BSheet
        visible={!!openPeer}
        title={threadName}
        subtitle={openPeer?.kind === "group" ? "Grup yazışması" : "Mesaj"}
        onClose={() => { setOpenPeer(null); setPickPeer(""); }}
        testID="home-message-thread"
        footer={(
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <TextInput
              testID="home-thread-draft"
              value={threadDraft}
              onChangeText={setThreadDraft}
              placeholder="Mesaj yazın…"
              placeholderTextColor={colors.muted}
              multiline
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 96,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 18,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "#fff",
                color: colors.text,
                fontSize: 14,
              }}
            />
            <Pressable
              testID="home-thread-send"
              onPress={sendThread}
              disabled={busy}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        )}
      >
        <View style={{ backgroundColor: "#F1F5F9", borderRadius: 16, padding: 10, minHeight: 120 }}>
          {!ordered.length ? (
            <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>Henüz mesaj yok. Aşağıdan yazın.</Text>
          ) : ordered.map((m) => (
            <Bubble
              key={m.id || m.created_at}
              m={m}
              own={isOwnMessage(m, selfId, mode)}
              showAuthor={openPeer?.kind === "group"}
            />
          ))}
        </View>
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

      <B2BSheet
        visible={announceOpen}
        title="Yeni duyuru"
        subtitle="Tüm personele veya seçtiklerinize"
        onClose={() => setAnnounceOpen(false)}
        testID="home-announce-form"
      >
        <TextInput
          testID="home-announce-title"
          value={announceTitle}
          onChangeText={setAnnounceTitle}
          placeholder="Başlık"
          placeholderTextColor={colors.muted}
          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, marginBottom: 10, color: colors.text, fontWeight: "700" }}
        />
        <TextInput
          testID="home-announce-body"
          value={announceBody}
          onChangeText={setAnnounceBody}
          placeholder="Duyuru metni"
          placeholderTextColor={colors.muted}
          multiline
          style={{ minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10, color: colors.text }}
        />
        <Chip label="Tüm personel" selected={announceAll} testID="home-announce-all" onPress={() => setAnnounceAll(true)} />
        <View style={{ height: 8 }} />
        {(data.directory || []).length ? (
          <View style={{ gap: 6, marginBottom: 10 }}>
            <Text style={{ fontWeight: "800", fontSize: 12, color: colors.text }}>Veya personel seç</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(data.directory || []).filter((e) => e.id).map((e) => (
                <Chip
                  key={e.id}
                  label={e.full_name || "Personel"}
                  selected={!announceAll && announceEmps.includes(String(e.id))}
                  testID={`home-announce-emp-${e.id}`}
                  onPress={() => {
                    setAnnounceAll(false);
                    toggleId(announceEmps, String(e.id), setAnnounceEmps);
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}
        <PrimaryButton title={busy ? "Gönderiliyor…" : "Duyuru gönder"} onPress={createAnnounce} disabled={busy} testID="home-announce-send" />
      </B2BSheet>

      <B2BSheet
        visible={!!openAnnounce}
        title={openAnnounce?.title || "Duyuru"}
        subtitle={`${openAnnounce?.from_name || "Yönetici"} · ${announceAudienceLabel(openAnnounce)}`}
        onClose={() => setOpenAnnounce(null)}
        testID="home-announce-view"
      >
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{openAnnounce?.body}</Text>
      </B2BSheet>
    </View>
  );
}
