import { Download } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { addDays, kstDate, periodRange } from "../../../shared/dates";
import { type SyncStatus, TransactionInputSchema } from "../../../shared/schema";
import { api, download, isApiError, isNetworkError } from "../../api/client";
import { invalidate, useApi } from "../../api/hooks";
import { apiFetch } from "../../api/transport";
import { Button } from "../../components/Button";
import { Field, Input, Select } from "../../components/Field";
import { toast } from "../../components/Toast";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { formatDisplayDate, formatNumber, formatWon } from "../../i18n/format";
import { dataMessages } from "./data-messages";
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
const krwLabels = () => {
  const m = messages(dataMessages);
  return {
    exact: m.krwExact,
    inferred: m.krwInferred,
    pending: m.krwPending,
  };
};
const rowErrors = (): Readonly<Record<string, string>> => {
  const m = messages(dataMessages);
  return {
    "Too many columns": m.tooManyColumns,
    "Invalid amount": m.invalidAmount,
    "Expected a valid date and time": m.invalidDate,
    "Subcategory needs a category": m.missingParent,
    "A transfer needs a different destination asset": m.invalidTransfer,
    "Invalid hidden flag": m.invalidHidden,
  };
};
const rowError = (message: string) => rowErrors()[message] ?? messages(dataMessages).invalidRow;

