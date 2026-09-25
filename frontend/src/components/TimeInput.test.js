import React from "react";
import { TimeInput } from "../components/TimeInput";

describe("TimeInput", () => {
  test("exports a 24h-oriented time field", () => {
    expect(typeof TimeInput).toBe("function");
    const el = TimeInput({ value: "09:00", "data-testid": "t", onChange: () => {} });
    expect(el.type).toBe("input");
    expect(el.props.type).toBe("time");
    expect(el.props.lang).toBe("tr");
    expect(el.props.value).toBe("09:00");
    expect(el.props.step).toBe(60);
  });
});
