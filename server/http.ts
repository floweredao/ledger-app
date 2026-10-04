import type { Database } from "bun:sqlite";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Config, Importer } from "./app";
import type { Auth, Session } from "./auth";

export type AppBindings = {
  Variables: {
    db: Database;
    config: Config;
    auth: Auth;
    importer: Importer | undefined;
    session: Session;
  };
};
export type AppContext = Context<AppBindings>;

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readJson<S extends z.ZodType>(c: Context, schema: S, maxBytes = 32768): Promise<z.output<S>> {
  const tooLarge = () => new ApiError(413, "too_large", `Body exceeds ${maxBytes} bytes`);
  if (Number(c.req.header("content-length") ?? 0) > maxBytes) throw tooLarge();
  const mediaType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const body = c.req.raw.body;
  if (body) {
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(chunk);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError(400, "invalid_json", "Malformed JSON");
    throw error;
  }
  return schema.parse(parsed);
}

export const onError: ErrorHandler = (error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError) {
    return c.json({ error: { code: "invalid_input", message: "Input validation failed", details: error.issues } }, 400);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: error.message } }, error.status);
  }
  // Request bodies, cookies and tokens never reach the log; only the error itself does.
  console.error(error);
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
};
