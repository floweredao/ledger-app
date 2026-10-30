import { Delete } from "lucide-react";
import { useMessages } from "../../i18n";
import type { CalcKey } from "./form";
import { entryMessages } from "./messages";

type Props = {
  readonly onKey: (key: CalcKey) => void;
  /** = shows the result in place; 확인 also moves on to the next field. */
  readonly onEquals: () => void;
  readonly onConfirm: () => void;
};

const OPERATOR_KEYS = ["+", "−", "×", "÷"] as const;

/** Calculator keypad: four operators on top, digits below, 확인 bottom right. */
export function Keypad({ onKey, onEquals, onConfirm }: Props) {
  const t = useMessages(entryMessages);
  const digit = (key: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00") => (
    <button key={key} type="button" className="keypad-key num" onClick={() => onKey(key)}>
      {key}
    </button>
  );
  return (
    <fieldset className="keypad entry-fieldset">
      <legend className="sr-only">{t.amountKeypad}</legend>
      {OPERATOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="keypad-key keypad-operator"
          aria-label={t.operator(key)}
          onClick={() => onKey(key)}
        >
          {key}
        </button>
      ))}
      {digit("7")}
      {digit("8")}
      {digit("9")}
      <button type="button" className="keypad-key keypad-operator" onClick={() => onKey("clear")}>
        {t.clearKey}
      </button>
      {digit("4")}
      {digit("5")}
      {digit("6")}
      <button type="button" className="keypad-key keypad-operator" aria-label={t.equals} onClick={onEquals}>
        =
      </button>
      {digit("1")}
      {digit("2")}
      {digit("3")}
      <button type="button" className="keypad-key" aria-label={t.backspace} onClick={() => onKey("backspace")}>
        <Delete aria-hidden="true" size={22} strokeWidth={2} />
      </button>
      {digit("00")}
      {digit("0")}
      <button type="button" className="keypad-key keypad-confirm" onClick={onConfirm}>
        {t.confirmAmount}
      </button>
    </fieldset>
  );
}
