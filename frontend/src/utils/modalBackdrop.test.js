import { backdropDismissProps, hasTextSelection } from "./modalBackdrop";

function fakeEvent({ targetIsCurrent = true } = {}) {
  const currentTarget = { id: "backdrop" };
  const target = targetIsCurrent ? currentTarget : { id: "other" };
  return { target, currentTarget };
}

describe("backdropDismissProps", () => {
  test("closes only when mousedown and click both hit the backdrop", () => {
    const onClose = jest.fn();
    const props = backdropDismissProps(onClose);
    const e = fakeEvent({ targetIsCurrent: true });
    props.onMouseDown(e);
    props.onClick(e);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not close when mousedown was inside the panel (text select drag)", () => {
    const onClose = jest.fn();
    const props = backdropDismissProps(onClose);
    props.onMouseDown(fakeEvent({ targetIsCurrent: false }));
    props.onClick(fakeEvent({ targetIsCurrent: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("does not close when click target is not the backdrop", () => {
    const onClose = jest.fn();
    const props = backdropDismissProps(onClose);
    props.onMouseDown(fakeEvent({ targetIsCurrent: true }));
    props.onClick(fakeEvent({ targetIsCurrent: false }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("ignores missing onClose", () => {
    const props = backdropDismissProps(null);
    expect(() => {
      props.onMouseDown(fakeEvent());
      props.onClick(fakeEvent());
    }).not.toThrow();
  });
});

describe("hasTextSelection", () => {
  test("returns false when collapsed or empty", () => {
    const orig = window.getSelection;
    window.getSelection = () => ({ isCollapsed: true, toString: () => "" });
    expect(hasTextSelection()).toBe(false);
    window.getSelection = () => ({ isCollapsed: false, toString: () => "abc" });
    expect(hasTextSelection()).toBe(true);
    window.getSelection = orig;
  });
});
