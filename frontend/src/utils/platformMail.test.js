import { describe, expect, it } from "@jest/globals";
import {
  MAILBOX_PASSWORD_HINT,
  MAILBOX_PASSWORD_MISSING,
  SMTP_PASSWORD_MISSING,
  mailboxPasswordHint,
  pickMailServerId,
} from "./platformMail";

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

describe("mailboxPasswordHint", () => {
  it("keeps the mailbox and smtp password errors and adds the edit hint", () => {
    expect(mailboxPasswordHint(MAILBOX_PASSWORD_MISSING)).toBe(MAILBOX_PASSWORD_HINT);
    expect(mailboxPasswordHint(SMTP_PASSWORD_MISSING)).toBe(MAILBOX_PASSWORD_HINT);
    expect(mailboxPasswordHint(`  ${MAILBOX_PASSWORD_MISSING}  `)).toBe(MAILBOX_PASSWORD_HINT);
  });

  it("does not treat other failures as a missing mailbox password", () => {
    expect(mailboxPasswordHint("IMAP bağlantısı kurulamadı.")).toBe("");
    expect(mailboxPasswordHint("Kutu şifresi okunamadı.")).toBe("");
    expect(mailboxPasswordHint({ detail: MAILBOX_PASSWORD_MISSING })).toBe("");
    expect(mailboxPasswordHint("")).toBe("");
  });
});
