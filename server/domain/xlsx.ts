import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { ApiError } from "../http";
import { type Cell, guardFormula } from "./csv";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function columnName(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  }
  return result;
}

export function encodeXlsx(rows: readonly (readonly Cell[])[]): Uint8Array<ArrayBuffer> {
  const strings: string[] = [];
  const indexes = new Map<string, number>();
  const sheet = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((value, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
            const text = guardFormula(value);
            let index = indexes.get(text);
            if (index === undefined) {
              index = strings.length;
              indexes.set(text, index);
              strings.push(text);
            }
            return `<c r="${ref}" t="s"><v>${index}</v></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="거래" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `${XML}<worksheet xmlns="${MAIN}"><sheetData>${sheet}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `${XML}<sst xmlns="${MAIN}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("")}</sst>`,
  };
  return new Uint8Array(
    zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))),
  );
}

const many = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]), z.array(schema));
const text = z.union([z.string(), z.object({ "#text": z.string().default("") }).transform((value) => value["#text"])]);
const richText = z
  .object({
    t: text.optional(),
    r: many(z.object({ t: text.optional() })),
  })
  .transform((value) => value.t ?? value.r.map((run) => run.t ?? "").join(""));
const cellSchema = z.object({
  "@r": z.string(),
  "@t": z.string().optional(),
  "@s": z.coerce.number().int().optional(),
  v: z.string().optional(),
  is: richText.optional(),
  f: z.unknown().optional(),
});

export function decodeXlsx(data: Uint8Array): string[][] {
  try {
    let expanded = 0;
    const files = unzipSync(data, {
      filter: (file) => {
        expanded += file.originalSize;
        if (expanded > 50 * 1024 * 1024) throw new ApiError(413, "too_large", "Expanded workbook exceeds 50 MiB");
        return file.name.endsWith(".xml") || file.name.endsWith(".rels");
      },
    });
    const xml = (path: string): unknown => {
      const content = files[path];
      if (!content) throw new ApiError(400, "invalid_xlsx", "Missing workbook part");
      const source = strFromU8(content);
      if (/<!DOCTYPE|<!ENTITY/i.test(source))
        throw new ApiError(400, "invalid_xlsx", "XML declarations are not allowed");
      return Bun.XML.parse(source);
    };
    let sheetPath = "xl/worksheets/sheet1.xml";
    let date1904 = false;
    if (files["xl/workbook.xml"]) {
      const workbook = z
        .object({
          workbook: z.object({
            workbookPr: z.object({ "@date1904": z.string().optional() }).optional(),
            sheets: z.object({ sheet: many(z.object({ "@r:id": z.string() })) }),
          }),
        })
        .parse(xml("xl/workbook.xml")).workbook;
      date1904 = ["1", "true"].includes(workbook.workbookPr?.["@date1904"] ?? "");
      const relations = z
        .object({
          Relationships: z.object({
            Relationship: many(z.object({ "@Id": z.string(), "@Target": z.string() })),
          }),
        })
        .parse(xml("xl/_rels/workbook.xml.rels")).Relationships.Relationship;
      const target = relations.find((rel) => rel["@Id"] === workbook.sheets.sheet[0]?.["@r:id"])?.["@Target"];
      if (!target || target.includes("..")) throw new ApiError(400, "invalid_xlsx", "Invalid worksheet reference");
      sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
    const shared = files["xl/sharedStrings.xml"]
      ? z.object({ sst: z.object({ si: many(richText) }) }).parse(xml("xl/sharedStrings.xml")).sst.si
      : [];
    const dateStyles = new Set<number>();
    if (files["xl/styles.xml"]) {
      const style = z
        .object({
          styleSheet: z.object({
            numFmts: z
              .object({
                numFmt: many(
                  z.object({
                    "@numFmtId": z.coerce.number(),
                    "@formatCode": z.string(),
                  }),
                ),
              })
              .optional(),
            cellXfs: z.object({ xf: many(z.object({ "@numFmtId": z.coerce.number().default(0) })) }).optional(),
          }),
        })
        .parse(xml("xl/styles.xml")).styleSheet;
      for (const [index, xf] of (style.cellXfs?.xf ?? []).entries()) {
        const custom = style.numFmts?.numFmt.find((fmt) => fmt["@numFmtId"] === xf["@numFmtId"])?.["@formatCode"];
        if (
          (xf["@numFmtId"] >= 14 && xf["@numFmtId"] <= 22) ||
          (xf["@numFmtId"] >= 45 && xf["@numFmtId"] <= 47) ||
          (custom && /[ydhms]/i.test(custom.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")))
        )
          dateStyles.add(index);
      }
    }
    const rows = z
      .object({
        worksheet: z.object({
          sheetData: z.object({ row: many(z.object({ c: many(cellSchema) })) }),
        }),
      })
      .parse(xml(sheetPath)).worksheet.sheetData.row;
    return rows.map((row) => {
      const cells: string[] = [];
      for (const cell of row.c) {
        if (cell.f !== undefined) throw new ApiError(400, "invalid_xlsx", "Formula cells cannot be imported");
        const letters = /^([A-Z]+)\d+$/.exec(cell["@r"])?.[1];
        if (!letters) throw new ApiError(400, "invalid_xlsx", "Invalid cell reference");
        const index = [...letters].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
        if (index > 16383) throw new ApiError(400, "invalid_xlsx", "Cell outside worksheet");
        let value = cell.v ?? "";
        if (cell["@t"] === "s") {
          const entry = shared[Number(value)];
          if (entry === undefined) throw new ApiError(400, "invalid_xlsx", "Invalid shared string index");
          value = entry;
        } else if (cell["@t"] === "inlineStr") value = cell.is ?? "";
        else if (value && cell["@s"] !== undefined && dateStyles.has(cell["@s"])) {
          const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
          const serial = Number(value);
          if (!Number.isFinite(serial)) throw new ApiError(400, "invalid_xlsx", "Invalid Excel date");
          value = new Date(epoch + Math.round(serial * 86400) * 1000).toISOString().slice(0, 19);
        }
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }
      return cells;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error) throw new ApiError(400, "invalid_xlsx", "Malformed workbook");
    throw error;
  }
}
