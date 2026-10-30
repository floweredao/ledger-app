import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { MerchantRule } from "../../../shared/schema";
import { api, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatDisplayDate } from "../../i18n/format";
import { settingsMessages } from "./messages";
import "./categories.css";
import { SubpageHeader } from "./SubpageHeader";

export default function MerchantRules() {
  const m = useMessages(settingsMessages);
  const c = useMessages(common);
  const { data, loading, error, offline, reload } = useApi<{ items: MerchantRule[] }>(paths.merchantRules);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [message, setMessage] = useState("");
  const rules = data?.items ?? [];
  async function remove(rule: MerchantRule) {
    if (busy) return;
    setBusy(`${rule.merchant_key}:${rule.type}`);
    setErr("");
    setMessage("");
    try {
      await api.deleteMerchantRule(rule.merchant_key, rule.type);
      invalidate("merchant-rules");
      setMessage(m.ruleDeleted);
    } catch {
      setErr(m.deleteFailed);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="screen merchant-rules">
      <SubpageHeader title={m.rules} />
      {offline ? <p role="status">{m.rulesOffline}</p> : null}
      {loading && !data ? <p>{m.loading}</p> : null}
      {error ? (
        <div role="alert">
          <p>{m.serverError}</p>
          <Button onClick={reload}>{c.retry}</Button>
        </div>
      ) : null}
      {!loading && !error && rules.length === 0 ? (
        <div className="empty-state">
          <p>{m.noRules}</p>
          <p>{m.rulesHint}</p>
        </div>
      ) : null}
      <ul className="rules-list" aria-busy={busy !== null}>
        {rules.map((rule) => {
          const typeName = rule.type === "income" ? c.income : rule.type === "expense" ? c.expense : c.transfer;
          return (
            <li key={`${rule.merchant_key}:${rule.type}`} className="rule-item">
              <div className="rule-info">
                <span className="merchant-name">{rule.merchant_key}</span>
                <span className="category-name">{rule.category_name}</span>
                <span className="category-meta">{typeName}</span>
                <span className="category-meta">{formatDisplayDate(rule.updated_at)}</span>
              </div>
              <IconButton
                icon={Trash2}
                className="category-error"
                disabled={busy !== null}
                label={m.deleteRuleLabel(rule.merchant_key, typeName)}
                onClick={() => void remove(rule)}
              />
            </li>
          );
        })}
      </ul>
      {err ? (
        <p role="alert" className="category-error">
          {err}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
