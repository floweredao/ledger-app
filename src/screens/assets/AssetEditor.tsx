import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type Asset,
  type AssetInput,
  AssetInputSchema,
  AssetKindSchema,
  type AssetPatch,
  type AssetSummary,
  MAX_AMOUNT,
} from "../../../shared/schema";
import { api, type Items, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Field, Input, Select } from "../../components/Field";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatSigned } from "../../i18n/format";
import { assetsMessages } from "./messages";
import "./assets.css";

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
type RecordAs = "adjustment" | "flow";
export function AssetEditor({ open, onClose, id, onSaved }: Props) {
  const m = useMessages(assetsMessages);
  const c = useMessages(common);
  const KIND_LABELS = {
    cash: m.cash,
    bank: m.bank,
    check_card: m.checkCard,
    credit_card: m.creditCard,
    savings: m.savings,
    other: m.other,
    loan: m.loan,
  } as const;

  const assets = useApi<Items<AssetSummary["assets"][number]>>(open ? paths.assets({ include_hidden: true }) : null);
  const [form, setForm] = useState<AssetInput>(blank);
  const [balanceText, setBalanceText] = useState("");
  const [recordAs, setRecordAs] = useState<RecordAs>("adjustment");
  const originalBalance = useRef(0);
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
    originalBalance.current = asset?.balance ?? 0;
    setBalanceText(String(originalBalance.current));
    setRecordAs("adjustment");
    setForm(initial);
    setErrors({});
    setDiscard(false);
    initialized.current = sessionKey;
    setReady(true);
  }, [open, id, sessionKey, asset]);
  // Editing an existing asset asks for today's balance instead of the opening one; a debit card follows its account.
  const showBalance = id !== null && form.kind !== "check_card";
  const enteredBalance = balanceText.trim() === "" ? Number.NaN : Number(balanceText);
  const balanceValid = Number.isInteger(enteredBalance) && Math.abs(enteredBalance) <= MAX_AMOUNT;
  const difference = showBalance && balanceValid ? enteredBalance - originalBalance.current : 0;
  const dirty =
    JSON.stringify(form) !== JSON.stringify(original.current) ||
    (showBalance && balanceText !== String(originalBalance.current));
  const close = () => (dirty ? setDiscard(true) : onClose());
  const card = form.kind === "check_card" || form.kind === "credit_card";
  const accounts =
    assets.data?.items.filter((item) => item.id !== id && (item.kind === "bank" || item.kind === "savings")) ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    const parsed = AssetInputSchema.safeParse(form);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] = m.invalidValue;
    if (card && !accounts.some((item) => item.id === form.linked_asset_id))
      next.linked_asset_id = m.chooseLinkedAccount;
    if (showBalance && !balanceValid) next.balance = m.invalidValue;
    setErrors(next);
    if (!parsed.success || Object.keys(next).length) return;
    setSaving(true);
    try {
      if (id) {
        const patch: AssetPatch = Object.fromEntries(
          Object.entries(parsed.data).filter(([key, value]) => value !== Reflect.get(original.current, key)),
        );
        if (Object.keys(patch).length) await api.patchAsset(id, patch);
        if (difference !== 0) {
          await api.adjustBalance(id, {
            balance: enteredBalance,
            record_as: recordAs === "adjustment" ? "adjustment" : difference > 0 ? "income" : "expense",
            merchant: m.balanceAdjustment,
          });
          for (const prefix of ["transactions", "stats", "budgets"]) invalidate(prefix);
        }
      } else await api.createAsset(parsed.data);
      invalidate("assets");
      toast({ message: difference !== 0 ? m.balanceAdjusted : id ? m.assetUpdated : m.assetAdded });
      onSaved();
    } catch {
      setErrors({ form: m.saveFailed });
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
        title={id ? m.editAsset : m.addAsset}
        footer={
          <div className="asset-actions">
            <Button onClick={close} disabled={saving}>
              {c.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="asset-editor-form"
              disabled={saving || !ready || Boolean(missing) || failed}
            >
              {c.save}
            </Button>
          </div>
        }
      >
        {failed ? (
          <div role="alert">
            {m.loadAssetsFailed}
            <Button onClick={assets.reload}>{c.retry}</Button>
          </div>
        ) : missing ? (
          <p role="alert">{m.assetMissing}</p>
        ) : !ready ? (
          <Skeleton rows={4} label={m.loading} />
        ) : (
          <form id="asset-editor-form" className="asset-form" onSubmit={submit} noValidate>
            {errors.form && (
              <p role="alert" className="asset-error">
                {errors.form}
              </p>
            )}
            <Field label={m.name} error={errors.name ?? null}>
              {(control) => (
                <Input
                  {...control}
                  value={form.name}
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={m.kind}>
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
            <Field label={m.group} error={errors.group_name ?? null}>
              {(control) => (
                <Input
                  {...control}
                  value={form.group_name}
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                />
              )}
            </Field>
            {id === null ? (
              <Field label={m.openingBalance} error={errors.opening_balance ?? null}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })}
                  />
                )}
              </Field>
            ) : showBalance ? (
              <>
                <Field
                  label={m.currentBalance}
                  hint={
                    difference === 0
                      ? m.currentBalanceHint
                      : m.differenceLabel(formatSigned(difference > 0 ? "income" : "expense", Math.abs(difference)))
                  }
                  error={errors.balance ?? null}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="numeric"
                      value={balanceText}
                      onChange={(e) => setBalanceText(e.target.value)}
                    />
                  )}
                </Field>
                {difference !== 0 && (
                  <div className="field">
                    <span className="field-label" aria-hidden="true">
                      {m.recordAs}
                    </span>
                    <SegmentedControl<RecordAs>
                      label={m.recordAs}
                      value={recordAs}
                      onChange={setRecordAs}
                      options={[
                        { value: "adjustment", label: m.adjustmentOnly },
                        { value: "flow", label: difference > 0 ? m.asIncome : m.asExpense },
                      ]}
                    />
                    <p className="field-hint">
                      {recordAs === "adjustment"
                        ? m.adjustmentOnlyHint
                        : difference > 0
                          ? m.asIncomeHint
                          : m.asExpenseHint}
                    </p>
                  </div>
                )}
              </>
            ) : null}
            <Field
              label={m.openingDate}
              hint={form.kind === "check_card" ? m.debitDateHint : m.balanceDateHint}
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
              <Field label={m.linkedAccount} error={errors.linked_asset_id ?? null}>
                {(control) => (
                  <Select
                    {...control}
                    value={form.linked_asset_id ?? ""}
                    onChange={(e) => setForm({ ...form, linked_asset_id: e.target.value || null })}
                  >
                    <option value="">{m.choose}</option>
                    {accounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.hidden ? m.hiddenOption : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {card && (
              <Field label={m.settlementDay} error={errors.settlement_day ?? null}>
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
                <Field label={m.paymentDay} error={errors.payment_day ?? null}>
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
                <Field label={m.targetOptional} error={errors.performance_target ?? null}>
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
              {m.hidden}
            </label>
          </form>
        )}
      </Sheet>
      <ConfirmDialog
        open={discard}
        title={m.discardTitle}
        confirmLabel={m.discard}
        cancelLabel={m.keepEditing}
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
