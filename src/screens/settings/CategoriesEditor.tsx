import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { Category, CategoryNode, CategoryType, CategoryUsage } from "../../../shared/schema";
import { api, isApiError, isNetworkError, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { CATEGORY_ICONS, CategoryIcon, categoryColor } from "../../components/CategoryIcon";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Field, Input, Select } from "../../components/Field";
import { useDragReorder } from "./useDragReorder";
import "./categories.css";

type Draft = {
  readonly category: Category | null;
  readonly parentId: string | null;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

const OFFLINE = "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";
const groupKey = (parentId: string | null) => parentId ?? "";
export default function CategoriesEditor() {
  const [type, setType] = useState<CategoryType>("expense");
  const { data, loading, error, offline, reload } = useApi<{ items: CategoryNode[] }>(
    paths.categories({ type, include_hidden: true }),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const original = useRef<Draft | null>(null);
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [usage, setUsage] = useState<CategoryUsage | "failed" | null>(null);
  const deleteCancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [nameError, setNameError] = useState("");
  // A committed order shows right away and gives way to the next fetched list instead of snapping back meanwhile.
  const [pending, setPending] = useState<{ key: string; ids: readonly string[]; base: unknown } | null>(null);
  const ordered = <T extends Category>(items: readonly T[], parentId: string | null): T[] => {
    const sorted = [...items].sort((a, b) => a.sort - b.sort);
    if (!pending || pending.base !== data || pending.key !== groupKey(parentId)) return sorted;
    const { ids } = pending;
    const rank = (item: T) => ids.indexOf(item.id);
    return sorted.sort((a, b) => rank(a) - rank(b));
  };
  const roots = ordered(data?.items ?? [], null);
  const categories = roots.flatMap((root) => [root, ...root.children]);
  const siblings = (category: Category) =>
    category.parent_id === null
      ? roots
      : ordered(
          categories.filter((c) => c.parent_id === category.parent_id),
          category.parent_id,
        );
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

  function openEditor(category: Category | null, parent: Category | null) {
    const next: Draft = {
      category,
      parentId: category?.parent_id ?? parent?.id ?? null,
      name: category?.name ?? "",
      icon: category?.icon ?? "tag",
      color: category?.color ?? parent?.color ?? "cat-1",
    };
    original.current = next;
    setDraft(next);
    setErr("");
    setNameError("");
    setMessage("");
  }
  function closeEditor() {
    if (busy) return;
    const before = original.current;
    if (
      draft &&
      before &&
      (draft.name !== before.name ||
        draft.icon !== before.icon ||
        draft.color !== before.color ||
        draft.parentId !== before.parentId)
    )
      setDiscard(true);
    else setDraft(null);
  }
  async function save() {
    if (!draft || busy) return;
    const name = draft.name.trim();
    if (!name || name.length > 30) {
      setNameError(!name ? "이름을 입력해 주세요" : "이름은 30자까지 입력해 주세요");
      return;
    }
    setBusy(true);
    setErr("");
    setNameError("");
    const fields = { name, icon: draft.icon, color: draft.parentId ? null : draft.color };
    const moved = draft.category !== null && draft.parentId !== draft.category.parent_id;
    try {
      if (draft.category)
        await api.patchCategory(draft.category.id, { ...fields, ...(moved ? { parent_id: draft.parentId } : {}) });
      else
        await api.createCategory({
          type,
          ...fields,
          ...(draft.parentId ? { parent_id: draft.parentId } : {}),
        });
      setDraft(null);
      setMessage("분류를 저장했어요");
      invalidate("categories");
      if (moved) for (const prefix of ["transactions", "stats", "budgets"]) invalidate(prefix);
    } catch (error) {
      if (isNetworkError(error)) setErr(OFFLINE);
      else if (isApiError(error) && error.status === 409)
        setErr(
          moved && draft.category
            ? `${draft.parentId ? nameOf(draft.parentId) : "대분류"}에 이름이 같은 분류가 있어요. 이름을 바꾸거나 다른 곳으로 옮겨 주세요.`
            : "같은 이름의 분류가 이미 있어요. 다른 이름을 입력해 주세요.",
        );
      else setErr("분류를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function saveOrder(parentId: string | null, ids: readonly string[]) {
    if (busy) return;
    setPending({ key: groupKey(parentId), ids, base: data });
    setBusy(true);
    setErr("");
    try {
      await api.reorderCategories(ids);
      invalidate("categories");
      setMessage("순서를 변경했어요");
    } catch (error) {
      setPending(null);
      setErr(isNetworkError(error) ? OFFLINE : "순서를 변경하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  function step(category: Category, offset: -1 | 1) {
    const ids = siblings(category).map((c) => c.id);
    const from = ids.indexOf(category.id);
    const to = from + offset;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, category.id);
    void saveOrder(category.parent_id, ids);
  }
  const drag = useDragReorder((ids) => {
    const first = categories.find((c) => c.id === ids[0]);
    if (first) void saveOrder(first.parent_id, ids);
  });
  async function toggle(category: Category) {
    setBusy(true);
    setErr("");
    try {
      await api.patchCategory(category.id, { hidden: !category.hidden });
      invalidate("categories");
      setMessage(category.hidden ? "분류를 표시했어요" : "분류를 숨겼어요");
    } catch (error) {
      setErr(isNetworkError(error) ? OFFLINE : "분류 표시 상태를 변경하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  async function loadUsage(category: Category) {
    setUsage(null);
    try {
      setUsage(await api.categoryUsage(category.id));
    } catch {
      // The count is only informative: the dialog falls back to a sentence without it and delete still works.
      setUsage("failed");
    }
  }
  function openDelete(category: Category) {
    setDeleting(category);
    setErr("");
    setMessage("");
    void loadUsage(category);
  }
  const childCount = deleting ? categories.filter((c) => c.parent_id === deleting.id).length : 0;
  const recordCount = usage !== null && usage !== "failed" ? usage.total_transactions : null;
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api.deleteCategory(deleting.id);
      setDeleting(null);
      for (const prefix of [
        "categories",
        "merchant-rules",
        "transactions",
        "budgets",
        "stats",
        "templates",
        "recurring",
      ])
        invalidate(prefix);
      setMessage(recordCount ? `분류를 삭제했어요. 기록 ${recordCount}건은 분류 없음이 됐어요.` : "분류를 삭제했어요");
    } catch (error) {
      if (isNetworkError(error)) setErr(OFFLINE);
      else if (isApiError(error) && error.status === 404) {
        setErr("이미 삭제된 분류예요. 목록을 새로 불러왔어요.");
        invalidate("categories");
      } else setErr("분류를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function renderCategory(category: Category, parent: Category | null) {
    const group = siblings(category);
    const index = group.findIndex((c) => c.id === category.id);
    const groupIds = group.map((c) => c.id);
    return (
      <div
        key={category.id}
        data-category-id={category.id}
        className={`category-item level-${parent ? 1 : 0}`}
        {...(parent ? { "data-reorder-id": category.id, ...drag.itemProps(category.id) } : {})}
      >
        <div className="category-identity">
          <CategoryIcon icon={category.icon} color={parent?.color ?? category.color} />
          <span className="category-name">{category.name}</span>
          {category.hidden ? <span className="category-meta">숨김</span> : null}
        </div>
        <div className="category-actions">
          <IconButton
            icon={GripVertical}
            label={`${category.name} 순서 드래그`}
            disabled={busy || group.length < 2}
            className="category-drag-handle"
            {...drag.handleProps(category.id, groupIds)}
          />
          <IconButton
            icon={ArrowUp}
            label={`${category.name} 위로`}
            disabled={busy || index === 0}
            onClick={() => step(category, -1)}
          />
          <IconButton
            icon={ArrowDown}
            label={`${category.name} 아래로`}
            disabled={busy || index === group.length - 1}
            onClick={() => step(category, 1)}
          />
          <label className="category-hidden">
            <input
              type="checkbox"
              checked={category.hidden}
              disabled={busy}
              aria-label={`${category.name} 숨김`}
              onChange={() => void toggle(category)}
            />
            숨김
          </label>
          <Button disabled={busy} aria-label={`${category.name} 편집`} onClick={() => openEditor(category, parent)}>
            편집
          </Button>
          {!parent ? (
            <Button
              icon={Plus}
              disabled={busy}
              aria-label={`${category.name} 하위 분류 추가`}
              onClick={() => openEditor(null, category)}
            >
              하위 추가
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={busy}
            aria-label={`${category.name} 삭제`}
            onClick={() => openDelete(category)}
          >
            삭제
          </Button>
        </div>
      </div>
    );
  }
  const draftChildren = draft?.category ? categories.filter((c) => c.parent_id === draft.category?.id) : [];
  const parentOptions = draft ? roots.filter((root) => root.id !== draft.category?.id) : [];
  return (
    <div className="screen categories-editor">
      <h1 className="screen-title">분류 관리</h1>
      <div className="category-toolbar">
        <div className="category-types">
          {(["expense", "income"] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={type === value}
              disabled={busy || !!draft || !!deleting}
              variant={type === value ? "primary" : "secondary"}
              onClick={() => {
                setType(value);
                setMessage("");
                setErr("");
              }}
            >
              {value === "expense" ? "지출" : "수입"}
            </Button>
          ))}
        </div>
        <Button
          icon={Plus}
          variant="primary"
          disabled={busy || loading || !!error}
          onClick={() => openEditor(null, null)}
        >
          분류 추가
        </Button>
      </div>
      {offline ? <p role="status">오프라인이에요. 저장된 분류를 표시해요.</p> : null}
      {loading && !data ? <p>로딩 중...</p> : null}
      {error ? (
        <div role="alert">
          <p>서버 오류가 발생했어요</p>
          <Button onClick={reload}>다시 시도</Button>
        </div>
      ) : null}
      {!loading && !error && roots.length === 0 ? <p>등록된 분류가 없어요</p> : null}
      <div className="category-tree" aria-busy={busy} data-reordering={drag.active || undefined}>
        {roots.map((root) => (
          <section
            key={root.id}
            className="category-group"
            aria-label={root.name}
            data-reorder-id={root.id}
            {...drag.itemProps(root.id)}
          >
            {renderCategory(root, null)}
            {ordered(root.children, root.id).map((child) => renderCategory(child, root))}
          </section>
        ))}
      </div>
      {message ? <p role="status">{message}</p> : null}
      {err && !draft && !deleting ? (
        <p role="alert" className="category-error">
          {err}
        </p>
      ) : null}
      {draft ? (
        <Dialog
          open
          title={draft.category ? "분류 편집" : draft.parentId ? "하위 분류 추가" : "분류 추가"}
          onClose={closeEditor}
          footer={
            <>
              <Button disabled={busy} onClick={closeEditor}>
                취소
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                저장
              </Button>
            </>
          }
        >
          <form
            className="category-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="분류 이름" error={nameError}>
              {(control) => (
                <Input
                  {...control}
                  value={draft.name}
                  placeholder="분류 이름"
                  maxLength={30}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.currentTarget.value });
                    setNameError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!event.nativeEvent.isComposing) void save();
                    }
                  }}
                />
              )}
            </Field>
            {draft.category ? (
              <Field
                label="상위 분류"
                hint={
                  draft.parentId && draftChildren.length
                    ? `하위 분류 ${draftChildren.length}개도 ${nameOf(draft.parentId)} 아래로 함께 옮겨요.`
                    : "대분류로 두거나 다른 분류의 하위로 옮길 수 있어요."
                }
              >
                {(control) => (
                  <Select
                    {...control}
                    value={draft.parentId ?? ""}
                    disabled={busy}
                    onChange={(event) => setDraft({ ...draft, parentId: event.currentTarget.value || null })}
                  >
                    <option value="">대분류로 두기</option>
                    {parentOptions.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.name}
                        {root.hidden ? " (숨김)" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {draft.parentId ? (
              <p className="category-meta">{nameOf(draft.parentId)} 아래에 표시하며 부모 색상을 사용해요.</p>
            ) : null}
            <fieldset disabled={busy} className="category-picker">
              <legend>아이콘</legend>
              <div className="category-icon-options">
                {Object.entries(CATEGORY_ICONS).map(([name, Glyph]) => (
                  <button
                    type="button"
                    key={name}
                    className="category-option"
                    aria-label={`아이콘 ${name}`}
                    aria-pressed={draft.icon === name}
                    onClick={() => setDraft({ ...draft, icon: name })}
                  >
                    <Glyph size={20} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>
            {!draft.parentId ? (
              <fieldset disabled={busy} className="category-picker">
                <legend>색상</legend>
                <div className="category-color-options">
                  {Array.from({ length: 12 }, (_, i) => `cat-${i + 1}`).map((color) => (
                    <button
                      type="button"
                      key={color}
                      className="category-option"
                      aria-label={`색상 ${color.slice(4)}`}
                      aria-pressed={draft.color === color}
                      onClick={() => setDraft({ ...draft, color })}
                    >
                      <span className="category-swatch" style={{ backgroundColor: categoryColor(color) }} />
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {err ? (
              <p role="alert" className="category-error">
                {err}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={discard}
        title="변경을 버릴까요?"
        description="아직 저장하지 않은 변경이 있어요."
        confirmLabel="버리기"
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          setDraft(null);
        }}
      />
      {deleting ? (
        <Dialog
          open
          role="alertdialog"
          initialFocusRef={deleteCancel}
          title={`${deleting.name} 분류를 지울까요?`}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <>
              <Button ref={deleteCancel} disabled={busy} onClick={() => setDeleting(null)}>
                취소
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                삭제
              </Button>
            </>
          }
        >
          {usage === "failed" ? <p>이 분류의 기록은 분류 없음으로 바뀌어요.</p> : null}
          {recordCount ? <p>기록 {recordCount}건은 분류 없음으로 바뀌어요.</p> : null}
          {childCount ? <p>하위 분류 {childCount}개도 함께 지워져요.</p> : null}
          {err ? (
            <p role="alert" className="category-error">
              {err}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
