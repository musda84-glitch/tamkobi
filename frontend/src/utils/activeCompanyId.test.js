import { activeCompanyId } from "./activeCompanyId";

test("activeCompanyId prefers id, then _id, otherwise empty", () => {
  expect(activeCompanyId({ id: "c1" })).toBe("c1");
  expect(activeCompanyId({ id: "c1", _id: "other" })).toBe("c1");
  expect(activeCompanyId({ _id: "c2" })).toBe("c2");
  expect(activeCompanyId(null)).toBe("");
  expect(activeCompanyId(undefined)).toBe("");
  expect(activeCompanyId({})).toBe("");
});
