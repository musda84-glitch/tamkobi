jest.mock("expo-router", () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

import { router } from "expo-router";
import { go } from "./nav";

describe("go ExpenseEdit", () => {
  beforeEach(() => {
    (router.push as jest.Mock).mockClear();
  });

  it("opens the expense editor on the edit route", () => {
    go("ExpenseEdit", { id: "e9" });
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/expenses/edit/[id]",
      params: { id: "e9" },
    });
  });
});
