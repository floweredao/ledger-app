import { Delete } from "lucide-react";
import { useMessages } from "../../i18n";
import type { KeypadKey } from "./form";
import { entryMessages } from "./messages";

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"] as const satisfies readonly KeypadKey[];

type Props = {
  readonly onKey: (key: KeypadKey) => void;
  readonly hidden?: boolean;
};

export function Keypad({ onKey, hidden = false }: Props) {
  const t = useMessages(entryMessages);
  return (
    <fieldset className="keypad entry-fieldset" hidden={hidden}>
      <legend className="sr-only">{t.amountKeypad}</legend>
      {DIGIT_KEYS.map((key) => (
        <button key={key} type="button" className="keypad-key num" onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button type="button" className="keypad-key" aria-label={t.backspace} onClick={() => onKey("backspace")}>
        <Delete aria-hidden="true" size={22} strokeWidth={2} />
      </button>
    </fieldset>
  );
}
