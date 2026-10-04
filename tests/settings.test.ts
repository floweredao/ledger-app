import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authed, makeTestApp, type TestApp } from "./helpers";

describe("Settings", () => {
  let testApp: TestApp;

  beforeEach(() => {
    testApp = makeTestApp();
  });

  afterEach(() => {
    testApp.cleanup();
  });

  describe("GET /settings", () => {
    it("should return current settings", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings");
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data.month_start_day).toBe("number");
      expect(typeof data.owner_name).toBe("string");
      expect(data.theme).toMatch(/^(system|light|dark)$/);
      expect(["string", "object"].includes(typeof data.default_asset_id)).toBe(true);
    });

    it("should return default settings initially", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings");
      const data = await response.json();

      expect(data.month_start_day).toBe(1);
      expect(data.owner_name).toBe("");
      expect(data.theme).toBe("system");
      expect(data.default_asset_id).toBeNull();
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/settings");
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /settings", () => {
    it("should update month_start_day", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { month_start_day: 15 },
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.month_start_day).toBe(15);

      const getRes = await fetch("/api/v1/settings");
      const getData = await getRes.json();
      expect(getData.month_start_day).toBe(15);
    });

    it("should update owner_name", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { owner_name: "홍길동" },
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.owner_name).toBe("홍길동");
    });

    it("should update theme", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { theme: "dark" },
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.theme).toBe("dark");
    });

    it("should update default_asset_id", async () => {
      const fetch = await authed(testApp);
      const assetsRes = await fetch("/api/v1/assets");
      const assetsData = await assetsRes.json();
      const cashAsset = assetsData.items.find((a: { kind: string; id: string }) => a.kind === "cash");

      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { default_asset_id: cashAsset.id },
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.default_asset_id).toBe(cashAsset.id);
    });

    it("should reject month_start_day < 1", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { month_start_day: 0 },
      });
      expect(response.status).toBe(400);
    });

    it("should reject month_start_day > 28", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { month_start_day: 29 },
      });
      expect(response.status).toBe(400);
    });

    it("should reject owner_name > 40 chars", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { owner_name: "a".repeat(41) },
      });
      expect(response.status).toBe(400);
    });

    it("should reject invalid theme", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { theme: "invalid" },
      });
      expect(response.status).toBe(400);
    });

    it("should reject nonexistent default_asset_id", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { default_asset_id: "nonexistent-id" },
      });
      expect(response.status).toBe(400);
    });

    it("should allow partial updates", async () => {
      const fetch = await authed(testApp);
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        body: { month_start_day: 20 },
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.month_start_day).toBe(20);
      expect(data.theme).toBe("system");
    });

    it("should require authentication", async () => {
      const response = await testApp.request("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ month_start_day: 15 }),
      });
      expect(response.status).toBe(401);
    });

    it("should require CSRF token", async () => {
      const fetch = await authed(testApp);
      const response = await testApp.request("/api/v1/settings", {
        method: "PATCH",
        headers: {
          Cookie: fetch.cookie,
          Origin: "http://127.0.0.1:4340",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month_start_day: 15 }),
      });
      expect(response.status).toBe(403);
    });
  });
});
