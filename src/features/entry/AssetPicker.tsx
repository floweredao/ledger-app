import { useId } from "react";
import type { Asset } from "../../../shared/schema";
import { Chip } from "../../components/Chip";

type Props = {
  readonly label: string;
  readonly assets: readonly Asset[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  readonly error?: string | undefined;
};

export function AssetPicker({ label, assets, value, onChange, error }: Props) {
  const id = useId();
  return (
    <fieldset className="entry-section entry-fieldset" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="entry-label">{label}</legend>
      {assets.length === 0 ? (
        <p className="entry-hint">등록된 자산이 없어요. 자산 화면에서 먼저 추가해 주세요.</p>
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
