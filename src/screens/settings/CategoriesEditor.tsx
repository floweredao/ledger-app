import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { Category, CategoryNode, CategoryType } from "../../../shared/schema";
import { api, isApiError, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { CATEGORY_ICONS, CategoryIcon, categoryColor } from "../../components/CategoryIcon";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Field, Input, Select } from "../../components/Field";
import "./categories.css";

type Draft = {
  readonly category: Category | null;
  readonly parent: Category | null;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

export default function CategoriesEditor() {
  const [type, setType] = useState<CategoryType>("expense");
  const { data, loading, error, offline, reload } = useApi<{ items: CategoryNode[] }>(
    paths.categories({ type, include_hidden: true }),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const original = useRef<Draft | null>(null);
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [reassign, setReassign] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [nameError, setNameError] = useState("");
  const drag = useRef<{ category: Category; pointer: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const roots = data?.items ?? [];
  const categories = roots.flatMap((root) => [root, ...root.children]);
  const siblings = (category: Category) =>
    categories.filter((c) => c.parent_id === category.parent_id).sort((a, b) => a.sort - b.sort);

  function openEditor(category: Category | null, parent: Category | null) {
    const next: Draft = {
      category,
      parent,
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
    if (
      draft &&
      original.current &&
      (draft.name !== original.current.name ||
        draft.icon !== original.current.icon ||
        draft.color !== original.current.color)
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
    const fields = { name, icon: draft.icon, color: draft.parent ? null : draft.color };
    try {
      if (draft.category) await api.patchCategory(draft.category.id, fields);
      else
        await api.createCategory({
          type,
          ...fields,
          ...(draft.parent ? { parent_id: draft.parent.id } : {}),
        });
      setDraft(null);
      setMessage("분류를 저장했어요");
      invalidate("categories");
    } catch {
      setErr("분류를 저장하지 못했어요. 이름 중복과 연결 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function reorder(category: Category, destination: Category) {
    if (busy || category.id === destination.id || category.parent_id !== destination.parent_id) return;
    const group = siblings(category);
    const ids = group.map((c) => c.id);
    const from = ids.indexOf(category.id);
    const to = ids.indexOf(destination.id);
    ids.splice(from, 1);
    ids.splice(to, 0, category.id);
    setBusy(true);
    setErr("");
    try {
      await api.reorderCategories(ids);
      invalidate("categories");
      setMessage("순서를 변경했어요");
    } catch {
      setErr("순서를 변경하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(category: Category) {
    setBusy(true);
    setErr("");
    try {
      await api.patchCategory(category.id, { hidden: !category.hidden });
      invalidate("categories");
      setMessage(category.hidden ? "분류를 표시했어요" : "분류를 숨겼어요");
    } catch {
      setErr("분류 표시 상태를 변경하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy || (reassign && !target)) return;
    setBusy(true);
    setErr("");
    try {
      await api.deleteCategory(deleting.id, reassign ? target : undefined);
      setDeleting(null);
      invalidate("categories");
      invalidate("merchant-rules");
      invalidate("transactions");
      invalidate("budgets");
      setMessage("분류를 삭제했어요");
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setReassign(true);
        setErr("사용 중인 분류예요. 다른 분류로 옮긴 뒤 삭제해 주세요.");
      } else setErr("분류를 삭제하지 못했어요. 대상 분류와 연결 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  const hasChildren = deleting && categories.some((c) => c.parent_id === deleting.id);
  const targets = deleting
    ? categories.filter(
        (c) =>
          c.id !== deleting.id &&
          c.type === deleting.type &&
          c.parent_id !== deleting.id &&
          (!hasChildren || c.parent_id === null),
      )
    : [];

  function renderCategory(category: Category, parent: Category | null) {
    const group = siblings(category);
    const index = group.findIndex((c) => c.id === category.id);
    return (
      <div
        key={category.id}
        data-category-id={category.id}
        className={`category-item level-${parent ? 1 : 0}${dragging === category.id ? " category-dragging" : ""}`}
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
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              drag.current = { category, pointer: event.pointerId };
              setDragging(category.id);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(null);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setDragging(null);
            }}
            onPointerUp={(event) => {
              const active = drag.current;
              drag.current = null;
              setDragging(null);
              if (!active || active.pointer !== event.pointerId) return;
              const id = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest("[data-category-id]")
                ?.getAttribute("data-category-id");
              const destination = categories.find((c) => c.id === id);
              if (destination) void reorder(active.category, destination);
            }}
          />
          <IconButton
            icon={ArrowUp}
            label={`${category.name} 위로`}
            disabled={busy || index === 0}
            onClick={() => {
              const previous = group[index - 1];
              if (previous) void reorder(category, previous);
            }}
          />
          <IconButton
            icon={ArrowDown}
            label={`${category.name} 아래로`}
            disabled={busy || index === group.length - 1}
            onClick={() => {
              const next = group[index + 1];
              if (next) void reorder(category, next);
            }}
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
            onClick={() => {
              setDeleting(category);
              setReassign(false);
              setTarget("");
              setErr("");
              setMessage("");
            }}
          >
            삭제
          </Button>
        </div>
      </div>
    );
  }
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
      <div className="category-tree" aria-busy={busy}>
        {roots.map((root) => (
          <section key={root.id} className="category-group" aria-label={root.name}>
            {renderCategory(root, null)}
            {root.children.map((child) => renderCategory(child, root))}
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
          title={draft.category ? "분류 편집" : draft.parent ? "하위 분류 추가" : "분류 추가"}
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
            {draft.parent ? (
              <p className="category-meta">{draft.parent.name} 아래에 표시하며 부모 색상을 사용해요.</p>
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
            {!draft.parent ? (
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
          title={`${deleting.name} 삭제`}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => setDeleting(null)}>
                취소
              </Button>
              <Button variant="danger" disabled={busy || (reassign && !target)} onClick={() => void remove()}>
                {reassign ? "옮기고 삭제" : "삭제"}
              </Button>
            </>
          }
        >
          <p>분류를 삭제할까요? 사용 중인 기록이 있으면 다른 분류로 옮길 수 있어요.</p>
          {reassign ? (
            <Field label="다른 분류로 옮기기">
              {(control) => (
                <Select
                  {...control}
                  value={target}
                  disabled={busy}
                  onChange={(event) => setTarget(event.currentTarget.value)}
                >
                  <option value="">분류 선택</option>
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent_id ? `${categories.find((p) => p.id === c.parent_id)?.name} / ${c.name}` : c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {reassign && targets.length === 0 ? (
            <p>옮길 분류가 없어요. 취소하고 같은 유형의 상위 분류를 추가해 주세요.</p>
          ) : null}
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
