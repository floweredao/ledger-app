import { Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDisplayDate } from "../../../shared/dates";
import type { MerchantRule } from "../../../shared/schema";
import { api, paths } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { Button, IconButton } from "../../components/Button";
import "./categories.css";

export default function MerchantRules() {
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
      setMessage("규칙을 삭제했어요");
    } catch {
      setErr("삭제에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="screen merchant-rules">
      <h1 className="screen-title">가게별 자동 분류</h1>
      {offline ? <p role="status">오프라인이에요. 저장된 규칙을 표시해요.</p> : null}
      {loading && !data ? <p>로딩 중...</p> : null}
      {error ? (
        <div role="alert">
          <p>서버 오류가 발생했어요</p>
          <Button onClick={reload}>다시 시도</Button>
        </div>
      ) : null}
      {!loading && !error && rules.length === 0 ? (
        <div className="empty-state">
          <p>저장된 규칙이 없어요</p>
          <p>거래에서 분류를 직접 지정하면 자동으로 규칙이 만들어집니다.</p>
        </div>
      ) : null}
      <ul className="rules-list" aria-busy={busy !== null}>
        {rules.map((rule) => {
          const typeName = rule.type === "income" ? "수입" : rule.type === "expense" ? "지출" : "이체";
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
                label={`${rule.merchant_key} ${typeName} 규칙 삭제`}
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
