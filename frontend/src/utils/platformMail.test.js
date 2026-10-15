import { describe, expect, it } from "@jest/globals";
import { pickMailServerId } from "./platformMail";

const servers = [
  { id: "pms_live", name: "SES" },
  { id: "pms_other", name: "Yedek" },
];

describe("pickMailServerId", () => {
  it("keeps the selected server when it still exists", () => {
    expect(pickMailServerId("pms_other", servers)).toBe("pms_other");
  });

  it("does not keep a deleted or unknown server id", () => {
    expect(pickMailServerId("pms_deleted", servers)).toBe("pms_live");
    expect(pickMailServerId("", servers)).toBe("pms_live");
    expect(pickMailServerId(null, servers)).toBe("pms_live");
  });

  it("returns empty when there is no server to select", () => {
    expect(pickMailServerId("pms_deleted", [])).toBe("");
    expect(pickMailServerId("pms_deleted", null)).toBe("");
  });
});
