import { useId } from "react";
import type { Asset } from "../../../shared/schema";
import { Chip } from "../../components/Chip";
import { useMessages } from "../../i18n";
import { entryMessages } from "./messages";

type Props = {
  readonly label: string;
  readonly assets: readonly Asset[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  readonly error?: string | undefined;
};

export function AssetPicker({ label, assets, value, onChange, error }: Props) {
  const t = useMessages(entryMessages);
  const id = useId();
  return (
    <fieldset className="entry-section entry-fieldset" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="entry-label">{label}</legend>
      {assets.length === 0 ? (
        <p className="entry-hint">{t.noAssets}</p>
      ) : (
        <div className="chip-row">
          {assets.map((asset) => (
            <Chip key={asset.id} selected={asset.id === value} onClick={() => onChange(asset.id)}>
              {asset.name}
            </Chip>
          ))}
        </div>
      )}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
