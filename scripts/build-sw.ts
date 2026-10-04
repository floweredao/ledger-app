import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Optional output argument makes independent verification builds safe without touching shared dist. */
const directory = resolve(process.argv[2] ?? "dist");
const source = await readFile("public/sw.js", "utf8");
const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "sw.js")
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
if (!files.includes(join(directory, "index.html"))) throw new RangeError(`Missing built index.html in ${directory}`);
const hash = createHash("sha256");
hash.update(source);
for (const file of files) {
  hash.update(file.slice(directory.length));
  hash.update(await readFile(file));
}
const manifest = files.map((file) => file.slice(directory.length).replaceAll("\\", "/"));
const version = `ledger-shell-${hash.digest("hex").slice(0, 16)}`;
const worker = source
  .replace(/const PRECACHE = .*?; \/\/ ledger-precache/, `const PRECACHE = ${JSON.stringify(manifest)};`)
  .replace(/const CACHE_NAME = .*?; \/\/ ledger-version/, `const CACHE_NAME = ${JSON.stringify(version)};`);
await writeFile(join(directory, "sw.js"), worker);
console.info(`Service worker: ${version}, ${manifest.length} precached files in ${directory}`);
