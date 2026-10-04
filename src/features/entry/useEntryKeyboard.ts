import { type RefObject, useEffect, useRef } from "react";
import { type KeypadKey, keypadKeyFor } from "./form";

const TEXT_INPUT_TYPES = new Set(["text", "search", "date", "time", "number", "email", "url", "tel"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

type Handlers = { readonly onKey: (key: KeypadKey) => void; readonly onEnter: () => void };

/** Desktop keyboard for the sheet that contains `formRef`: digits and Backspace edit the amount, Enter saves. */
export function useEntryKeyboard(formRef: RefObject<HTMLFormElement | null>, handlers: Handlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = formRef.current?.closest(".sheet-panel");
      const target = event.target;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) return;
      if (event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        const keypadKey = target instanceof Element && target.closest(".keypad") !== null;
        if ((target instanceof HTMLButtonElement && !keypadKey) || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        latest.current.onEnter();
        return;
      }
      if (isTypingTarget(target)) return;
      const pressed = keypadKeyFor(event.key);
      if (pressed) {
        event.preventDefault();
        latest.current.onKey(pressed);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [formRef]);
}
