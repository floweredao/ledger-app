import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type Asset,
  type AssetInput,
  AssetInputSchema,
  AssetKindSchema,
  type AssetPatch,
} from "../../../shared/schema";
import { api, type Items, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Field, Input, Select } from "../../components/Field";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import "./assets.css";

const KIND_LABELS = {
  cash: "현금",
  bank: "입출금",
  check_card: "체크카드",
  credit_card: "신용카드",
  savings: "저축",
  other: "기타",
  loan: "대출",
} as const;
const blank: AssetInput = {
  name: "",
  kind: "bank",
  group_name: "",
  opening_balance: 0,
  opening_date: null,
  hidden: false,
  linked_asset_id: null,
  settlement_day: null,
  payment_day: null,
  performance_target: null,
};
function editable(asset: Asset): AssetInput {
  return {
    name: asset.name,
    kind: asset.kind,
    group_name: asset.group_name,
    opening_balance: asset.opening_balance,
    opening_date: asset.opening_date,
    hidden: asset.hidden,
    linked_asset_id: asset.linked_asset_id,
    settlement_day: asset.settlement_day,
    payment_day: asset.payment_day,
    performance_target: asset.performance_target,
  };
}
type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly id: string | null;
};
export function AssetEditor({ open, onClose, id, onSaved }: Props) {
  const assets = useApi<Items<Asset>>(open ? paths.assets({ include_hidden: true }) : null);
  const [form, setForm] = useState<AssetInput>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [discard, setDiscard] = useState(false);
  const initialized = useRef<string | null>(null);
  const original = useRef<AssetInput>(blank);
  const sessionKey = id ?? "create";
  const asset = assets.data?.items.find((item) => item.id === id);
  useEffect(() => {
    if (!open) {
      initialized.current = null;
      setReady(false);
      return;
    }
    if (initialized.current === sessionKey || (id && !asset)) return;
    const initial = asset ? editable(asset) : blank;
    original.current = initial;
    setForm(initial);
    setErrors({});
    setDiscard(false);
    initialized.current = sessionKey;
    setReady(true);
  }, [open, id, sessionKey, asset]);
  const dirty = JSON.stringify(form) !== JSON.stringify(original.current);
  const close = () => (dirty ? setDiscard(true) : onClose());
  const card = form.kind === "check_card" || form.kind === "credit_card";
  const accounts =
    assets.data?.items.filter((item) => item.id !== id && (item.kind === "bank" || item.kind === "savings")) ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    const parsed = AssetInputSchema.safeParse(form);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
    if (card && !accounts.some((item) => item.id === form.linked_asset_id))
      next.linked_asset_id = "연결된 계좌를 선택해주세요";
    setErrors(next);
    if (!parsed.success || Object.keys(next).length) return;
    setSaving(true);
    try {
      if (id) {
        const patch: AssetPatch = Object.fromEntries(
          Object.entries(parsed.data).filter(([key, value]) => value !== Reflect.get(original.current, key)),
        );
        if (Object.keys(patch).length) await api.patchAsset(id, patch);
      } else await api.createAsset(parsed.data);
      invalidate("assets");
      toast({ message: id ? "자산이 수정되었어요" : "자산이 추가되었어요" });
      onSaved();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "저장에 실패했어요" });
    } finally {
      setSaving(false);
    }
  };
  const failed = assets.error !== undefined && !assets.data;
  const missing = id && !assets.loading && assets.data && !asset;
  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title={id ? "자산 편집" : "자산 추가"}
        footer={
          <div className="asset-actions">
            <Button onClick={close} disabled={saving}>
              취소
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="asset-editor-form"
              disabled={saving || !ready || Boolean(missing) || failed}
            >
              저장
            </Button>
          </div>
        }
      >
        {failed ? (
          <div role="alert">
            자산을 불러올 수 없어요<Button onClick={assets.reload}>다시 시도</Button>
          </div>
        ) : missing ? (
          <p role="alert">자산을 찾을 수 없어요</p>
        ) : !ready ? (
          <Skeleton rows={4} />
        ) : (
          <form id="asset-editor-form" className="asset-form" onSubmit={submit} noValidate>
            {errors.form && (
              <p role="alert" className="asset-error">
                {errors.form}
              </p>
            )}
            <Field label="이름" error={errors.name ?? null}>
              {(control) => (
                <Input
                  {...control}
                  value={form.name}
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="종류">
              {(control) => (
                <Select
                  {...control}
                  value={form.kind}
                  onChange={(e) => {
                    const kind = AssetKindSchema.parse(e.target.value);
                    const isCard = kind === "check_card" || kind === "credit_card";
                    setForm({
                      ...form,
                      kind,
                      linked_asset_id: isCard ? form.linked_asset_id : null,
                      settlement_day: isCard ? (form.settlement_day ?? 1) : null,
                      payment_day: kind === "credit_card" ? (form.payment_day ?? 25) : null,
                      performance_target: kind === "credit_card" ? form.performance_target : null,
                    });
                  }}
                >
                  {AssetKindSchema.options.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="그룹" error={errors.group_name ?? null}>
              {(control) => (
                <Input
                  {...control}
                  value={form.group_name}
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                />
              )}
            </Field>
            <Field label="기존 잔액" error={errors.opening_balance ?? null}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  value={form.opening_balance}
                  onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field
              label="잔액 기준일 (선택)"
              hint={
                form.kind === "check_card"
                  ? "체크카드 잔액은 연결 계좌의 기준일을 따라요."
                  : "한국 시간 기준, 이날 이전 거래는 기존 잔액에 포함돼요. 비우면 모든 거래를 반영해요."
              }
              error={errors.opening_date ?? null}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={form.opening_date ?? ""}
                  onChange={(e) => setForm({ ...form, opening_date: e.target.value || null })}
                />
              )}
            </Field>
            {card && (
              <Field label="연결된 계좌" error={errors.linked_asset_id ?? null}>
                {(control) => (
                  <Select
                    {...control}
                    value={form.linked_asset_id ?? ""}
                    onChange={(e) => setForm({ ...form, linked_asset_id: e.target.value || null })}
                  >
                    <option value="">선택...</option>
                    {accounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.hidden ? " (숨김)" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {card && (
              <Field label="마감일" error={errors.settlement_day ?? null}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    max={31}
                    value={form.settlement_day ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, settlement_day: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                )}
              </Field>
            )}
            {form.kind === "credit_card" && (
              <>
                <Field label="결제일" error={errors.payment_day ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={1}
                      max={31}
                      value={form.payment_day ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, payment_day: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  )}
                </Field>
                <Field label="실적 목표 (선택)" error={errors.performance_target ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={0}
                      value={form.performance_target ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, performance_target: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  )}
                </Field>
              </>
            )}
            <label className="asset-checkbox">
              <input
                type="checkbox"
                checked={form.hidden}
                onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
              />
              숨김
            </label>
          </form>
        )}
      </Sheet>
      <ConfirmDialog
        open={discard}
        title="작성 중인 내용을 버릴까요?"
        confirmLabel="버리기"
        cancelLabel="계속 작성"
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
        destructive
      />
    </>
  );
}
