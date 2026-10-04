// Private JSON parsing and XML rendering. Never print identity or credential values.
import { readFileSync } from "node:fs";

export function serveState(config) {
  if (
    Object.values(config.Foreground ?? {}).some(
      (entry) => entry.TCP?.["4340"] || Object.keys(entry.Web ?? {}).some((key) => key.endsWith(":4340")),
    )
  ) {
    throw new Error("Foreground Serve 4340 configuration is not owned.");
  }
  const tcp = config.TCP?.["4340"];
  const web = Object.entries(config.Web ?? {}).filter(([key]) => key.endsWith(":4340"));
  const funnel = Object.entries(config.AllowFunnel ?? {}).some(([key, value]) => key.endsWith(":4340") && value);
  if (!tcp && web.length === 0 && !funnel) return "absent";
  const handlers = web[0]?.[1]?.Handlers;
  if (
    tcp?.HTTPS === true &&
    Object.keys(tcp).length === 1 &&
    web.length === 1 &&
    handlers &&
    Object.keys(handlers).length === 1 &&
    Object.keys(handlers["/"] ?? {}).length === 1 &&
    handlers["/"]?.Proxy === "http://127.0.0.1:4340" &&
    !funnel
  )
    return "matching";
  throw new Error("Conflicting Serve 4340 configuration; no changes made.");
}

export function identity(status) {
  const dns = status.Self?.DNSName?.replace(/\.$/, "");
  const login = status.User?.[String(status.Self?.UserID)]?.LoginName;
  if (status.BackendState !== "Running" || !dns || !/^[a-zA-Z0-9.-]+$/.test(dns) || !login) {
    throw new Error("Tailscale must be running with a Self DNS name and user identity.");
  }
  return { dns, login };
}

export function render(template, values) {
  const xmlEscape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char],
    );
  return template.replace(/__(BUN|RT|MODULE|WATCH|TS_HOST|TS_LOGIN)__/g, (_, key) => {
    if (!values[key]) throw new Error("Missing template value.");
    return xmlEscape(values[key]);
  });
}

if (import.meta.main) {
  try {
    const [mode, templatePath] = process.argv.slice(2);
    const json = JSON.parse(await Bun.stdin.text());
    if (mode === "serve") console.log(serveState(json));
    else if (mode === "url") console.log(`https://${identity(json).dns}:4340`);
    else if (mode === "render") {
      const { dns, login } = identity(json);
      process.stdout.write(
        render(readFileSync(templatePath, "utf8"), {
          BUN: process.env.BUN_PATH,
          RT: process.env.RT,
          MODULE: process.env.MODULE_PATH,
          WATCH: process.env.WATCH_PATH,
          TS_HOST: dns,
          TS_LOGIN: login,
        }),
      );
    } else throw new Error("Unknown configuration operation.");
  } catch {
    console.error("Invalid or conflicting private Tailscale configuration; refusing operation.");
    process.exitCode = 1;
  }
}
