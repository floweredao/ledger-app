import { CircleAlert, SearchX } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { nowKst } from "../../../shared/dates";
import type {
  Asset,
  CategoryNode,
  MerchantRule,
  Settings,
  Template,
  Transaction,
  TransactionList,
} from "../../../shared/schema";
import { api, type Items, isApiError, paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { type EntryRequest, useEntryRequest } from "../../app/entry-bridge";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/Skeleton";
import { toast } from "../../components/Toast";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { applyTemplate, type EntryDraft, fromTransaction } from "./form";
import { entryMessages } from "./messages";
import { type EntryData, refreshLedger, TransactionSheet } from "./TransactionSheet";

const RECENT = paths.transactions({ limit: 100 });
/** Hidden categories too, so a record already saved on one keeps showing it; the sheet filters the rest out. */
export const ENTRY_CATEGORIES = paths.categories({ include_hidden: true });

function initialDraft(request: EntryRequest, data: EntryData, settings: Settings, original: Transaction | null) {
  if (original) return fromTransaction(original);
  const now = nowKst();
  const assetIds = new Set(data.assets.map((asset) => asset.id));
  const lastAsset = data.recent.find((tx) => tx.asset_id !== null && assetIds.has(tx.asset_id))?.asset_id;
  const preferred =
    settings.default_asset_id && assetIds.has(settings.default_asset_id) ? settings.default_asset_id : null;
  const blank: EntryDraft = {
    type: "expense",
    isRefund: false,
    amount: "",
    categoryId: null,
    assetId: preferred ?? lastAsset ?? data.assets[0]?.id ?? null,
    toAssetId: null,
    date: request.date ?? now.slice(0, 10),
    time: now.slice(11, 16),
    merchant: "",
    memo: "",
  };
  const template = data.templates.find((t) => t.id === request.templateId);
  return template ? applyTemplate(blank, template.payload) : blank;
}

export default function EntryHost() {
  const t = useMessages(entryMessages);
  const c = useMessages(common);
  const { request, close } = useEntryRequest();
  const open = request !== null;
  const editId = request?.id ?? null;
  const categories = useApi<Items<CategoryNode>>(open ? ENTRY_CATEGORIES : null);
  const assets = useApi<Items<Asset>>(open ? paths.assets() : null);
  const settings = useApi<Settings>(open ? paths.settings : null);
  const templates = useApi<Items<Template>>(open ? paths.templates : null);
  const rules = useApi<Items<MerchantRule>>(open ? paths.merchantRules : null);
  const recent = useApi<TransactionList>(open ? RECENT : null);
  const detail = useApi<Transaction>(editId ? paths.transaction(editId) : null);
  const selected = editId ? detail : recent;

  const [session, setSession] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [freshSession, setFreshSession] = useState(-1);
  const dirtyRef = useRef(false);
  const saveRef = useRef<(() => void) | null>(null);
  const lastFieldRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (request === null) return;
    dirtyRef.current = false;
    lastFieldRef.current = null;
    setConfirmDiscard(false);
    setSession((n) => n + 1);
  }, [request]);

  useEffect(() => {
    if (open && !selected.loading && selected.data) setFreshSession(session);
  }, [open, selected.loading, selected.data, session]);

  const finish = useCallback(() => {
    dirtyRef.current = false;
    setConfirmDiscard(false);
    close();
  }, [close]);
  const requestClose = () => {
    if (!dirtyRef.current) return finish();
    // Capture the edited field as the confirmation's return target, not the close button.
    lastFieldRef.current?.focus();
    setConfirmDiscard(true);
  };
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const required = [categories, assets, settings, selected];
  const missing = Boolean(
    editId && detail.data === undefined && isApiError(detail.error) && detail.error.status === 404,
  );
  const failed = !missing && required.some((state) => state.error !== undefined && state.data === undefined);
  const retry = () => {
    for (const state of [...required, templates, rules]) state.reload();
  };
  // Wait for this open's server or offline-cache read, not a previous editor session.
  const listReady = selected.data !== undefined && (editId === null || freshSession === session);
  const original = editId && listReady ? (detail.data ?? null) : null;
  const ready = categories.data && assets.data && settings.data && listReady;

  const remove = async (record: Transaction) => {
    const { id } = record;
    const category = categories.data?.items
      .flatMap(({ children, ...parent }) => [parent, ...children])
      .find((item) => item.id === record.category_id);
    const name = record.merchant.trim() || category?.name || c.uncategorized;
    try {
      await api.deleteTransaction(id);
    } catch (error) {
      console.warn("delete failed", error);
      toast({ message: t.deleteFailed, tone: "error" });
      return;
    }
    refreshLedger();
    finish();
    toast({
      message: t.deleted(name),
      action: {
        label: c.undo,
        accessibleName: t.undoDelete(name),
        onAction: () => {
          api.restoreTransaction(id).then(refreshLedger, (error: unknown) => {
            console.warn("restore failed", error);
            toast({ message: t.restoreFailed, tone: "error" });
          });
        },
      },
    });
  };

  let body: ReactNode;
  if (missing) {
    body = <EmptyState icon={SearchX} title={t.recordMissing} />;
  } else if (failed) {
    body = (
      <EmptyState
        tone="error"
        icon={CircleAlert}
        title={t.metadataFailed}
        action={<Button onClick={retry}>{c.retry}</Button>}
      />
    );
  } else if (!request || !categories.data || !assets.data || !settings.data || !listReady) {
    body = <Skeleton rows={4} label={t.opening} />;
  } else if (editId && !original) {
    body = <EmptyState icon={SearchX} title={t.recordMissing} />;
  } else {
    const data: EntryData = {
      categories: categories.data.items.flatMap(({ children, ...parent }) => [parent, ...children]),
      assets: assets.data.items,
      templates: templates.data?.items ?? [],
      rules: rules.data?.items ?? [],
      recent: recent.data?.items ?? [],
    };
    body = (
      <TransactionSheet
        key={[editId, request.templateId, request.date].join(":")}
        data={data}
        initial={initialDraft(request, data, settings.data, original)}
        original={original}
        controls={{ saveRef, onDirtyChange, onSavingChange: setSaving, onSaved: finish }}
      />
    );
  }

  const canSave = Boolean(ready) && !failed && !(editId && !original);
  const footer = canSave ? (
    <>
      {original ? (
        <Button variant="danger" disabled={saving} onClick={() => void remove(original)}>
          {c.delete}
        </Button>
      ) : null}
      <Button
        variant="primary"
        block={!original}
        disabled={saving}
        aria-busy={saving}
        onClick={() => saveRef.current?.()}
      >
        {saving ? c.saving : c.save}
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <Sheet
        open={open}
        suspended={confirmDiscard}
        onClose={requestClose}
        title={editId ? t.editRecord : c.record}
        {...(footer ? { footer } : {})}
      >
        <div
          onFocusCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLInputElement ||
              target instanceof HTMLTextAreaElement ||
              target instanceof HTMLSelectElement
            ) {
              lastFieldRef.current = target;
            }
          }}
        >
          {body}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        title={t.discardTitle}
        confirmLabel={t.discard}
        cancelLabel={t.keepWriting}
        destructive
        onConfirm={finish}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
