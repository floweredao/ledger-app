import { Hono } from "hono";
import { z } from "zod";
import type { SessionState } from "../../shared/schema";
import type { Session } from "../auth";
import { ApiError, type AppBindings, readJson } from "../http";

const LoginSchema = z.object({ token: z.string().min(1).max(512) }).strict();
const signedIn = (session: Session): SessionState => ({
  authenticated: true,
  csrf_token: session.csrfToken,
  expires_at: session.expiresAt,
});
const signedOut: SessionState = { authenticated: false, csrf_token: null, expires_at: null };

export const authRoutes = new Hono<AppBindings>()
  .get("/auth/session", (c) => {
    const auth = c.get("auth");
    const existing = auth.findSession(c.req.raw);
    if (existing) {
      const touched = auth.touch(existing);
      if (touched) c.header("Set-Cookie", auth.cookie(c.req.raw, touched));
      return c.json(signedIn(touched ?? existing));
    }
    if (auth.isTailscaleOwner(c.req.raw)) {
      const session = auth.createSession();
      c.header("Set-Cookie", auth.cookie(c.req.raw, session));
      return c.json(signedIn(session));
    }
    return c.json(signedOut);
  })
  .post("/auth/session", async (c) => {
    const auth = c.get("auth");
    if (!auth.admitLoginAttempt()) {
      c.header("Retry-After", "60");
      throw new ApiError(429, "rate_limited", "Too many login attempts");
    }
    if (!auth.origins.has(c.req.header("origin") ?? "")) throw new ApiError(403, "origin", "Allowed Origin required");
    const { token } = await readJson(c, LoginSchema, 4096);
    if (!auth.isOwnerToken(token)) throw new ApiError(401, "unauthenticated", "Invalid token");
    const session = auth.createSession();
    c.header("Set-Cookie", auth.cookie(c.req.raw, session));
    return c.json(signedIn(session));
  })
  .delete("/auth/session", (c) => {
    const auth = c.get("auth");
    if (!auth.origins.has(c.req.header("origin") ?? "")) throw new ApiError(403, "origin", "Allowed Origin required");
    const session = auth.findSession(c.req.raw);
    if (session) {
      if (c.req.header("x-csrf-token") !== session.csrfToken) throw new ApiError(403, "csrf", "CSRF token required");
      auth.revoke(session);
    }
    c.header("Set-Cookie", auth.clearCookie(c.req.raw));
    return c.json(signedOut);
  });
