import type { Asset } from "../../../shared/schema";
import { useMessages } from "../../i18n";
import { entryMessages } from "./messages";

type Props = {
  readonly label: string;
  readonly assets: readonly Asset[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
};

/** The 자산 grid in the entry panel. */
export function AssetPicker({ label, assets, value, onChange }: Props) {
  const t = useMessages(entryMessages);
  return (
    <fieldset className="entry-fieldset entry-picker">
      <legend className="sr-only">{label}</legend>
      {assets.length === 0 ? (
        <p className="entry-hint">{t.noAssets}</p>
      ) : (
        <div className="picker-grid">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="picker-tile"
              aria-pressed={asset.id === value}
              onClick={() => onChange(asset.id)}
            >
              <span className="picker-tile-name">{asset.name}</span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
