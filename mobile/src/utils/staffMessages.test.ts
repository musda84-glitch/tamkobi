import {
  inboxUnreadTotal,
  mergeInboxWithDirectory,
  mergeManagerInbox,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  parsePeerValue,
  peerPostBody,
  previewStaffMessages,
  requireManagerId,
  unreadStaffMessages,
  validateMessageBody,
  managerSelectGroups,
} from "./staffMessages";

describe("staffMessages", () => {
  it("validates and previews a thread", () => {
    expect(validateMessageBody("  ")).toBe("Mesaj yazın.");
    expect(validateMessageBody("selam")).toBeNull();
    const rows = [
      { id: "1", from_side: "manager", from_name: "Mustafa", body: "Montaja gel", read_at: null },
      { id: "2", from_side: "staff", from_name: "Davut", body: "tamam", read_at: null },
    ];
    expect(unreadStaffMessages(rows, "staff")).toBe(1);
    expect(unreadStaffMessages(rows, "manager")).toBe(1);
    expect(previewStaffMessages(rows, 1)[0].id).toBe("1");
    expect(messageAuthor(rows[0])).toBe("Mustafa");
    expect(messagePreview({ body: "  a \n b  " })).toBe("a b");
    expect(inboxUnreadTotal([{ employee_id: "e1", unread: 2 }, { employee_id: "e2", unread: 0 }])).toBe(2);
    expect(parseHiddenFlag("1")).toBe(true);
    expect(parseHiddenFlag("0")).toBe(false);
    const merged = mergeInboxWithDirectory(
      [{ employee_id: "e1", employee_name: "Ali", unread: 1, last: { body: "selam" } }],
      [{ id: "e1", full_name: "Ali" }, { id: "e2", full_name: "Ayşe" }],
    );
    expect(merged.map((r) => r.employee_id)).toEqual(["e1", "e2"]);
    expect(merged[1].last).toBeNull();
  });

  it("lets staff pick a manager and open group or manager peers", () => {
    expect(requireManagerId("", [{ id: "u1", name: "Ali" }])).toBe("Yönetici seçin.");
    expect(requireManagerId("u1", [{ id: "u1", name: "Ali" }])).toBeNull();
    expect(requireManagerId("", [])).toBeNull();
    const mgrs = mergeManagerInbox(
      [{ user_id: "u1", name: "Ali", unread: 2, last: { body: "selam" } }],
      [{ id: "u1", name: "Ali" }, { id: "u2", name: "Ayşe" }, { id: "me", name: "Ben" }],
      "me",
    );
    expect(mgrs.map((r) => r.user_id)).toEqual(["u1", "u2"]);
    const groups = managerSelectGroups([{ id: "u2", name: "Ayşe" }, { id: "me", name: "Ben" }], [{ user_id: "_all", name: "Tüm yöneticiler" }], "me");
    expect(groups[0].options.map((o) => o.value)).toEqual(["u2", "_all"]);
    expect(parsePeerValue("m:u2")).toEqual({ kind: "manager", id: "u2" });
    expect(parsePeerValue("g:g1")).toEqual({ kind: "group", id: "g1" });
    expect(parsePeerValue("e1")).toEqual({ kind: "emp", id: "e1" });
    expect(peerPostBody({ kind: "manager", id: "u2" }, { body: "x" })).toEqual({ body: "x", to_user_id: "u2" });
    expect(peerPostBody({ kind: "group", id: "g1" }, { body: "x" })).toEqual({ body: "x", group_id: "g1" });
  });
});
