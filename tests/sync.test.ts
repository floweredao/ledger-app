import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authed, makeTestApp, type TestApp } from "./helpers";

describe("Sync", () => {
  let testApp: TestApp;

  beforeEach(() => {
    testApp = makeTestApp();
  });

  afterEach(() => {
    testApp.cleanup();
  });

  describe("GET /sync/status", () => {
    it("should return sync status", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/sync/status");
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("last_run_at");
      expect(data).toHaveProperty("last_result");
      expect(data).toHaveProperty("last_error");
      expect(data).toHaveProperty("next_run_at");
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/sync/status");
      expect(response.status).toBe(401);
    });

    it("should have null initial state", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/sync/status");
      const data = await response.json();

      expect(data.last_run_at).toBe(null);
      expect(data.last_error).toBe(null);
    });
  });

  describe("POST /sync/run", () => {
    it("should return 503 when no importer is configured", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/sync/run", {
        method: "POST",
      });
      expect(response.status).toBe(503);
      const error = await response.json();
      expect(error.error.code).toBe("not_available");
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/sync/run", {
        method: "POST",
      });
      expect(response.status).toBe(401);
    });

    it("should require CSRF token", async () => {
      const fetch = await authed(testApp);
      const response = await testApp.request("/api/v1/sync/run", {
        method: "POST",
        headers: {
          Cookie: fetch.cookie,
          Origin: "http://127.0.0.1:4340",
        },
      });
      expect(response.status).toBe(403);
    });

    it("should accept valid requests with CSRF token", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/sync/run", {
        method: "POST",
      });
      expect(response.status).toBe(503);
    });
  });
});
