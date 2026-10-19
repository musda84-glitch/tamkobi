import React from "react";
import { View } from "react-native";
import type { ApiClient } from "../../api/client";
import { ManagerApprovalsPanel } from "../ManagerApprovalsPanel";
import { NotificationsPanel } from "../NotificationsPanel";
import { StaffMessagesPanel } from "../StaffMessagesPanel";
import type { Notification } from "../../types";
import { latestNotifications, unreadCount } from "../../utils/notifications";
import type { QuickTile } from "../../utils/quickMenu";

export type HomePanelProps = {
  showApprovals: boolean;
  client: ApiClient;
  companyId: string;
  onBadgesChanged: () => void;
  showMessages: boolean;
  notifications: QuickTile | null;
  notes: Notification[];
  clearingNotes: boolean;
  onOpenAllNotes: () => void;
  onOpenNote: (n: Notification) => void;
  onDeleteNote: (n: Notification) => void;
  onClearNotes: () => void;
  onMarkAllRead: () => void;
};

/** Onay, mesaj ve bildirim panelleri. Prop ve marginTop değerleri 2. sayfadaki blokla aynı. */
export function HomePanels({
  showApprovals,
  client,
  companyId,
  onBadgesChanged,
  showMessages,
  notifications,
  notes,
  clearingNotes,
  onOpenAllNotes,
  onOpenNote,
  onDeleteNote,
  onClearNotes,
  onMarkAllRead,
}: HomePanelProps) {
  return (
    <>
      {showApprovals ? (
        <View style={{ marginTop: 8 }}>
          <ManagerApprovalsPanel client={client} companyId={companyId} onChanged={onBadgesChanged} />
        </View>
      ) : null}
      {showMessages ? (
        <View style={{ marginTop: 8 }}>
          <StaffMessagesPanel client={client} onChanged={onBadgesChanged} />
        </View>
      ) : null}
      {notifications ? (
        <View style={{ marginTop: 4 }}>
          <NotificationsPanel
            items={latestNotifications(notes)}
            unread={unreadCount(notes)}
            totalCount={notes.length}
            clearing={clearingNotes}
            onOpenAll={onOpenAllNotes}
            onOpenItem={onOpenNote}
            onDeleteItem={onDeleteNote}
            onClearAll={onClearNotes}
            onMarkAllRead={onMarkAllRead}
          />
        </View>
      ) : null}
    </>
  );
}
