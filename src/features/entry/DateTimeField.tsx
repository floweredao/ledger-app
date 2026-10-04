import { Field, Input } from "../../components/Field";

type Props = {
  readonly date: string;
  readonly time: string;
  readonly onChange: (next: { readonly date: string; readonly time: string }) => void;
  readonly error?: string | undefined;
};

export function DateTimeField({ date, time, onChange, error }: Props) {
  return (
    <div className="entry-datetime">
      <Field label="날짜" error={error ?? null}>
        {(control) => (
          <Input {...control} type="date" value={date} onChange={(e) => onChange({ date: e.target.value, time })} />
        )}
      </Field>
      <Field label="시간">
        {(control) => (
          <Input {...control} type="time" value={time} onChange={(e) => onChange({ date, time: e.target.value })} />
        )}
      </Field>
    </div>
  );
}
