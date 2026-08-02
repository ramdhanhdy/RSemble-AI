// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { DialogSurface } from "./DialogSurface";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const handle = useMemo(() => Dialog.createHandle(), []);
  return (
    <>
      <Dialog.Trigger handle={handle} render={<button type="button">Open dialog</button>} />
      <DialogSurface open={open} onOpenChange={setOpen} title="Test dialog" handle={handle}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </DialogSurface>
    </>
  );
}

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<DialogHarness />);
  });
  const trigger = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open dialog",
  )!;
  return { container, root, trigger };
}

function open(trigger: HTMLButtonElement) {
  act(() => {
    trigger.focus();
    trigger.click();
  });
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DialogSurface", () => {
  it("moves focus inside, renders Base UI focus guards, closes on Escape, and restores focus", async () => {
    const { container, root, trigger } = mount();
    open(trigger);
    await settle();

    const popup = document.querySelector<HTMLElement>("[role=dialog]");
    expect(popup).toBeTruthy();
    expect(popup!.contains(document.activeElement)).toBe(true);
    expect(document.querySelectorAll("[data-base-ui-focus-guard]")).not.toHaveLength(0);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => root.unmount());
    container.remove();
  });

  it("dismisses from the backdrop and uses the shared reduced-motion class", () => {
    const { container, root, trigger } = mount();
    open(trigger);

    const backdrop = document.querySelector<HTMLElement>("[data-dialog-backdrop]");
    const popup = document.querySelector<HTMLElement>("[role=dialog]");
    expect(backdrop).toBeTruthy();
    expect(popup?.className).toContain("motion-state");

    act(() => {
      backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      backdrop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
