import "../test/domSetup";
import React, { act } from "react";
import { WebBarcodeCamera } from "./WebBarcodeCamera";

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    View: (props: { children?: React.ReactNode }) => ReactLib.createElement("div", null, props.children),
    Text: (props: { children?: React.ReactNode }) => ReactLib.createElement("span", null, props.children),
  };
});

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const origCreate = document.createElement.bind(document);
document.createElement = ((tag: string) => {
  const el = origCreate(tag) as ReturnType<typeof origCreate> & {
    replaceChildren: (...nodes: unknown[]) => void;
    play: () => Promise<void>;
    srcObject: unknown;
  };
  el.replaceChildren = (...nodes: unknown[]) => {
    while (el.childNodes.length) el.removeChild(el.childNodes[0]);
    nodes.forEach((node) => {
      if (node) el.appendChild(node as ReturnType<typeof origCreate>);
    });
  };
  el.play = () => Promise.resolve();
  if (el.style && typeof (el.style as { setProperty?: unknown }).setProperty !== "function") {
    (el.style as { setProperty: (name: string, value: string) => void }).setProperty = (name, value) => {
      (el.style as Record<string, string>)[name] = value;
    };
  }
  return el;
}) as typeof document.createElement;

type Track = { stop: jest.Mock; getSettings: () => { deviceId?: string }; getCapabilities: () => Record<string, unknown> };

function fakeStream(deviceId: string) {
  const track: Track = {
    stop: jest.fn(),
    getSettings: () => ({ deviceId }),
    getCapabilities: () => ({}),
  };
  return {
    track,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WebBarcodeCamera akış sızıntısı", () => {
  let container: HTMLElement;
  let root: { render: (node: unknown) => void; unmount: () => void };

  beforeEach(() => {
    const view = window as unknown as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
    view.setTimeout = setTimeout;
    view.clearTimeout = clearTimeout;
    container = document.createElement("div") as unknown as HTMLElement;
    document.body.appendChild(container);
    root = createRoot(container);
    (navigator as unknown as { mediaDevices?: unknown }).mediaDevices = {
      enumerateDevices: jest.fn(async () => []),
      getUserMedia: jest.fn(),
    };
  });

  afterEach(() => {
    try { act(() => { root.unmount(); }); } catch { /* kök zaten kapandı */ }
    container.parentNode?.removeChild(container);
  });

  test("kapanıştan sonra gelen ilk akışın izleri durur", async () => {
    const stream = fakeStream("back-1");
    let release: ((value: typeof stream) => void) | null = null;
    const media = navigator.mediaDevices as unknown as {
      enumerateDevices: jest.Mock;
      getUserMedia: jest.Mock;
    };
    media.enumerateDevices.mockResolvedValue([
      { deviceId: "back-1", label: "Back Camera", kind: "videoinput" },
    ]);
    media.getUserMedia.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    await act(async () => {
      root.render(React.createElement(WebBarcodeCamera, { active: true, onScan: jest.fn() }));
    });
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(release).toEqual(expect.any(Function));

    act(() => { root.unmount(); });
    await act(async () => {
      release?.(stream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stream.track.stop).toHaveBeenCalled();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  test("ikinci openStream kapanıştan sonra gelirse o akış da durur", async () => {
    const first = fakeStream("temp");
    const second = fakeStream("back-1");
    let releaseSecond: ((value: typeof second) => void) | null = null;
    const media = navigator.mediaDevices as unknown as {
      enumerateDevices: jest.Mock;
      getUserMedia: jest.Mock;
    };
    media.enumerateDevices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ deviceId: "back-1", label: "Back Camera", kind: "videoinput" }]);
    media.getUserMedia
      .mockImplementationOnce(() => Promise.resolve(first))
      .mockImplementation(() => new Promise((resolve) => { releaseSecond = resolve; }));

    await act(async () => {
      root.render(React.createElement(WebBarcodeCamera, { active: true, onScan: jest.fn() }));
    });
    await flush();
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(releaseSecond).toEqual(expect.any(Function));

    act(() => { root.unmount(); });
    await act(async () => {
      releaseSecond?.(second);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(second.track.stop).toHaveBeenCalled();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
  });
});
