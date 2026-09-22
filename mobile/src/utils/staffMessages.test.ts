import {
  inboxUnreadTotal,
  mergeInboxWithDirectory,
  messageAuthor,
  messagePreview,
  parseHiddenFlag,
  previewStaffMessages,
  unreadStaffMessages,
  validateMessageBody,
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
});
