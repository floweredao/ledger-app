import { Plus } from "lucide-react";
import { openEntry } from "../app/entry-bridge";
import { useMessages } from "../i18n";
import { common } from "../i18n/common";
import { ICON_STROKE_WIDTH } from "./Button";

/** The floating record command above the tab bar, outside the nav landmark. */
export function RecordButton() {
  const c = useMessages(common);
  return (
    <button type="button" className="record-fab" aria-label={c.record} onClick={() => openEntry()}>
      <Plus aria-hidden="true" size={26} strokeWidth={ICON_STROKE_WIDTH} />
    </button>
  );
}
