import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openDb } from "../server/db";
import { authed, makeTestApp, TEST_ORIGIN, type TestApp } from "./helpers";

describe("month notes", () => {
  let app: TestApp;
  beforeEach(() => {
    app = makeTestApp();
  });
  afterEach(() => app.cleanup());

  test("returns an empty note when the month has none", async () => {
    // Given
    const api = await authed(app);
    // When
    const response = await api("/api/v1/month-notes/2026-10");
    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ month: "2026-10", body: "", updated_at: null });
  });

  test("reads the saved note when PUT replaces an existing month", async () => {
    // Given
    const api = await authed(app);
    await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "이전 메모" } });
    const body = "  샘플 월 메모\n다음 줄  ";
    // When
    const saved = await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body } });
    // Then
    expect(saved.status).toBe(200);
    const note = await saved.json();
    expect(note).toEqual({ month: "2026-10", body, updated_at: expect.any(String) });
    expect(Number.isFinite(Date.parse(note.updated_at))).toBe(true);
    expect(await (await api("/api/v1/month-notes/2026-10")).json()).toEqual(note);
    expect(await (await api("/api/v1/month-notes/2026-11")).json()).toEqual({
      month: "2026-11",
      body: "",
      updated_at: null,
    });
  });

  test("deletes the stored row when PUT body is empty", async () => {
    // Given
    const api = await authed(app);
    await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "샘플 메모" } });
    // When
    const response = await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "" } });
    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ month: "2026-10", body: "", updated_at: null });
    expect(app.db.query("SELECT * FROM month_notes").all()).toEqual([]);
  });

  for (const month of ["2026-00", "2026-13", "2026-1", "26-10", "2026-10-01"]) {
    for (const method of ["GET", "PUT"]) {
      test(`rejects ${method} when month is ${month}`, async () => {
        // Given
        const api = await authed(app);
        // When
        const response = await api(`/api/v1/month-notes/${month}`, {
          method,
          ...(method === "PUT" ? { body: { body: "샘플 메모" } } : {}),
        });
        // Then
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("invalid_input");
      });
    }
  }

  for (const body of [{}, { body: null }, { body: 42 }, { body: "가".repeat(2001) }, { body: "메모", extra: true }]) {
    test(`rejects invalid note input ${JSON.stringify(body).slice(0, 60)}`, async () => {
      // Given
      const api = await authed(app);
      // When
      const response = await api("/api/v1/month-notes/2026-10", { method: "PUT", body });
      // Then
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_input");
    });
  }

  test("accepts the note when body has exactly 2000 characters", async () => {
    // Given
    const api = await authed(app);
    const body = "가".repeat(2000);
    // When
    const response = await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body } });
    // Then
    expect(response.status).toBe(200);
    expect((await response.json()).body).toBe(body);
  });

  test("rejects a mutation when CSRF is missing", async () => {
    // Given
    const api = await authed(app);
    // When
    const response = await app.request("/api/v1/month-notes/2026-10", {
      method: "PUT",
      headers: { Cookie: api.cookie, Origin: TEST_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "샘플 메모" }),
    });
    // Then
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("csrf");
  });

  test("rejects access when the session is missing", async () => {
    // Given / When
    const response = await app.request("/api/v1/month-notes/2026-10");
    // Then
    expect(response.status).toBe(401);
  });

  test("keeps notes and timestamps when a backup is restored", async () => {
    // Given
    const api = await authed(app);
    const saved = await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "샘플 메모\n두 줄" } });
    expect(saved.status).toBe(200);
    const note = await saved.json();
    const backup = await (await api("/api/v1/backup")).json();
    await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "" } });
    // When
    const response = await api("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup });
    // Then
    expect(response.status).toBe(200);
    expect(await (await api("/api/v1/month-notes/2026-10")).json()).toEqual(note);
  });

  test("restores no notes when a legacy backup has no month_notes table", async () => {
    // Given
    const api = await authed(app);
    const backup = await (await api("/api/v1/backup")).json();
    delete backup.tables.month_notes;
    await api("/api/v1/month-notes/2026-10", { method: "PUT", body: { body: "샘플 메모" } });
    // When
    const response = await api("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup });
    // Then
    expect(response.status).toBe(200);
    expect(await (await api("/api/v1/month-notes/2026-10")).json()).toEqual({
      month: "2026-10",
      body: "",
      updated_at: null,
    });
  });

  test("rejects invalid backup notes without replacing existing data", async () => {
    // Given
    const api = await authed(app);
    const backup = await (await api("/api/v1/backup")).json();
    backup.tables.month_notes = [{ month: "2026-13", body: "샘플 메모", updated_at: "2026-10-01T09:00:00+09:00" }];
    // When
    const response = await api("/api/v1/backup/restore?confirm=REPLACE", { method: "POST", body: backup });
    // Then
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect((await (await api("/api/v1/backup")).json()).tables).toEqual({
      ...backup.tables,
      month_notes: [],
    });
  });

  test("adds month notes when opening an existing v3 database without changing rows", () => {
    // Given: a v3 database with synthetic data, without the new table.
    const path = join(app.dataDir, "v3.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE transactions(id TEXT PRIMARY KEY, merchant TEXT NOT NULL, amount INTEGER NOT NULL);
      INSERT INTO transactions VALUES('sample-tx', '테스트마트', 4500);
      PRAGMA user_version=3;
    `);
    const rows = legacy.query("SELECT * FROM transactions").all();
    const schema = legacy.query("SELECT sql FROM sqlite_master WHERE name='transactions'").get();
    legacy.close();
    // When
    const migrated = openDb(path);
    // Then
    try {
      expect(migrated.query("SELECT * FROM transactions").all()).toEqual(rows);
      expect(migrated.query("SELECT sql FROM sqlite_master WHERE name='transactions'").get()).toEqual(schema);
      expect(migrated.query("SELECT * FROM month_notes").all()).toEqual([]);
      expect(() => migrated.query("INSERT INTO month_notes VALUES(?,?,?)").run("2026-13", "메모", "now")).toThrow();
    } finally {
      migrated.close();
    }
  });
});
