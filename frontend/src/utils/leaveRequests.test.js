import { leaveRowActions, leaveStatusView } from "./leaveRequests";

describe("leaveRequests", () => {
  it("shows cancel and delete on pending and approved rows", () => {
    expect(leaveRowActions("pending")).toEqual({
      approve: true, reject: true, cancel: true, remove: true,
    });
    expect(leaveRowActions("approved")).toEqual({
      approve: false, reject: false, cancel: true, remove: true,
    });
  });

  it("keeps delete on rejected/cancelled without cancel", () => {
    expect(leaveRowActions("rejected")).toEqual({
      approve: false, reject: false, cancel: false, remove: true,
    });
    expect(leaveRowActions("cancelled")).toEqual({
      approve: false, reject: false, cancel: false, remove: true,
    });
  });

  it("labels cancelled status", () => {
    expect(leaveStatusView("cancelled").label).toBe("İptal edildi");
    expect(leaveStatusView("approved").label).toBe("Onaylandı");
  });
});
