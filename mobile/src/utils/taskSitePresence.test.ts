import {
  dutyHasTaskSiteCoords,
  markTaskSitePresenceReported,
  resetTaskSitePresenceMemory,
  shouldReportTaskSitePresence,
  taskSitePresenceKey,
  taskSitePresencePayload,
} from "./taskSitePresence";

describe("taskSitePresence", () => {
  beforeEach(() => {
    resetTaskSitePresenceMemory();
  });

  it("builds a stable key and payload", () => {
    expect(taskSitePresenceKey("t1", "2026-09-26")).toBe("t1:2026-09-26");
    expect(taskSitePresencePayload("t1", { latitude: 41, longitude: 29, accuracy_m: 8 })).toEqual({
      task_id: "t1",
      latitude: 41,
      longitude: 29,
      accuracy_m: 8,
    });
  });

  it("reports only for consented field duties with coords, once", () => {
    expect(shouldReportTaskSitePresence({ field: true, taskId: "t1", hasCoords: true, consented: true })).toBe(true);
    markTaskSitePresenceReported("t1");
    expect(shouldReportTaskSitePresence({ field: true, taskId: "t1", hasCoords: true, consented: true })).toBe(false);
    expect(shouldReportTaskSitePresence({ field: false, taskId: "t1", hasCoords: true, consented: true })).toBe(false);
    expect(shouldReportTaskSitePresence({ field: true, taskId: "t1", hasCoords: false, consented: true })).toBe(false);
    expect(shouldReportTaskSitePresence({ field: true, taskId: "t1", hasCoords: true, consented: false })).toBe(false);
  });

  it("detects duty coordinates", () => {
    expect(dutyHasTaskSiteCoords({ latitude: 41.0, longitude: 29.0 })).toBe(true);
    expect(dutyHasTaskSiteCoords({ latitude: "", longitude: 29 })).toBe(false);
  });
});
