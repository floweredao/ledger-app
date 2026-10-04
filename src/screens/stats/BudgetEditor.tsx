import { useEffect, useState } from "react";
import { ApiError, api, NetworkError } from "../../api/client";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Field, Input } from "../../components/Field";
import { Sheet } from "../../components/Sheet";

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
      setError("금액을 입력해 주세요");
      return;
    }
    if (!/^\d+$/.test(value) || Number(value) <= 0 || Number(value) > 1_000_000_000_000) {
      setError("0원보다 큰 금액을 입력해 주세요");
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
        setError("예산을 저장하지 못했어요. 다시 시도해 주세요.");
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
        setError("예산을 삭제하지 못했어요. 다시 시도해 주세요.");
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
        title={`${categoryName} 예산`}
        description="기본 예산은 매월 적용하고, 이번 달만 선택하면 선택한 기간에만 적용해요."
        footer={
          <div className="budget-editor-actions">
            {amount !== null ? (
              <Button
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                disabled={!canDelete || saving || deleting}
                aria-describedby={!canDelete ? "budget-delete-contract" : undefined}
              >
                삭제
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => void save()} disabled={saving || deleting}>
              {saving ? "저장 중" : "저장"}
            </Button>
          </div>
        }
      >
        <div className="budget-editor-form">
          <Field label="금액" hint="원 단위로 입력해 주세요." error={error}>
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
            <legend>적용 범위</legend>
            <label>
              <input
                type="radio"
                name="budget-scope"
                value="default"
                checked={scope === "default"}
                onChange={() => setScope("default")}
              />
              매월 기본 예산
            </label>
            <label>
              <input
                type="radio"
                name="budget-scope"
                value="month"
                checked={scope === "month"}
                onChange={() => setScope("month")}
              />
              이번 달만
            </label>
          </fieldset>
          {amount !== null && !canDelete ? (
            <p className="budget-delete-contract" id="budget-delete-contract" role="note">
              {budgetId === null
                ? "예산 ID를 불러오지 못해 삭제할 수 없어요."
                : "저장된 예산 범위를 선택해야 삭제할 수 있어요."}
            </p>
          ) : null}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        title={`${categoryName} 예산을 삭제할까요?`}
        description="이 예산 설정을 삭제해요. 지출 기록은 그대로 남아요."
        confirmLabel={deleting ? "삭제 중" : "삭제"}
        destructive
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
