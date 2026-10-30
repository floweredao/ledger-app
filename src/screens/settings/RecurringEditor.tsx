import { Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, daysInMonth, kstDate } from "../../../shared/dates";
import { FreqSchema, RecurringInputSchema, type RecurringRule } from "../../../shared/schema";
import { api, apiErrorMessage, type Items, paths } from "../../api/client";
import { invalidate, useApi, useOnline } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { Field, Input, Select } from "../../components/Field";
import { Badge } from "../../components/ListRow";
import { Sheet } from "../../components/Sheet";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatDisplayDate, formatWon } from "../../i18n/format";
import { settingsMessages, validationMessage } from "./messages";
import { PayloadFields, parsePayload, payloadDraft } from "./TemplatesEditor";
import "./recurring.css";
import { SubpageHeader } from "./SubpageHeader";

/** Same start-anchored, clamped calendar recurrence as server/domain/recurring. */
export function nextOccurrence(rule: RecurringRule): string | null {
  const start = rule.start_date;
  const year = Number(start.slice(0, 4)),
    month = Number(start.slice(5, 7)),
    day = Number(start.slice(8, 10));
  const last = rule.last_materialized_date;
  let index = 0;
  if (last) {
    const elapsed = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    const steps =
      rule.freq === "daily"
        ? elapsed
        : rule.freq === "weekly"
          ? elapsed / 7
          : rule.freq === "monthly"
            ? (Number(last.slice(0, 4)) - year) * 12 + Number(last.slice(5, 7)) - month
            : Number(last.slice(0, 4)) - year;
    index = Math.max(0, Math.floor(steps / rule.interval));
  }
  for (;;) {
    const steps = index * rule.interval;
    let date: string;
    if (rule.freq === "daily" || rule.freq === "weekly")
      date = addDays(start, steps * (rule.freq === "weekly" ? 7 : 1));
    else {
      const target = year * 12 + month - 1 + (rule.freq === "monthly" ? steps : steps * 12);
      const targetYear = Math.floor(target / 12),
        targetMonth = (target % 12) + 1;
      date = `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, daysInMonth(targetYear, targetMonth))).padStart(2, "0")}`;
    }
    if (!last || date > last) return rule.end_date && date > rule.end_date ? null : date;
    index += 1;
  }
}

const frequencies = () => ({
  daily: messages(settingsMessages).daily,
  weekly: messages(settingsMessages).weekly,
  monthly: messages(settingsMessages).monthly,
  yearly: messages(settingsMessages).yearly,
});

export default function RecurringEditor() {
  const m = useMessages(settingsMessages);
  const c = useMessages(common);
  const { data, error, loading, offline, reload } = useApi<Items<RecurringRule>>(paths.recurring);
  const online = useOnline();
  const [editing, setEditing] = useState<RecurringRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<RecurringRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const rules = data?.items ?? [];
  const disabled = busy || offline || !online;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await action();
      invalidate(paths.recurring);
    } catch (error) {
      setFailure(apiErrorMessage(error, m.changeFailed));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="recurring-screen">
      <SubpageHeader title={m.recurring} />
      <header className="recurring-header">
        <div className="recurring-actions">
          <Button
            disabled={disabled}
            onClick={() =>
              mutate(async () => {
                const result = await api.runRecurring();
                setNotice(m.applied(result.created));
                invalidate("transactions");
                invalidate("stats");
                invalidate("assets");
              })
            }
          >
            {busy ? m.running : m.runNow}
          </Button>
          <Button icon={Plus} variant="primary" disabled={disabled} onClick={() => setEditing("new")}>
            {c.add}
          </Button>
        </div>
      </header>
      {loading && !data && <p role="status">{m.loading}</p>}
      {Boolean(error) && (
        <div role="alert">
          {m.error} <Button onClick={reload}>{c.retry}</Button>
        </div>
      )}
      {(offline || !online) && <p className="recurring-muted">{m.offline}</p>}
      {failure && (
        <p role="alert" className="recurring-error">
          {failure}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && rules.length === 0 && (
        <div className="recurring-empty">
          <p>{m.noRecurring}</p>
          <Button disabled={disabled} onClick={() => setEditing("new")}>
            {m.firstRule}
          </Button>
        </div>
      )}
      <div className="recurring-list">
        {rules.map((rule) => {
          const next = nextOccurrence(rule);
          return (
            <article className="recurring-row" key={rule.id}>
              <div className="recurring-detail">
                <strong>{rule.template.merchant || m.transaction}</strong>
                <p className="num">
                  {m.recurrence(formatWon(rule.template.amount ?? 0), frequencies()[rule.freq], rule.interval)}
                </p>
                <p>{m.nextDate(next ? formatDisplayDate(next) : m.ended)}</p>
                {rule.template.memo && <p>{rule.template.memo}</p>}
                <div className="recurring-actions">
                  {rule.active && next && next <= kstDate() && <Badge tone="warning">{m.pending}</Badge>}
                  {!rule.active && <Badge tone="neutral">{m.inactive}</Badge>}
                </div>
              </div>
              <div className="recurring-actions">
                <IconButton label={m.edit} icon={Edit2} disabled={disabled} onClick={() => setEditing(rule)} />
                <IconButton label={c.delete} icon={Trash2} disabled={disabled} onClick={() => setDeleting(rule)} />
              </div>
            </article>
          );
        })}
      </div>
      {editing && (
        <RecurringEditorSheet
          key={editing === "new" ? "new" : editing.id}
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Sheet
          open
          role="alertdialog"
          title={m.confirmDelete}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <div className="recurring-actions">
              <Button disabled={busy} onClick={() => setDeleting(null)}>
                {c.cancel}
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() =>
                  mutate(async () => {
                    await api.deleteRecurring(deleting.id);
                    setDeleting(null);
                  })
                }
              >
                {c.delete}
              </Button>
            </div>
          }
        >
          <p>{m.deleteRecurring}</p>
        </Sheet>
      )}
    </section>
  );
}

