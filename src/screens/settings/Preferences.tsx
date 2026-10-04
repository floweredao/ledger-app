import "./preferences.css";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type Asset, type Settings, type SettingsPatch, ThemeSchema } from "../../../shared/schema";
import { api, type Items, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Field, Input, Select } from "../../components/Field";
import { Skeleton } from "../../components/Skeleton";

type Draft = Omit<Settings, "month_start_day"> & { month_start_day: string };
export default function Preferences() {
  const settings = useApi<Settings>(paths.settings);
  const assets = useApi<Items<Asset>>(paths.assets({ include_hidden: true }));
  const initialized = useRef(false);
  const [draft, setDraft] = useState<Draft>({
    month_start_day: "1",
    owner_name: "",
    theme: "system",
    default_asset_id: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !initialized.current) {
      initialized.current = true;
      setDraft({ ...settings.data, month_start_day: String(settings.data.month_start_day) });
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
      nextErrors.month_start_day = "1부터 28 사이의 숫자를 입력해요.";
    }
    if (draft.owner_name.length > 40) nextErrors.owner_name = "이름은 40자까지 입력해요.";
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
      setSaveError("저장할 수 없어요. 입력 내용을 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };
  if (!settings.data && settings.loading)
    return (
      <section className="screen">
        <h1 className="screen-title">환경 설정</h1>
        <Skeleton rows={3} label="로드 중..." />
      </section>
    );
  if (!settings.data)
    return (
      <section className="screen">
        <h1 className="screen-title">환경 설정</h1>
        <EmptyState
          tone="error"
          title="설정을 불러올 수 없어요"
          action={<Button onClick={settings.reload}>다시 시도</Button>}
        />
      </section>
    );
  return (
    <section className="screen">
      <h1 className="screen-title">환경 설정</h1>
      <form className="preferences-form" onSubmit={submit} noValidate>
        <Field
          label="월 시작일"
          hint="예산과 월 통계에 적용해요. 달력은 1일부터 말일까지예요."
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
        <Field
          label="이름"
          hint="본인 계좌 사이의 이체를 구분할 때 사용해요."
          {...(errors.owner_name ? { error: errors.owner_name } : {})}
        >
          {(control) => (
            <Input
              {...control}
              maxLength={40}
              value={draft.owner_name}
              onChange={(event) => change("owner_name", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="테마">
          {(control) => (
            <Select
              {...control}
              value={draft.theme}
              onChange={(event) => {
                const parsed = ThemeSchema.safeParse(event.currentTarget.value);
                if (parsed.success) change("theme", parsed.data);
              }}
            >
              <option value="system">시스템 설정</option>
              <option value="light">밝음</option>
              <option value="dark">어두움</option>
            </Select>
          )}
        </Field>
        <Field label="기본 자산" hint="기록할 때 사용할 기본 자산을 선택해요.">
          {(control) => (
            <Select
              {...control}
              value={draft.default_asset_id ?? ""}
              disabled={assets.loading && !assets.data}
              onChange={(event) => change("default_asset_id", event.currentTarget.value || null)}
            >
              <option value="">자동 선택</option>
              {(assets.data?.items ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {asset.hidden ? " (숨김)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {assets.error && !assets.data ? <Button onClick={assets.reload}>자산 다시 불러오기</Button> : null}
        {saveError ? (
          <p className="field-error" role="alert">
            {saveError}
          </p>
        ) : null}
        {saved ? <p role="status">설정을 저장했어요</p> : null}
        <Button type="submit" variant="primary" block disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </Button>
      </form>
    </section>
  );
}
