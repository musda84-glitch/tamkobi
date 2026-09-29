import { supportContactAllowed, supportTicketsAllowed } from "./supportAccess";

describe("supportAccess", () => {
  const yes = () => true;
  const no = () => false;
  const addonOn = (k) => k === "support.tickets" || k === "support.contact";

  it("hides tickets when role cannot view /support", () => {
    expect(supportTicketsAllowed({
      user: { role: "production" },
      can: (p) => p !== "/support",
      moduleOn: yes,
      addonOn,
    })).toBe(false);
  });

  it("hides tickets when license module is off", () => {
    expect(supportTicketsAllowed({
      user: { role: "manager" },
      can: yes,
      moduleOn: (p) => p !== "/support",
      addonOn,
    })).toBe(false);
  });

  it("shows tickets when role, module and addon allow", () => {
    expect(supportTicketsAllowed({
      user: { role: "manager" },
      can: yes,
      moduleOn: yes,
      addonOn,
    })).toBe(true);
  });

  it("hides contact when role blocks /support", () => {
    expect(supportContactAllowed({
      user: { role: "production" },
      can: no,
      moduleOn: yes,
      addonOn,
      support: { email: "a@b.com" },
    })).toBe(false);
  });

  it("shows contact when allowed and email present", () => {
    expect(supportContactAllowed({
      user: { role: "manager" },
      can: yes,
      moduleOn: yes,
      addonOn,
      support: { email: "a@b.com" },
    })).toBe(true);
  });
});
