import { notificationCanDelete, notificationDeletePath, swipeDeleteOutcome, NOTIFY_SWIPE_W } from "./notificationSwipe";

describe("notification swipe delete", () => {
  it("allows only read notes with an id", () => {
    expect(notificationCanDelete({ id: "n1", is_read: true })).toBe(true);
    expect(notificationCanDelete({ id: "n1", is_read: false })).toBe(false);
    expect(notificationDeletePath({ id: "n1", is_read: true })).toBe("/notifications/n1");
    expect(notificationDeletePath({ id: "n1", is_read: false })).toBeNull();
  });

  it("opens the delete action on a left swipe", () => {
    expect(swipeDeleteOutcome(0, -(NOTIFY_SWIPE_W / 2 + 1))).toBe("open");
    expect(swipeDeleteOutcome(0, -4)).toBe("press");
    expect(swipeDeleteOutcome(-NOTIFY_SWIPE_W, 40)).toBe("close");
  });
});
