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
import { applyTemplate, type EntryDraft, fromTransaction } from "./form";
import { type EntryData, refreshLedger, TransactionSheet } from "./TransactionSheet";

const RECENT = paths.transactions({ limit: 100 });

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
  const { request, close } = useEntryRequest();
  const open = request !== null;
  const editId = request?.id ?? null;
  const categories = useApi<Items<CategoryNode>>(open ? paths.categories() : null);
  const assets = useApi<Items<Asset>>(open ? paths.assets() : null);
  const settings = useApi<Settings>(open ? paths.settings : null);
  const templates = useApi<Items<Template>>(open ? paths.templates : null);
  const rules = useApi<Items<MerchantRule>>(open ? paths.merchantRules : null);
  const recent = useApi<TransactionList>(open ? RECENT : null);
  const detail = useApi<Transaction>(editId ? paths.transaction(editId) : null);
  const selected = editId ? detail : recent;

  const [session, setSession] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [freshSession, setFreshSession] = useState(-1);
  const dirtyRef = useRef(false);
  const saveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (request === null) return;
    dirtyRef.current = false;
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
  const requestClose = () => (dirtyRef.current ? setConfirmDiscard(true) : finish());
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

  const remove = async (id: string) => {
    try {
      await api.deleteTransaction(id);
    } catch (error) {
      console.warn("delete failed", error);
      toast({ message: "삭제하지 못했어요. 다시 시도해 주세요." });
      return;
    }
    refreshLedger();
    finish();
    toast({
      message: "삭제했어요",
      action: {
        label: "실행 취소",
        onAction: () => {
          api.restoreTransaction(id).then(refreshLedger, (error: unknown) => {
            console.warn("restore failed", error);
            toast({ message: "되돌리지 못했어요" });
          });
        },
      },
    });
  };

  let body: ReactNode;
  if (missing) {
    body = <EmptyState icon={SearchX} title="이 기록을 찾을 수 없어요" />;
  } else if (failed) {
    body = (
      <EmptyState
        tone="error"
        icon={CircleAlert}
        title="기록에 필요한 정보를 불러오지 못했어요"
        action={<Button onClick={retry}>다시 시도</Button>}
      />
    );
  } else if (!request || !categories.data || !assets.data || !settings.data || !listReady) {
    body = <Skeleton rows={4} label="기록 화면을 여는 중" />;
  } else if (editId && !original) {
    body = <EmptyState icon={SearchX} title="이 기록을 찾을 수 없어요" />;
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
        controls={{ saveRef, onDirtyChange, onSaved: finish }}
      />
    );
  }

  const canSave = Boolean(ready) && !failed && !(editId && !original);
  const footer = canSave ? (
    <>
      {original ? (
        <Button variant="danger" onClick={() => void remove(original.id)}>
          삭제
        </Button>
      ) : null}
      <Button variant="primary" block={!original} onClick={() => saveRef.current?.()}>
        저장
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        title={editId ? "기록 수정" : "기록하기"}
        {...(footer ? { footer } : {})}
      >
        {body}
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        title="작성 중인 내용을 버릴까요?"
        confirmLabel="버리기"
        cancelLabel="계속 작성"
        destructive
        onConfirm={finish}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
