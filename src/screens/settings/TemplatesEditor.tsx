import { Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { nowKst } from "../../../shared/dates";
import {
  type Asset,
  type CategoryNode,
  type Template,
  TemplateInputSchema,
  type TemplatePayload,
  TemplatePayloadSchema,
  TransactionInputSchema,
  TransactionTypeSchema,
} from "../../../shared/schema";
import { api, type Items, paths } from "../../api/client";
import { invalidate, useApi, useOnline } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { Field, Input, Select, Textarea } from "../../components/Field";
import { Sheet } from "../../components/Sheet";
import "./recurring.css";

const recordFromTemplate = api.useTemplate;

export type PayloadDraft = {
  type: TemplatePayload["type"];
  amount: string;
  asset_id: string;
  to_asset_id: string;
  category_id: string;
  merchant: string;
  memo: string;
  is_refund: boolean;
};

export function payloadDraft(payload?: TemplatePayload): PayloadDraft {
  return {
    type: payload?.type ?? "expense",
    amount: String(payload?.amount ?? 0),
    asset_id: payload?.asset_id ?? "",
    to_asset_id: payload?.to_asset_id ?? "",
    category_id: payload?.category_id ?? "",
    merchant: payload?.merchant ?? "",
    memo: payload?.memo ?? "",
    is_refund: payload?.is_refund ?? false,
  };
}

export function parsePayload(draft: PayloadDraft) {
  const payload = {
    ...draft,
    amount: draft.amount.trim() === "" ? Number.NaN : Number(draft.amount),
    asset_id: draft.asset_id || null,
    to_asset_id: draft.type === "transfer" ? draft.to_asset_id || null : null,
    category_id: draft.type === "transfer" ? null : draft.category_id || null,
    is_refund: draft.type === "expense" && draft.is_refund,
  };
  const result = TransactionInputSchema.safeParse({ ...payload, occurred_at: nowKst() });
  return result.success
    ? { success: true as const, data: TemplatePayloadSchema.parse(payload) }
    : {
        success: false as const,
        errors: Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.path[0] === "to_asset_id" ? "서로 다른 받는 자산을 선택해 주세요" : issue.message,
          ]),
        ),
      };
}

