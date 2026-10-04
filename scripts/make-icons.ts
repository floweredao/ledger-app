import { mkdir } from "node:fs/promises";

const source = process.argv[2];
if (!source) throw new Error("Usage: bun scripts/make-icons.ts <square-source-image>");

await mkdir("public/icons", { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
  ["apple-touch-icon", 180],
  ["favicon", 32],
] as const) {
  await Bun.file(source).image().resize(size, size).png().write(`public/icons/${name}.png`);
  console.info(`${name}.png: ${size}x${size}`);
}