function RecurringEditorSheet({
  editing,
  onClose,
}: {
  readonly editing: RecurringRule | null;
  readonly onClose: () => void;
}) {
  const m = useMessages(settingsMessages);
  const c = useMessages(common);
  const [draft, setDraft] = useState(() => payloadDraft(editing?.template));
  const [freq, setFreq] = useState(editing?.freq ?? "monthly");
  const [interval, setInterval] = useState(String(editing?.interval ?? 1));
  const [start, setStart] = useState(editing?.start_date ?? kstDate());
  const [end, setEnd] = useState(editing?.end_date ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (Object.keys(errors).length > 0) formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [errors]);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  async function save() {
    const payload = parsePayload(draft);
    const input = RecurringInputSchema.safeParse({
      template: payload.success ? payload.data : { type: draft.type },
      freq,
      interval: Number(interval),
      start_date: start,
      end_date: end || null,
      active,
    });
    const issues = {
      ...(!payload.success ? payload.errors : {}),
      ...(!input.success
        ? Object.fromEntries(
            input.error.issues.map((issue) => [
              String(issue.path[0]),
              issue.path[0] === "interval" ? m.intervalInvalid : validationMessage(issue.message),
            ]),
          )
        : {}),
      ...(end && end < start ? { end_date: m.endInvalid } : {}),
    };
    setErrors(issues);
    if (!payload.success || !input.success || Object.keys(issues).length > 0) return;
    setBusy(true);
    setFailure("");
    try {
      if (editing) await api.patchRecurring(editing.id, input.data);
      else await api.createRecurring(input.data);
      invalidate(paths.recurring);
      onClose();
    } catch (error) {
      setFailure(apiErrorMessage(error, m.saveFailed));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={editing ? m.editRule : m.addRule}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="recurring-actions">
          <Button block disabled={busy} onClick={onClose}>
            {c.cancel}
          </Button>
          <Button block variant="primary" disabled={busy || !online} onClick={save}>
            {busy ? c.saving : c.save}
          </Button>
        </div>
      }
    >
      <div className="recurring-form" ref={formRef}>
        <PayloadFields draft={draft} onChange={setDraft} errors={errors} />
        <Field label={m.frequency}>
          {(control) => (
            <Select
              {...control}
              value={freq}
              onChange={(event) => setFreq(FreqSchema.parse(event.currentTarget.value))}
            >
              {Object.entries(frequencies()).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={m.interval} error={errors.interval ?? null}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min="1"
              max="366"
              step="1"
              value={interval}
              onChange={(event) => setInterval(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={m.startDate} error={errors.start_date ?? null}>
          {(control) => (
            <Input {...control} type="date" value={start} onChange={(event) => setStart(event.currentTarget.value)} />
          )}
        </Field>
        <Field label={m.endDateOptional} error={errors.end_date ?? null}>
          {(control) => (
            <Input {...control} type="date" value={end} onChange={(event) => setEnd(event.currentTarget.value)} />
          )}
        </Field>
        <Field label={m.active}>
          {(control) => (
            <Select
              {...control}
              value={String(active)}
              onChange={(event) => setActive(event.currentTarget.value === "true")}
            >
              <option value="true">{m.active}</option>
              <option value="false">{m.inactive}</option>
            </Select>
          )}
        </Field>
        {failure && (
          <p role="alert" className="recurring-error">
            {failure}
          </p>
        )}
      </div>
    </Sheet>
  );
}
