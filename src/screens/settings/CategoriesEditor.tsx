import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { Category, CategoryNode, CategoryType, CategoryUsage } from "../../../shared/schema";
import { api, isApiError, isNetworkError, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { CATEGORY_ICON_LABELS, CATEGORY_ICONS, CategoryIcon, categoryColor } from "../../components/CategoryIcon";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Field, Input, Select } from "../../components/Field";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { categoriesMessages } from "./categories-messages";
import { useDragReorder } from "./useDragReorder";
import "./categories.css";
import { SubpageHeader } from "./SubpageHeader";

type Draft = {
  readonly category: Category | null;
  readonly parentId: string | null;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

const groupKey = (parentId: string | null) => parentId ?? "";
export default function CategoriesEditor() {
  const m = useMessages(categoriesMessages);
  const c = useMessages(common);
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
      setNameError(!name ? m.nameRequired : m.nameTooLong);
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
      setMessage(m.saved);
      invalidate("categories");
      if (moved) for (const prefix of ["transactions", "stats", "budgets"]) invalidate(prefix);
    } catch (error) {
      if (isNetworkError(error)) setErr(m.offlineError);
      else if (isApiError(error) && error.status === 409)
        setErr(
          moved && draft.category
            ? m.moveConflict(draft.parentId ? nameOf(draft.parentId) : m.rootCategory)
            : m.duplicateName,
        );
      else setErr(m.saveFailed);
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
      setMessage(m.orderSaved);
    } catch (error) {
      setPending(null);
      setErr(isNetworkError(error) ? m.offlineError : m.orderFailed);
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
      setMessage(category.hidden ? m.shown : m.hiddenDone);
    } catch (error) {
      setErr(isNetworkError(error) ? m.offlineError : m.visibilityFailed);
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
      setMessage(recordCount ? m.deletedRecords(recordCount) : m.deleted);
    } catch (error) {
      if (isNetworkError(error)) setErr(m.offlineError);
      else if (isApiError(error) && error.status === 404) {
        setErr(m.alreadyDeleted);
        invalidate("categories");
      } else setErr(m.deleteFailed);
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
          {category.hidden ? <span className="category-meta">{m.hidden}</span> : null}
        </div>
        <div className="category-actions">
          <IconButton
            icon={GripVertical}
            label={m.dragOrder(category.name)}
            disabled={busy || group.length < 2}
            className="category-drag-handle"
            {...drag.handleProps(category.id, groupIds)}
          />
          <IconButton
            icon={ArrowUp}
            label={m.moveUp(category.name)}
            disabled={busy || index === 0}
            onClick={() => step(category, -1)}
          />
          <IconButton
            icon={ArrowDown}
            label={m.moveDown(category.name)}
            disabled={busy || index === group.length - 1}
            onClick={() => step(category, 1)}
          />
          <label className="category-hidden">
            <input
              type="checkbox"
              checked={category.hidden}
              disabled={busy}
              aria-label={m.hideCategory(category.name)}
              onChange={() => void toggle(category)}
            />
            {m.hidden}
          </label>
          <Button disabled={busy} aria-label={m.editNamed(category.name)} onClick={() => openEditor(category, parent)}>
            {m.edit}
          </Button>
          {!parent ? (
            <Button
              icon={Plus}
              disabled={busy}
              aria-label={m.addChildNamed(category.name)}
              onClick={() => openEditor(null, category)}
            >
              {m.addChild}
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={busy}
            aria-label={m.deleteNamed(category.name)}
            onClick={() => openDelete(category)}
          >
            {c.delete}
          </Button>
        </div>
      </div>
    );
  }
  const draftChildren = draft?.category ? categories.filter((c) => c.parent_id === draft.category?.id) : [];
  const parentOptions = draft ? roots.filter((root) => root.id !== draft.category?.id) : [];
  return (
    <div className="screen categories-editor">
      <SubpageHeader title={m.title} />
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
              {value === "expense" ? c.expense : c.income}
            </Button>
          ))}
        </div>
        <Button
          icon={Plus}
          variant="primary"
          disabled={busy || loading || !!error}
          onClick={() => openEditor(null, null)}
        >
          {m.addCategory}
        </Button>
      </div>
      {offline ? <p role="status">{m.offline}</p> : null}
      {loading && !data ? (
        <p role="status" aria-label={m.loading}>
          {m.loading}
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{m.serverError}</p>
          <Button onClick={reload}>{c.retry}</Button>
        </div>
      ) : null}
      {!loading && !error && roots.length === 0 ? <p>{m.empty}</p> : null}
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
          title={draft.category ? m.editCategory : draft.parentId ? m.addSubcategory : m.addCategory}
          onClose={closeEditor}
          footer={
            <>
              <Button disabled={busy} onClick={closeEditor}>
                {c.cancel}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                {c.save}
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
            <Field label={m.categoryName} error={nameError}>
              {(control) => (
                <Input
                  {...control}
                  value={draft.name}
                  placeholder={m.categoryName}
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
                label={m.parentCategory}
                hint={
                  draft.parentId && draftChildren.length
                    ? m.moveChildren(draftChildren.length, nameOf(draft.parentId))
                    : m.parentHint
                }
              >
                {(control) => (
                  <Select
                    {...control}
                    value={draft.parentId ?? ""}
                    disabled={busy}
                    onChange={(event) => setDraft({ ...draft, parentId: event.currentTarget.value || null })}
                  >
                    <option value="">{m.keepRoot}</option>
                    {parentOptions.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.name}
                        {root.hidden ? m.hiddenSuffix : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {draft.parentId ? <p className="category-meta">{m.parentColor(nameOf(draft.parentId))}</p> : null}
            <fieldset disabled={busy} className="category-picker">
              <legend>{m.icon}</legend>
              <div className="category-icon-options">
                {Object.entries(CATEGORY_ICONS).map(([name, Glyph]) => (
                  <button
                    type="button"
                    key={name}
                    className="category-option"
                    aria-label={m.iconLabel(CATEGORY_ICON_LABELS[name])}
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
                <legend>{m.color}</legend>
                <div className="category-color-options">
                  {Array.from({ length: 12 }, (_, i) => `cat-${i + 1}`).map((color) => (
                    <button
                      type="button"
                      key={color}
                      className="category-option"
                      aria-label={m.colorLabel(color.slice(4))}
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
        title={m.discardTitle}
        description={m.discardDescription}
        confirmLabel={m.discard}
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
          title={m.deleteTitle(deleting.name)}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <>
              <Button ref={deleteCancel} disabled={busy} onClick={() => setDeleting(null)}>
                {c.cancel}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                {c.delete}
              </Button>
            </>
          }
        >
          {usage === "failed" ? <p>{m.unassignRecords}</p> : null}
          {recordCount ? <p>{m.recordsBecomeUncategorized(recordCount)}</p> : null}
          {childCount ? <p>{m.deleteChildren(childCount)}</p> : null}
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