function dataError(error: unknown, fallback: string): string {
  const m = messages(dataMessages);
  if (isNetworkError(error)) return m.networkError;
  if (isApiError(error)) {
    switch (error.code) {
      case "unauthenticated":
      case "csrf":
        return m.sessionExpired;
      case "too_large":
        return m.fileTooLarge;
      case "preview_not_found":
        return m.previewExpired;
      case "invalid_csv":
      case "invalid_upload":
      case "unknown_format":
        return m.importFailure;
      case "not_available":
        return m.syncUnavailable;
    }
  }
  return fallback;
}
const SyncResultSchema = z.object({
  inserted: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

export default function DataScreen() {
  const m = useMessages(dataMessages);
  const c = useMessages(common);
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
      setExportError(dataError(err, m.exportFailure));
      toast({
        message: m.downloadFailed(format.toUpperCase()),
        tone: "error",
        action: {
          label: m.retryDownload,
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
      const message = dataError(err, m.importFailure);
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
        message: m.importComplete(result.inserted, result.skipped),
      });

      setImportFile(null);
      setImportPreview(null);
      setIncludeDuplicates(false);
      setImportInputKey((key) => key + 1);
      for (const prefix of ["transactions", "stats/", "assets", "budgets"]) invalidate(prefix);
    } catch (err) {
      const message = dataError(err, m.commitFailure);
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
      if (!blob.type.startsWith("application/json")) throw new Error(m.invalidBackupResponse);
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
        message: m.backupDownloadFailed(dataError(err, m.backupFailure)),
        tone: "error",
        action: {
          label: m.retryDownload,
          onAction: handleBackupDownload,
        },
      });
    }
  };

  const handleRestore = async () => {
    if (!restoreFile || restoreConfirm !== m.restore) return;
    setRestoring(true);
    setRestoreError(null);

    try {
      await api.restoreBackup(restoreFile);
      toast({
        message: m.restoreComplete,
      });
      setRestoreFile(null);
      setRestoreConfirm("");
      setRestoreInputKey((key) => key + 1);
      invalidate("");
    } catch (err) {
      const message = dataError(err, m.restoreFailure);
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
      if (result.errors.length > 0) setSyncError(m.syncFailure);
      else
        toast({
          message: m.syncComplete(result.inserted, result.merged, result.skipped, result.hidden),
        });
      syncStatus.reload();
      for (const prefix of ["transactions", "stats/", "assets", "budgets"]) invalidate(prefix);
    } catch (err) {
      const message = dataError(err, m.syncFailure);
      setSyncError(message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="data-screen">
      <h1>{m.title}</h1>

      <section className="data-section" aria-label={c.export}>
        <h2>{c.export}</h2>
        <Field label={m.period}>
          {(control) => (
            <Select
              {...control}
              value={exportPeriod}
              onChange={(e) => setExportPeriod(z.enum(["month", "year", "custom"]).parse(e.target.value))}
            >
              <option value="month">{m.thisMonth}</option>
              <option value="year">{m.year}</option>
              <option value="custom">{m.customPeriod}</option>
            </Select>
          )}
        </Field>

        {exportPeriod === "custom" && (
          <>
            <Field label={m.startDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={exportCustomFrom}
                  onChange={(e) => setExportCustomFrom(e.target.value)}
                />
              )}
            </Field>
            <Field label={m.endDate}>
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
            {m.downloadCsv}
          </Button>
          <Button icon={Download} disabled={customInvalid || exporting} onClick={() => handleExportClick("xlsx")}>
            {m.downloadXlsx}
          </Button>
        </div>
        {customInvalid && <p className="section-description">{m.invalidRange}</p>}
        {exportError && (
          <div className="data-error" role="alert">
            {exportError}
          </div>
        )}
      </section>

      <section className="data-section" aria-label={m.import}>
        <h2>{m.import}</h2>
        <Field label={m.chooseFile}>
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

        {importLoading && <div className="data-loading">{m.previewLoading}</div>}

        {importError && (
          <div className="data-error" role="alert">
            {importError}
          </div>
        )}

        {importPreview && (
          <div className="data-preview">
            <h3>
              {m.preview} · {importPreview.detected_format === "ledger" ? c.appName : m.moneyManager}
            </h3>
            <p className="section-description">
              {importFile?.name}
              {m.previewDetails}
            </p>
            <div className="preview-counts">
              <div className="count-item">
                <span className="count-label">{m.total}</span>
                <span className="count-value">{formatNumber(importPreview.counts.total)}</span>
              </div>
              <div className="count-item">
                <span className="count-label">{m.new}</span>
                <span className="count-value">{formatNumber(importPreview.counts.new)}</span>
              </div>
              <div className="count-item">
                <span className="count-label">{m.duplicate}</span>
                <span className="count-value">{formatNumber(importPreview.counts.duplicate)}</span>
              </div>
              {importPreview.errors.length > 0 && (
                <div className="count-item error">
                  <span className="count-label">{m.errors}</span>
                  <span className="count-value">{formatNumber(importPreview.counts.error)}</span>
                </div>
              )}
            </div>
            <ul className="preview-rows">
              {importPreview.rows.map((row) => (
                <li key={row.row}>
                  <strong>{row.merchant || m.noDescription}</strong>
                  <span>
                    {m.row(row.row)} · {formatDisplayDate(row.occurred_at)} ·{" "}
                    {row.type === "income"
                      ? c.income
                      : row.type === "transfer"
                        ? c.transfer
                        : row.is_refund
                          ? c.refund
                          : c.expense}{" "}
                    · {formatWon(row.amount)}
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
                    {row.duplicate ? m.duplicate : m.newRecord}
                    {row.hidden ? m.hiddenSuffix : ""} · {row.currency}
                    {row.foreign_amount != null ? ` ${row.foreign_amount}` : ""} · {krwLabels()[row.krw_status]}
                  </span>
                </li>
              ))}
            </ul>

            {importPreview.errors.length > 0 && (
              <div className="errors-list">
                <h3>{m.errors}</h3>
                {importPreview.errors.map((err) => (
                  <div key={`${err.row}-${err.message}`} className="error-item">
                    <span className="error-row">{m.row(err.row)}:</span>
                    <span className="error-message">{rowError(err.message)}</span>
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
                {m.includeDuplicates}
              </label>
            )}

            <Button
              variant="primary"
              onClick={handleImportCommit}
              disabled={committing || importPreview.counts.total === importPreview.counts.error}
            >
              {committing
                ? m.importing
                : m.importCount(importPreview.counts.new + (includeDuplicates ? importPreview.counts.duplicate : 0))}
            </Button>
          </div>
        )}
      </section>

      <section className="data-section" aria-label={m.backup}>
        <h2>{m.backup}</h2>
        <p className="section-description">{m.backupDescription}</p>
        <Button icon={Download} onClick={handleBackupDownload}>
          {m.downloadBackup}
        </Button>
      </section>

      <section className="data-section" aria-label={m.restore}>
        <h2>{m.restore}</h2>
        <p className="section-description">{m.restoreDescription}</p>
        <Field label={m.backupFile}>
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
          <Field label={m.restoreConfirmation}>
            {(control) => (
              <Input
                {...control}
                type="text"
                placeholder={m.restore}
                value={restoreConfirm}
                onChange={(e) => setRestoreConfirm(e.target.value)}
                aria-label={m.restoreInput}
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
          disabled={restoring || !restoreFile || restoreConfirm !== m.restore}
        >
          {restoring ? m.restoring : m.restore}
        </Button>
      </section>

      <section className="data-section" aria-label={m.sync}>
        <h2>{m.sync}</h2>

        {syncStatus.loading && <div className="data-loading">{m.loadingStatus}</div>}

        {syncStatus.offline && <div className="data-error">{m.offline}</div>}

        {syncStatus.error != null && (
          <div className="data-error">{m.statusFailed(dataError(syncStatus.error, m.syncStatusFailure))}</div>
        )}

        {syncStatus.data && (
          <div className="sync-status">
            <div className="status-item">
              <span className="status-label">{m.lastSync}</span>
              <span className="status-value">
                {syncStatus.data.last_run_at ? formatDisplayDate(syncStatus.data.last_run_at) : c.none}
              </span>
            </div>

            {lastResult.success && (
              <>
                <div className="status-item">
                  <span className="status-label">{m.inserted}</span>
                  <span className="status-value">{formatNumber(lastResult.data.inserted)}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">{m.merged}</span>
                  <span className="status-value">{formatNumber(lastResult.data.merged)}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">{m.skipped}</span>
                  <span className="status-value">{formatNumber(lastResult.data.skipped)}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">{m.hidden}</span>
                  <span className="status-value">{formatNumber(lastResult.data.hidden)}</span>
                </div>
                {lastResult.data.errors.length > 0 && <div className="status-error">{m.syncFailure}</div>}
              </>
            )}

            {syncStatus.data.last_error && <div className="status-error">{m.syncFailure}</div>}
          </div>
        )}

        {syncError && (
          <div className="data-error" role="alert">
            {syncError}
          </div>
        )}

        <Button onClick={handleSync} disabled={syncing || syncStatus.loading} aria-busy={syncing}>
          {syncing ? m.syncing : c.syncNow}
        </Button>
      </section>
    </div>
  );
}
