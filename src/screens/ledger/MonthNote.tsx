import { useId, useState } from "react";
import { api, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatMonth } from "../../i18n/format";
import { ledgerMessages } from "./messages";

type Note = { readonly month: string; readonly body: string; readonly updated_at: string | null };

/** 메모: one free-text note per month, saved explicitly. Keyed by month, so a new month starts clean. */
export default function MonthNote({ month }: { readonly month: string }) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const id = useId();
  const note = useApi<Note>(paths.monthNote(month));
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (note.data === undefined && note.loading) return <Skeleton rows={2} label={m.loading} />;
  if (note.data === undefined) {
    return (
      <EmptyState
        tone="error"
        title={c.loadFailed}
        action={
          <Button size="sm" onClick={note.reload}>
            {c.retry}
          </Button>
        }
      />
    );
  }
  const saved = note.data.body;
  const value = draft ?? saved;
  const save = async () => {
    setSaving(true);
    setError(false);
    try {
      await api.putMonthNote(month, value);
      invalidate(paths.monthNote(month));
      setDraft(null);
      toast({ message: m.noteSaved });
    } catch (failure) {
      console.warn("month note save failed", failure);
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="month-note" aria-labelledby={`${id}-label`}>
      <label className="field-label" id={`${id}-label`} htmlFor={`${id}-body`}>
        {m.noteFor(formatMonth(month))}
      </label>
      <textarea
        id={`${id}-body`}
        className="input textarea month-note-body"
        rows={8}
        maxLength={2000}
        placeholder={m.notePlaceholder}
        value={value}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {m.noteFailed}
        </p>
      ) : null}
      <Button
        variant="primary"
        block
        disabled={saving || value === saved}
        aria-busy={saving}
        onClick={() => void save()}
      >
        {saving ? c.saving : c.save}
      </Button>
    </section>
  );
}
