import { descendantIds, parentIdOf, sortCompanyTree } from "./companyTree";

const deneme = { id: "deneme", name: "DENEME", license_id: "deneme", created_at: "2026-09-17", is_primary: true };
const sub = { id: "tamkobi", name: "tamkobi.com", license_id: "deneme", parent_company_id: "deneme", parent_company_name: "DENEME", created_at: "2026-09-10" };
const matek = { id: "matek", name: "MATEK", license_id: "matek", created_at: "2026-09-10", is_primary: true };
const matekSub = { id: "matek-sub", name: "MATEK Şube", license_id: "matek", created_at: "2026-09-11" };

describe("companyTree", () => {
  test("infers parent from license when not primary", () => {
    expect(parentIdOf(deneme)).toBeNull();
    expect(parentIdOf(sub)).toBe("deneme");
    expect(parentIdOf(matekSub)).toBe("matek");
    expect(parentIdOf({ id: "x", license_id: "x" })).toBeNull();
  });

  test("nests subsidiaries under the parent and keeps other roots", () => {
    const tree = sortCompanyTree([sub, matek, deneme, matekSub]);
    expect(tree.map((r) => r.id)).toEqual(["deneme", "tamkobi", "matek", "matek-sub"]);
    expect(tree.map((r) => r.tree_depth)).toEqual([0, 1, 0, 1]);
  });

  test("child without parent in the filtered list stays a root", () => {
    const tree = sortCompanyTree([sub]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("tamkobi");
    expect(tree[0].tree_depth).toBe(0);
  });

  test("descendantIds excludes the root and walks nested children", () => {
    const mid = { id: "mid", license_id: "deneme", parent_company_id: "deneme" };
    const leaf = { id: "leaf", license_id: "deneme", parent_company_id: "mid" };
    expect([...descendantIds([deneme, mid, leaf, sub], "deneme")].sort()).toEqual(["leaf", "mid", "tamkobi"]);
    expect(descendantIds([deneme, mid, leaf], "mid").has("leaf")).toBe(true);
    expect(descendantIds([deneme, mid, leaf], "mid").has("deneme")).toBe(false);
  });
});
