import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { preferencesMessages } from "./preferences-messages";
import "./preferences.css";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type Asset,
  LanguageSchema,
  LedgerViewSchema,
  type Settings,
  type SettingsPatch,
  ThemeSchema,
} from "../../../shared/schema";
import { api, type Items, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Field, Input, Select } from "../../components/Field";
import { Skeleton } from "../../components/Skeleton";

type Draft = Omit<Settings, "month_start_day"> & { month_start_day: string };
export default function Preferences() {
  const m = useMessages(preferencesMessages);
  const c = useMessages(common);
  const settings = useApi<Settings>(paths.settings);
  const assets = useApi<Items<Asset>>(paths.assets({ include_hidden: true }));
  const initialized = useRef(false);
  const [draft, setDraft] = useState<Draft>({
    month_start_day: "1",
    owner_name: "",
    theme: "system",
    default_asset_id: null,
    ledger_view: "daily",
    language: "system",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !initialized.current) {
      initialized.current = true;
      setDraft({
        ...settings.data,
        language: settings.data.language ?? "system",
        month_start_day: String(settings.data.month_start_day),
      });
    }
  }, [settings.data]);
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setSaved(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const monthStart = Number(draft.month_start_day);
    const nextErrors: typeof errors = {};
    if (!draft.month_start_day.trim() || !Number.isInteger(monthStart) || monthStart < 1 || monthStart > 28) {
      nextErrors.month_start_day = m.monthStartError;
    }
    if (draft.owner_name.length > 40) nextErrors.owner_name = m.nameError;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const patch: SettingsPatch = { ...draft, owner_name: draft.owner_name.trim(), month_start_day: monthStart };
    try {
      const result = await api.patchSettings(patch);
      setDraft({ ...result, month_start_day: String(result.month_start_day) });
      for (const prefix of ["settings", "transactions", "stats", "budgets", "assets"]) invalidate(prefix);
      setSaved(true);
    } catch {
      setSaveError(m.saveError);
    } finally {
      setSaving(false);
    }
  };
  if (!settings.data && settings.loading)
    return (
      <section className="screen">
        <h1 className="screen-title">{m.title}</h1>
        <div role="status" aria-label={m.loading}>
          <Skeleton rows={3} label={m.loading} />
        </div>
      </section>
    );
  if (!settings.data)
    return (
      <section className="screen">
        <h1 className="screen-title">{m.title}</h1>
        <EmptyState tone="error" title={m.loadError} action={<Button onClick={settings.reload}>{c.retry}</Button>} />
      </section>
    );
  return (
    <section className="screen">
      <h1 className="screen-title">{m.title}</h1>
      <form className="preferences-form" onSubmit={submit} noValidate>
        <Field
          label={m.monthStart}
          hint={m.monthStartHint}
          {...(errors.month_start_day ? { error: errors.month_start_day } : {})}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={28}
              value={draft.month_start_day}
              onChange={(event) => change("month_start_day", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={m.name} hint={m.nameHint} {...(errors.owner_name ? { error: errors.owner_name } : {})}>
          {(control) => (
            <Input
              {...control}
              maxLength={40}
              value={draft.owner_name}
              onChange={(event) => change("owner_name", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={m.theme}>
          {(control) => (
            <Select
              {...control}
              value={draft.theme}
              onChange={(event) => {
                const parsed = ThemeSchema.safeParse(event.currentTarget.value);
                if (parsed.success) change("theme", parsed.data);
              }}
            >
              <option value="system">{m.system}</option>
              <option value="light">{m.light}</option>
              <option value="dark">{m.dark}</option>
            </Select>
          )}
        </Field>
        <Field label={m.language} hint={m.languageHint}>
          {(control) => (
            <Select
              {...control}
              value={draft.language}
              onChange={(event) => {
                const parsed = LanguageSchema.safeParse(event.currentTarget.value);
                if (parsed.success) change("language", parsed.data);
              }}
            >
              <option value="system">{m.system}</option>
              <option value="ko" lang="ko">
                {m.korean}
              </option>
              <option value="en" lang="en">
                {m.english}
              </option>
            </Select>
          )}
        </Field>
        <Field label={m.firstView} hint={m.firstViewHint}>
          {(control) => (
            <Select
              {...control}
              value={draft.ledger_view}
              onChange={(event) => {
                const parsed = LedgerViewSchema.safeParse(event.currentTarget.value);
                if (parsed.success) change("ledger_view", parsed.data);
              }}
            >
              <option value="daily">{m.daily}</option>
              <option value="calendar">{m.calendar}</option>
              <option value="monthly">{m.monthly}</option>
            </Select>
          )}
        </Field>
        <Field label={m.defaultAsset} hint={m.defaultAssetHint}>
          {(control) => (
            <Select
              {...control}
              value={draft.default_asset_id ?? ""}
              disabled={assets.loading && !assets.data}
              onChange={(event) => change("default_asset_id", event.currentTarget.value || null)}
            >
              <option value="">{m.automatic}</option>
              {(assets.data?.items ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {asset.hidden ? m.hiddenSuffix : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {assets.error && !assets.data ? <Button onClick={assets.reload}>{m.reloadAssets}</Button> : null}
        {saveError ? (
          <p className="field-error" role="alert">
            {saveError}
          </p>
        ) : null}
        {saved ? <p role="status">{m.saved}</p> : null}
        <Button type="submit" variant="primary" block disabled={saving}>
          {saving ? c.saving : c.save}
        </Button>
      </form>
    </section>
  );
}
