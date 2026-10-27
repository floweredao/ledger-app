import { useEffect, useState } from "react";
import { ApiError, api, NetworkError } from "../../api/client";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Field, Input } from "../../components/Field";
import { Sheet } from "../../components/Sheet";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { statsMessages } from "./messages";

type Scope = "default" | "month";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly month: string;
  readonly categoryId: string | null;
  readonly categoryName: string;
  readonly amount: number | null;
  readonly budgetId: string | null;
  readonly budgetMonth: string | null;
  readonly onSaved: () => void;
  readonly onDeleted: () => void;
};

export function BudgetEditor({
  open,
  onClose,
  month,
  categoryId,
  categoryName,
  amount,
  budgetId,
  budgetMonth,
  onSaved,
  onDeleted,
}: Props) {
  const m = useMessages(statsMessages);
  const c = useMessages(common);
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<Scope>("default");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete =
    budgetId !== null && ((budgetMonth === "" && scope === "default") || (budgetMonth === month && scope === "month"));

  useEffect(() => {
    if (!open) return;
    setValue(amount === null ? "" : String(amount));
    setScope(budgetMonth === month ? "month" : "default");
    setError(null);
  }, [open, amount, budgetMonth, month]);

  const save = async () => {
    if (value.trim() === "") {
      setError(m.enterAmount);
      return;
    }
    if (!/^\d+$/.test(value) || Number(value) <= 0 || Number(value) > 1_000_000_000_000) {
      setError(m.positiveAmount);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.putBudget({
        amount: Number(value),
        ...(categoryId === null ? {} : { category_id: categoryId }),
        ...(scope === "month" ? { month } : {}),
      });
      onSaved();
      onClose();
    } catch (caught: unknown) {
      if (caught instanceof ApiError || caught instanceof NetworkError) {
        setError(m.saveBudgetFailed);
      } else {
        throw caught;
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!canDelete || budgetId === null) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteBudget(budgetId);
      setConfirmDelete(false);
      onDeleted();
    } catch (caught: unknown) {
      if (caught instanceof ApiError || caught instanceof NetworkError) {
        setError(m.deleteBudgetFailed);
      } else {
        throw caught;
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={m.budgetTitle(categoryName)}
        description={m.budgetDescription}
        footer={
          <div className="budget-editor-actions">
            {amount !== null ? (
              <Button
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                disabled={!canDelete || saving || deleting}
                aria-describedby={!canDelete ? "budget-delete-contract" : undefined}
              >
                {c.delete}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => void save()} disabled={saving || deleting}>
              {saving ? m.saving : c.save}
            </Button>
          </div>
        }
      >
        <div className="budget-editor-form">
          <Field label={m.amount} hint={m.wonHint} error={error}>
            {(control) => (
              <Input
                {...control}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={value}
                onChange={(event) => {
                  setValue(event.currentTarget.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <fieldset className="budget-scope">
            <legend>{m.scope}</legend>
            <label>
              <input
                type="radio"
                name="budget-scope"
                value="default"
                checked={scope === "default"}
                onChange={() => setScope("default")}
              />
              {m.defaultBudget}
            </label>
            <label>
              <input
                type="radio"
                name="budget-scope"
                value="month"
                checked={scope === "month"}
                onChange={() => setScope("month")}
              />
              {m.thisMonth}
            </label>
          </fieldset>
          {amount !== null && !canDelete ? (
            <p className="budget-delete-contract" id="budget-delete-contract" role="note">
              {budgetId === null ? m.missingBudgetId : m.selectSavedScope}
            </p>
          ) : null}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        title={m.deleteBudgetTitle(categoryName)}
        description={m.deleteDescription}
        confirmLabel={deleting ? m.deleting : c.delete}
        destructive
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
