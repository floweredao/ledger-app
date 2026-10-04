import { type ComponentProps, type ReactNode, useId } from "react";

export type FieldControlProps = {
  readonly id: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: true;
};

type FieldProps = {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly children: (control: FieldControlProps) => ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");
  const control: FieldControlProps = {
    id,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(control)}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={["input", className ?? ""].join(" ").trim()} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={["input", "select", className ?? ""].join(" ").trim()} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={["input", "textarea", className ?? ""].join(" ").trim()} {...rest} />;
}
