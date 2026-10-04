import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exportBackup } from "../server/domain/backup";
import { startBackupJob } from "../server/jobs/backup";
import { kstDate } from "../shared/dates";
import { authed, makeTestApp, type TestApp } from "./helpers";

describe("Backup and Restore", () => {
  let testApp: TestApp;

  beforeEach(() => {
    testApp = makeTestApp();
  });

  afterEach(() => {
    testApp.cleanup();
  });

  describe("GET /backup", () => {
    it("should export all tables as JSON", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/backup");
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        version: 1,
        exported_at: expect.any(String),
        tables: {
          assets: expect.any(Array),
          categories: expect.any(Array),
          transactions: expect.any(Array),
          merchant_rules: expect.any(Array),
          budgets: expect.any(Array),
          recurring_rules: expect.any(Array),
          templates: expect.any(Array),
          settings: expect.any(Array),
        },
      });
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/backup");
      expect(response.status).toBe(401);
    });

    it("should include seeded categories in backup", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/backup");
      const data = await response.json();
      expect(data.tables.categories.length).toBeGreaterThan(0);
    });

    it("should include seeded cash asset in backup", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/backup");
      const data = await response.json();
      const cashAsset = data.tables.assets.find((a: { kind: string }) => a.kind === "cash");
      expect(cashAsset).toBeDefined();
    });

    it("should include seeded settings in backup", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/backup");
      const data = await response.json();
      expect(data.tables.settings.length).toBeGreaterThan(0);
    });
  });

  describe("POST /backup/restore", () => {
    it("restores old assets missing only opening_date as null", async () => {
      const fetch = await authed(testApp);
      const backup = exportBackup(testApp.db);
      for (const row of backup.tables.assets) delete row.opening_date;
      expect((await fetch("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup })).status).toBe(
        200,
      );
      expect(exportBackup(testApp.db).tables.assets.every((row) => row.opening_date === null)).toBe(true);
    });

    it("round trips new opening dates and rejects missing other columns or malformed dates atomically", async () => {
      const fetch = await authed(testApp);
      expect(
        (
          await fetch("/api/v1/assets", {
            method: "POST",
            body: { name: "샘플자산", kind: "other", opening_balance: 12000, opening_date: "2026-03-15" },
          })
        ).status,
      ).toBe(201);
      const backup = exportBackup(testApp.db);
      expect((await fetch("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup })).status).toBe(
        200,
      );
      expect(exportBackup(testApp.db).tables).toEqual(backup.tables);
      for (const invalid of [
        { remove: "name", value: null },
        { remove: null, value: "2026-02-30" },
        { remove: null, value: 123 },
      ]) {
        const malformed = structuredClone(backup);
        for (const row of malformed.tables.assets) {
          if (invalid.remove) {
            delete row.opening_date;
            delete row[invalid.remove];
          } else row.opening_date = invalid.value;
        }
        expect(
          (await fetch("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: malformed })).status,
        ).toBe(400);
        expect(exportBackup(testApp.db).tables).toEqual(backup.tables);
      }
    });

    it("should reject restore without confirm parameter", async () => {
      const fetch = await authed(testApp);
      const exportRes = await fetch("/api/v1/backup");
      const backupData = await exportRes.json();

      const restoreRes = await fetch("/api/v1/backup/restore", {
        method: "POST",
        body: backupData,
      });
      expect(restoreRes.status).toBe(400);
      const error = await restoreRes.json();
      expect(error.error.code).toBe("invalid_request");
    });

    it("should reject restore with wrong confirm value", async () => {
      const fetch = await authed(testApp);
      const exportRes = await fetch("/api/v1/backup");
      const backupData = await exportRes.json();

      const restoreRes = await fetch("/api/v1/backup/restore?confirm=WRONG", {
        method: "POST",
        body: backupData,
      });
      expect(restoreRes.status).toBe(400);
    });

    it("should restore backup with confirm=REPLACE", async () => {
      const fetch = await authed(testApp);
      const exportRes = await fetch("/api/v1/backup");
      const backupData = await exportRes.json();
      const initialTransactionCount = backupData.tables.transactions.length;

      const txRes = await fetch("/api/v1/transactions", {
        method: "POST",
        body: {
          type: "expense",
          amount: 10000,
          occurred_at: new Date().toISOString(),
          merchant: "テストマート",
        },
      });
      expect(txRes.status).toBe(201);

      const listRes = await fetch("/api/v1/transactions");
      const listData = await listRes.json();
      expect(listData.items.length).toBe(initialTransactionCount + 1);

      const restoreRes = await fetch("/api/v1/backup/restore?confirm=REPLACE", {
        method: "POST",
        body: backupData,
      });
      expect(restoreRes.status).toBe(200);
      const restoreResult = await restoreRes.json();
      expect(restoreResult.ok).toBe(true);

      const finalListRes = await fetch("/api/v1/transactions");
      const finalListData = await finalListRes.json();
      expect(finalListData.items.length).toBe(initialTransactionCount);
    });

    it("should create pre-restore snapshot", async () => {
      const fetch = await authed(testApp);
      const exportRes = await fetch("/api/v1/backup");
      const backupData = await exportRes.json();

      const txRes = await fetch("/api/v1/transactions", {
        method: "POST",
        body: {
          type: "expense",
          amount: 5000,
          occurred_at: new Date().toISOString(),
          merchant: "サンプルカフェ",
        },
      });
      expect(txRes.status).toBe(201);

      const restoreRes = await fetch("/api/v1/backup/restore?confirm=REPLACE", {
        method: "POST",
        body: backupData,
      });
      expect(restoreRes.status).toBe(200);

      const backupsDir = join(testApp.dataDir, "backups");
      expect(existsSync(backupsDir)).toBe(true);

      const preRestoreFiles = readdirSync(backupsDir).filter((f: string) => f.startsWith("pre-restore-"));
      expect(preRestoreFiles.length).toBeGreaterThan(0);
    });

    it("should reject restore when backup version mismatches", async () => {
      const fetch = await authed(testApp);
      const invalidBackup = {
        version: 99,
        exported_at: new Date().toISOString(),
        tables: {},
      };

      const restoreRes = await fetch("/api/v1/backup/restore?confirm=REPLACE", {
        method: "POST",
        body: invalidBackup,
      });
      expect(restoreRes.status).toBe(400);
      const error = await restoreRes.json();
      expect(error.error.code).toBe("invalid_request");
    });

    it("should reject oversized backup", async () => {
      const fetch = await authed(testApp);
      const hugeBackup = {
        version: 1,
        exported_at: new Date().toISOString(),
        tables: {
          transactions: [{ huge: "x".repeat(60_000_000) }],
        },
      };

      const restoreRes = await fetch("/api/v1/backup/restore?confirm=REPLACE", {
        method: "POST",
        body: hugeBackup,
      });
      expect(restoreRes.status).toBe(413);
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/backup/restore?confirm=REPLACE", {
        method: "POST",
        body: JSON.stringify({ version: 1, exported_at: "", tables: {} }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe("Daily backup job", () => {
    it("should create daily backup files", async () => {
      const stop = startBackupJob({ db: testApp.db, dataDir: testApp.dataDir });
      try {
        const backupsDir = join(testApp.dataDir, "backups");
        expect(existsSync(backupsDir)).toBe(true);
        const today = kstDate().replaceAll("-", "");
        const expectedFile = join(backupsDir, `ledger-${today}.sqlite`);
        expect(existsSync(expectedFile)).toBe(true);
      } finally {
        stop();
      }
    });
  });
});