export function PayloadFields({
  draft,
  onChange,
  errors,
}: {
  readonly draft: PayloadDraft;
  readonly onChange: (draft: PayloadDraft) => void;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const assets = useApi<Items<Asset>>(paths.assets());
  const categories = useApi<Items<CategoryNode>>(paths.categories());
  return (
    <>
      {Boolean(assets.error || categories.error) && (
        <div role="alert">
          자산·분류를 불러오지 못했어요{" "}
          <Button
            onClick={() => {
              assets.reload();
              categories.reload();
            }}
          >
            다시 시도
          </Button>
        </div>
      )}
      <Field label="거래 유형">
        {(control) => (
          <Select
            {...control}
            value={draft.type}
            onChange={(event) =>
              onChange({
                ...draft,
                type: TransactionTypeSchema.parse(event.currentTarget.value),
                category_id: "",
                to_asset_id: "",
                is_refund: false,
              })
            }
          >
            <option value="expense">지출</option>
            <option value="income">수입</option>
            <option value="transfer">이체</option>
          </Select>
        )}
      </Field>
      <Field label="금액" error={errors.amount ?? null}>
        {(control) => (
          <Input
            {...control}
            type="number"
            min="0"
            step="1"
            value={draft.amount}
            onChange={(event) => onChange({ ...draft, amount: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field label="자산" error={errors.asset_id ?? null}>
        {(control) => (
          <Select
            {...control}
            value={draft.asset_id}
            onChange={(event) => onChange({ ...draft, asset_id: event.currentTarget.value })}
          >
            <option value="">미지정</option>
            {assets.data?.items.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {draft.type === "transfer" ? (
        <Field label="받는 자산" error={errors.to_asset_id ?? null}>
          {(control) => (
            <Select
              {...control}
              value={draft.to_asset_id}
              onChange={(event) => onChange({ ...draft, to_asset_id: event.currentTarget.value })}
            >
              <option value="">선택해 주세요</option>
              {assets.data?.items.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="분류" error={errors.category_id ?? null}>
          {(control) => (
            <Select
              {...control}
              value={draft.category_id}
              onChange={(event) => onChange({ ...draft, category_id: event.currentTarget.value })}
            >
              <option value="">미분류</option>
              {categories.data?.items
                .filter((category) => category.type === draft.type)
                .flatMap((category) => [
                  category,
                  ...category.children.map((child) => ({ ...child, name: `${category.name} / ${child.name}` })),
                ])
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="가맹점" error={errors.merchant ?? null}>
        {(control) => (
          <Input
            {...control}
            value={draft.merchant}
            maxLength={100}
            onChange={(event) => onChange({ ...draft, merchant: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field label="메모" error={errors.memo ?? null}>
        {(control) => (
          <Textarea
            {...control}
            value={draft.memo}
            maxLength={500}
            onChange={(event) => onChange({ ...draft, memo: event.currentTarget.value })}
          />
        )}
      </Field>
      {draft.type === "expense" && (
        <Field label="환불">
          {(control) => (
            <Select
              {...control}
              value={String(draft.is_refund)}
              onChange={(event) => onChange({ ...draft, is_refund: event.currentTarget.value === "true" })}
            >
              <option value="false">일반 지출</option>
              <option value="true">환불</option>
            </Select>
          )}
        </Field>
      )}
    </>
  );
}

export default function TemplatesEditor() {
  const { data, error, loading, offline, reload } = useApi<Items<Template>>(paths.templates);
  const online = useOnline();
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const templates = data?.items ?? [];
  const disabled = busy || offline || !online;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await action();
      invalidate(paths.templates);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "변경하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number, offset: number) {
    const ordered = [...templates];
    const current = ordered[index],
      adjacent = ordered[index + offset];
    if (!current || !adjacent) return;
    ordered[index] = adjacent;
    ordered[index + offset] = current;
    await mutate(async () => {
      for (const [sort, item] of ordered.entries()) await api.patchTemplate(item.id, { sort });
    });
  }
  return (
    <section className="recurring-screen">
      <header className="recurring-header">
        <h1>자주 쓰는 내역</h1>
        <Button icon={Plus} variant="primary" disabled={disabled} onClick={() => setEditing("new")}>
          추가
        </Button>
      </header>
      {loading && !data && <p role="status">로딩 중...</p>}
      {Boolean(error) && (
        <div role="alert">
          오류가 발생했어요 <Button onClick={reload}>다시 시도</Button>
        </div>
      )}
      {(offline || !online) && <p className="recurring-muted">오프라인 상태예요. 캐시된 데이터를 보고 있습니다.</p>}
      {failure && (
        <p role="alert" className="recurring-error">
          {failure}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && templates.length === 0 && (
        <div className="recurring-empty">
          <p>템플릿이 없어요</p>
          <Button disabled={disabled} onClick={() => setEditing("new")}>
            첫 번째 템플릿 추가
          </Button>
        </div>
      )}
      <div className="recurring-list">
        {templates.map((template, index) => (
          <article className="recurring-row" key={template.id} data-testid="template-row" data-id={template.id}>
            <div className="recurring-detail">
              <strong>{template.name}</strong>
              <p className="num">
                {(template.payload.amount ?? 0).toLocaleString()}원 · 사용됨 {template.use_count}회
              </p>
              <p>
                {template.payload.merchant} {template.payload.memo}
              </p>
            </div>
            <div className="recurring-actions">
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  mutate(async () => {
                    await recordFromTemplate(template.id);
                    invalidate("transactions");
                    invalidate("stats");
                    invalidate("assets");
                    setNotice("1건 기록했어요");
                  })
                }
              >
                기록하기
              </Button>
              {index > 0 && (
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => move(index, -1)}>
                  위로
                </Button>
              )}
              {index < templates.length - 1 && (
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => move(index, 1)}>
                  아래로
                </Button>
              )}
              <IconButton label="편집" icon={Edit2} disabled={disabled} onClick={() => setEditing(template)} />
              <IconButton label="삭제" icon={Trash2} disabled={disabled} onClick={() => setDeleting(template)} />
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <TemplateEditorSheet
          key={editing === "new" ? "new" : editing.id}
          editing={editing === "new" ? null : editing}
          nextSort={Math.max(-1, ...templates.map((template) => template.sort)) + 1}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Sheet
          open
          role="alertdialog"
          title="삭제 확인"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <div className="recurring-actions">
              <Button disabled={busy} onClick={() => setDeleting(null)}>
                취소
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() =>
                  mutate(async () => {
                    await api.deleteTemplate(deleting.id);
                    setDeleting(null);
                  })
                }
              >
                삭제
              </Button>
            </div>
          }
        >
          <p>이 템플릿을 삭제할까요?</p>
        </Sheet>
      )}
    </section>
  );
}

function TemplateEditorSheet({
  editing,
  nextSort,
  onClose,
}: {
  readonly editing: Template | null;
  readonly nextSort: number;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [draft, setDraft] = useState(() => payloadDraft(editing?.payload));
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
    const input = TemplateInputSchema.safeParse({
      name,
      payload: payload.success ? payload.data : { type: draft.type },
    });
    const issues = {
      ...(!payload.success ? payload.errors : {}),
      ...(!input.success
        ? Object.fromEntries(input.error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : {}),
    };
    setErrors(issues);
    if (!payload.success || !input.success) return;
    setBusy(true);
    setFailure("");
    try {
      if (editing) await api.patchTemplate(editing.id, input.data);
      else await api.createTemplate({ ...input.data, sort: nextSort });
      invalidate(paths.templates);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={editing ? "템플릿 수정" : "템플릿 추가"}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="recurring-actions">
          <Button block disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button block variant="primary" disabled={busy || !online} onClick={save}>
            {busy ? "저장 중..." : "저장"}
          </Button>
        </div>
      }
    >
      <div className="recurring-form" ref={formRef}>
        <Field label="이름" error={errors.name ?? null}>
          {(control) => (
            <Input {...control} value={name} maxLength={40} onChange={(event) => setName(event.currentTarget.value)} />
          )}
        </Field>
        <PayloadFields draft={draft} onChange={setDraft} errors={errors} />
        {failure && (
          <p role="alert" className="recurring-error">
            {failure}
          </p>
        )}
      </div>
    </Sheet>
  );
}
