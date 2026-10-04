import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Sheet } from "./Sheet";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Sheet
        open={open}
        title="기록하기"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <input aria-label="금액" />
        <button type="button">저장</button>
      </Sheet>
    </>
  );
}

afterEach(cleanup);

function openSheet() {
  const opener = screen.getByText("열기");
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("dialog", { name: "기록하기" }) };
}

describe("Sheet", () => {
  test("is absent until opened, then labelled and modal", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const { dialog } = openSheet();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  test("moves focus into the sheet on open", () => {
    render(<Harness />);
    const { dialog } = openSheet();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("금액"));
  });

  test("traps Tab and Shift+Tab inside the sheet", () => {
    render(<Harness />);
    openSheet();
    const save = screen.getByText("저장");
    const close = screen.getByRole("button", { name: "닫기" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  test("Escape closes it and focus returns to the opener", async () => {
    let closed = 0;
    render(<Harness onClose={() => closed++} />);
    const { opener } = openSheet();
    fireEvent.keyDown(screen.getByLabelText("금액"), { key: "Escape" });
    expect(closed).toBe(1);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test("Escape during IME composition does not close", () => {
    let closed = 0;
    render(<Harness onClose={() => closed++} />);
    openSheet();
    fireEvent.keyDown(screen.getByLabelText("금액"), { key: "Escape", isComposing: true });
    expect(closed).toBe(0);
  });

  test("the close button closes it", () => {
    let closed = 0;
    render(<Harness onClose={() => closed++} />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(closed).toBe(1);
  });
});
