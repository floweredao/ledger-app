import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

// Client tests render React into happy-dom; server tests keep Bun's own fetch primitives (see below).
const native = {
  fetch,
  Request,
  Response,
  Headers,
  FormData,
  Blob,
  File,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  indexedDB,
  IDBKeyRange,
};
GlobalRegistrator.register({ url: "http://127.0.0.1:4341/" });
Object.assign(globalThis, native);
