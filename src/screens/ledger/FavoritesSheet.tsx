import type { Template } from "../../../shared/schema";
import { type Items, paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { openEntry } from "../../app/entry-bridge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ListRow } from "../../components/ListRow";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/Skeleton";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatSigned } from "../../i18n/format";
import { navigate } from "../../router";
import { ledgerMessages } from "./messages";

/** 자주사용: pick a saved favorite to open a filled entry form, or go manage the list. */
export default function FavoritesSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const m = useMessages(ledgerMessages);
  const c = useMessages(common);
  const templates = useApi<Items<Template>>(open ? paths.templates : null);
  const manage = () => {
    onClose();
    navigate("/settings/templates");
  };
  const items = templates.data?.items ?? [];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.favorites}
      footer={
        <Button block onClick={manage}>
          {m.manageFavorites}
        </Button>
      }
    >
      {templates.data === undefined && templates.loading ? <Skeleton rows={3} label={m.loading} /> : null}
      {templates.data === undefined && !templates.loading ? (
        <EmptyState
          tone="error"
          title={c.loadFailed}
          action={
            <Button size="sm" onClick={templates.reload}>
              {c.retry}
            </Button>
          }
        />
      ) : null}
      {templates.data && items.length === 0 ? (
        <EmptyState title={m.favoritesEmpty} description={m.favoritesEmptyHint} />
      ) : null}
      {items.map((template) => (
        <ListRow
          key={template.id}
          title={template.name}
          trailing={
            template.payload.amount === undefined ? undefined : (
              <span className="num">{formatSigned(template.payload.type, template.payload.amount)}</span>
            )
          }
          onClick={() => {
            onClose();
            openEntry({ templateId: template.id });
          }}
        />
      ))}
    </Sheet>
  );
}
