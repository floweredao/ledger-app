import { Download } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { addDays, formatDisplayDate, kstDate, periodRange } from "../../../shared/dates";
import { type SyncStatus, TransactionInputSchema } from "../../../shared/schema";
import { api, download } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { apiFetch } from "../../api/transport";
import { Button } from "../../components/Button";
import { Field, Input, Select } from "../../components/Field";
import { toast } from "../../components/Toast";
import "./data.css";

const ImportPreviewSchema = z.object({
  detected_format: z.enum(["ledger", "money_manager"]),
  rows: z.array(
    z.object({
      // Preview IDs can be null until commit creates the named assets.
      ...TransactionInputSchema.shape,
      row: z.number().int(),
      asset_name: z.string(),
      to_asset_name: z.string(),
      category_name: z.string(),
      subcategory_name: z.string(),
      hidden: z.boolean(),
      duplicate: z.boolean(),
    }),
  ),
  counts: z.object({
    total: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  errors: z.array(
    z.object({
      row: z.number().int(),
      message: z.string(),
    }),
  ),
  preview_id: z.uuid(),
});

type ImportPreview = z.infer<typeof ImportPreviewSchema>;
type ExportPeriod = "month" | "year" | "custom";
const SyncResultSchema = z.object({
  inserted: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

export default function DataScreen() {
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>("month");
  const [exportCustomFrom, setExportCustomFrom] = useState("");
  const [exportCustomTo, setExportCustomTo] = useState("");

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importInputKey, setImportInputKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreInputKey, setRestoreInputKey] = useState(0);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncStatus = useApi<SyncStatus>("sync/status");
  const lastResult = SyncResultSchema.safeParse(syncStatus.data?.last_result);
  const customInvalid =
    exportPeriod === "custom" && (!exportCustomFrom || !exportCustomTo || exportCustomFrom > exportCustomTo);

  const handleExportClick = async (format: "csv" | "xlsx") => {
    if (customInvalid || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const range =
        exportPeriod === "custom"
          ? { from: exportCustomFrom, to: exportCustomTo }
          : periodRange(exportPeriod, kstDate(new Date(Date.now())));
      const query = new URLSearchParams({
        format,
        from: range.from,
        to: exportPeriod === "custom" ? range.to : addDays(range.to, -1),
      }).toString();
      await download(`export?${query}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "내보내기 실패");
      toast({
        message: `${format.toUpperCase()} 다운로드 실패`,
        action: {
          label: "재시도",
          onAction: () => handleExportClick(format),
        },
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportFile(file);
    setImportError(null);
    setImportPreview(null);
    setIncludeDuplicates(false);
    setImportLoading(true);

    try {
      const response = await api.importPreview(file);
      const parsed = ImportPreviewSchema.parse(response);
      setImportPreview(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "미리보기 실패";
      setImportError(message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportCommit = async () => {
    if (!importPreview) return;
    setCommitting(true);
    setImportError(null);

    try {
      const result = await api.importCommit({
        preview_id: importPreview.preview_id,
        include_duplicates: includeDuplicates,
      });

      toast({
        message: `${result.inserted}개 추가됨 · ${result.skipped}개 건너뜀`,
      });

      setImportFile(null);
      setImportPreview(null);
      setIncludeDuplicates(false);
      setImportInputKey((key) => key + 1);
      for (const prefix of ["transactions", "stats/", "assets", "budgets"]) invalidate(prefix);
    } catch (err) {
      const message = err instanceof Error ? err.message : "가져오기 실패";
      setImportError(message);
    } finally {
      setCommitting(false);
    }
  };

  const handleBackupDownload = async () => {
    try {
      // /backup sends JSON without Content-Disposition. Supply the required .json name.
      const response = await apiFetch("backup");
      const blob = await response.blob();
      if (!blob.type.startsWith("application/json")) throw new Error("백업 응답이 JSON 파일이 아니에요");
      const file = new File([blob], `ledger-backup-${kstDate()}.json`, { type: blob.type });
      const standalone =
        ("standalone" in navigator && navigator.standalone === true) ||
        window.matchMedia?.("(display-mode: standalone)").matches === true;
      if (standalone && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!(err instanceof Error)) throw err;
        }
      }
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        message: `백업 다운로드 실패: ${err instanceof Error ? err.message : "응답을 확인하세요"}`,
        action: {
          label: "재시도",
          onAction: handleBackupDownload,
        },
      });
    }
  };

  const handleRestore = async () => {
    if (!restoreFile || restoreConfirm !== "복원") return;
    setRestoring(true);
    setRestoreError(null);

    try {
      await api.restoreBackup(restoreFile);
      toast({
        message: "복원 완료",
      });
      setRestoreFile(null);
      setRestoreConfirm("");
      setRestoreInputKey((key) => key + 1);
      invalidate("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "복원 실패";
      setRestoreError(message);
    } finally {
      setRestoring(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);

    try {
      const result = SyncResultSchema.parse(await api.runSync());
      if (result.errors.length > 0) setSyncError(`동기화 오류: ${result.errors.join(", ")}`);
      else
        toast({
          message: `동기화 완료 · ${result.inserted}개 추가 · ${result.merged}개 통합 · ${result.skipped}개 건너뜀 · ${result.hidden}개 숨김`,
        });
      syncStatus.reload();
      for (const prefix of ["transactions", "stats/", "assets", "budgets"]) invalidate(prefix);
    } catch (err) {
      const message = err instanceof Error ? err.message : "동기화 실패";
      setSyncError(message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="data-screen">
      <h1>데이터</h1>

      <section className="data-section" aria-label="내보내기">
        <h2>내보내기</h2>
        <Field label="기간">
          {(control) => (
            <Select
              {...control}
              value={exportPeriod}
              onChange={(e) => setExportPeriod(z.enum(["month", "year", "custom"]).parse(e.target.value))}
            >
              <option value="month">이번 달</option>
              <option value="year">연도</option>
              <option value="custom">기간 지정</option>
            </Select>
          )}
        </Field>

        {exportPeriod === "custom" && (
          <>
            <Field label="시작일">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={exportCustomFrom}
                  onChange={(e) => setExportCustomFrom(e.target.value)}
                />
              )}
            </Field>
            <Field label="종료일">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={exportCustomTo}
                  onChange={(e) => setExportCustomTo(e.target.value)}
                />
              )}
            </Field>
          </>
        )}

        <div className="data-buttons">
          <Button icon={Download} disabled={customInvalid || exporting} onClick={() => handleExportClick("csv")}>
            CSV 다운로드
          </Button>
          <Button icon={Download} disabled={customInvalid || exporting} onClick={() => handleExportClick("xlsx")}>
            XLSX 다운로드
          </Button>
        </div>
        {customInvalid && (
          <p className="section-description">시작일과 종료일을 순서대로 선택하세요. 양 끝 날짜를 포함해요.</p>
        )}
        {exportError && (
          <div className="data-error" role="alert">
            {exportError}
          </div>
        )}
      </section>

      <section className="data-section" aria-label="가져오기">
        <h2>가져오기</h2>
        <Field label="파일 선택">
          {(control) => (
            <Input
              key={importInputKey}
              {...control}
              type="file"
              accept=".csv,.xlsx"
              disabled={importLoading || committing}
              onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
            />
          )}
        </Field>

        {importLoading && <div className="data-loading">미리보기 중...</div>}

        {importError && (
          <div className="data-error" role="alert">
            {importError}
          </div>
        )}

        {importPreview && (
          <div className="data-preview">
            <h3>미리보기 · {importPreview.detected_format === "ledger" ? "가계부" : "편한가계부"}</h3>
            <p className="section-description">
              {importFile?.name} · 상세는 최대 50행을 표시해요. 오류 행은 건너뜁니다.
            </p>
            <div className="preview-counts">
              <div className="count-item">
                <span className="count-label">전체</span>
                <span className="count-value">{importPreview.counts.total}</span>
              </div>
              <div className="count-item">
                <span className="count-label">새로운</span>
                <span className="count-value">{importPreview.counts.new}</span>
              </div>
              <div className="count-item">
                <span className="count-label">중복</span>
                <span className="count-value">{importPreview.counts.duplicate}</span>
              </div>
              {importPreview.errors.length > 0 && (
                <div className="count-item error">
                  <span className="count-label">오류</span>
                  <span className="count-value">{importPreview.counts.error}</span>
                </div>
              )}
            </div>
            <ul className="preview-rows">
              {importPreview.rows.map((row) => (
                <li key={row.row}>
                  <strong>{row.merchant || "내용 없음"}</strong>
                  <span>
                    행 {row.row} · {formatDisplayDate(row.occurred_at)} ·{" "}
                    {row.type === "income"
                      ? "수입"
                      : row.type === "transfer"
                        ? "이체"
                        : row.is_refund
                          ? "환불"
                          : "지출"}{" "}
                    · {row.amount.toLocaleString("ko-KR")}원
                  </span>
                  <span>
                    {[
                      row.asset_name,
                      row.to_asset_name && `→ ${row.to_asset_name}`,
                      row.category_name,
                      row.subcategory_name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {row.memo && <span>{row.memo}</span>}
                  <span>
                    {row.duplicate ? "중복" : "새로운 기록"}
                    {row.hidden ? " · 숨김" : ""} · {row.currency}
                    {row.foreign_amount != null ? ` ${row.foreign_amount}` : ""} · {row.krw_status}
                  </span>
                </li>
              ))}
            </ul>

            {importPreview.errors.length > 0 && (
              <div className="errors-list">
                <h3>오류</h3>
                {importPreview.errors.map((err) => (
                  <div key={`${err.row}-${err.message}`} className="error-item">
                    <span className="error-row">행 {err.row}:</span>
                    <span className="error-message">{err.message}</span>
                  </div>
                ))}
              </div>
            )}

            {importPreview.counts.duplicate > 0 && (
              <label className="data-checkbox">
                <input
                  type="checkbox"
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                />
                중복도 포함하기
              </label>
            )}

            <Button
              variant="primary"
              onClick={handleImportCommit}
              disabled={committing || importPreview.counts.total === importPreview.counts.error}
            >
              {committing ? "가져오는 중..." : "확인"}
            </Button>
          </div>
        )}
      </section>

      <section className="data-section" aria-label="백업">
        <h2>백업</h2>
        <p className="section-description">현재 모든 데이터를 파일로 내려받습니다.</p>
        <Button icon={Download} onClick={handleBackupDownload}>
          백업 다운로드
        </Button>
      </section>

      <section className="data-section" aria-label="복원">
        <h2>복원</h2>
        <p className="section-description">
          현재 데이터를 백업 파일의 내용으로 교체해요. 백업 파일을 선택하고 복원을 입력하세요.
        </p>
        <Field label="백업 파일">
          {(control) => (
            <Input
              key={restoreInputKey}
              {...control}
              type="file"
              accept=".json"
              disabled={restoring}
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] ?? null);
                setRestoreConfirm("");
                setRestoreError(null);
              }}
            />
          )}
        </Field>

        {restoreFile && (
          <Field label="복원 확인">
            {(control) => (
              <Input
                {...control}
                type="text"
                placeholder="복원"
                value={restoreConfirm}
                onChange={(e) => setRestoreConfirm(e.target.value)}
                aria-label="복원 확인 텍스트 입력"
                disabled={restoring}
              />
            )}
          </Field>
        )}
        {restoreError && (
          <div className="data-error" role="alert">
            {restoreError}
          </div>
        )}
        <Button
          variant="danger"
          onClick={handleRestore}
          disabled={restoring || !restoreFile || restoreConfirm !== "복원"}
        >
          {restoring ? "복원 중..." : "복원"}
        </Button>
      </section>

      <section className="data-section" aria-label="동기화">
        <h2>동기화</h2>

        {syncStatus.loading && <div className="data-loading">상태 조회 중...</div>}

        {syncStatus.offline && <div className="data-error">오프라인 상태입니다. 온라인일 때 다시 시도하세요.</div>}

        {syncStatus.error != null && (
          <div className="data-error">
            상태 조회 실패: {syncStatus.error instanceof Error ? syncStatus.error.message : String(syncStatus.error)}
          </div>
        )}

        {syncStatus.data && (
          <div className="sync-status">
            <div className="status-item">
              <span className="status-label">마지막 동기화</span>
              <span className="status-value">
                {syncStatus.data.last_run_at ? formatDisplayDate(syncStatus.data.last_run_at) : "없음"}
              </span>
            </div>

            {lastResult.success && (
              <>
                <div className="status-item">
                  <span className="status-label">추가됨</span>
                  <span className="status-value">{lastResult.data.inserted}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">통합됨</span>
                  <span className="status-value">{lastResult.data.merged}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">건너뜀</span>
                  <span className="status-value">{lastResult.data.skipped}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">숨김</span>
                  <span className="status-value">{lastResult.data.hidden}</span>
                </div>
                {lastResult.data.errors.length > 0 && (
                  <div className="status-error">오류: {lastResult.data.errors.join(", ")}</div>
                )}
              </>
            )}

            {syncStatus.data.last_error && <div className="status-error">오류: {syncStatus.data.last_error}</div>}
          </div>
        )}

        {syncError && (
          <div className="data-error" role="alert">
            {syncError}
          </div>
        )}

        <Button onClick={handleSync} disabled={syncing || syncStatus.loading} aria-busy={syncing}>
          {syncing ? "동기화 중..." : "지금 동기화"}
        </Button>
      </section>
    </div>
  );
}
