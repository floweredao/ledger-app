import { z } from "zod";
import { type TransactionInput, TransactionInputSchema } from "../../shared/schema";
import { ApiError } from "../http";

export const EXPORT_HEADERS = [
  "날짜",
  "시간",
  "구분",
  "대분류",
  "소분류",
  "금액",
  "통화",
  "외화금액",
  "자산",
  "이체대상",
  "내용",
  "메모",
  "출처",
  "숨김",
] as const;
export type Cell = string | number;
export type ImportRow = {
  readonly row: number;
  readonly input: TransactionInput;
  readonly asset: string;
  readonly destination: string;
  readonly category: string;
  readonly subcategory: string;
  readonly hidden: boolean;
};
export type ImportPlan = {
  readonly detected_format: "ledger" | "money_manager";
  readonly total: number;
  readonly rows: readonly ImportRow[];
  readonly errors: readonly { readonly row: number; readonly message: string }[];
};

export function guardFormula(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}
function unguard(value: string): string {
  return /^'[\s]*[=+\-@]/.test(value) ? value.slice(1) : value;
}
export function encodeCsv(rows: readonly (readonly Cell[])[]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = guardFormula(String(value));
            return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}

export function decodeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        if (char === "\r" && input[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new ApiError(400, "invalid_csv", "Malformed CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new ApiError(400, "invalid_csv", "Unterminated quoted field");
  if (field || row.length || closed) rows.push([...row, field]);
  return rows;
}

function dateTime(value: string, time: string): string {
  const normalized = value.trim().replaceAll(".", "-").replaceAll("/", "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(normalized);
  if (!match) throw new ApiError(400, "invalid_date", "Expected a valid date and time");
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
  z.iso.date().parse(date);
  const clock = time.trim() || `${(hour ?? "0").padStart(2, "0")}:${minute ?? "00"}:${second ?? "00"}`;
  return z.iso.datetime({ offset: true }).parse(`${date}T${clock.length === 5 ? `${clock}:00` : clock}+09:00`);
}

export function parseImportTable(table: readonly (readonly string[])[]): ImportPlan {
  const headers = table[0]?.map((value) => value.trim()) ?? [];
  const own = EXPORT_HEADERS.every((header) => headers.includes(header));
  const find = (...names: string[]) => names.find((name) => headers.includes(name));
  const money =
    find("기간", "Date") &&
    find("자산", "Account") &&
    find("분류", "Category") &&
    find("내용", "Note") &&
    find("KRW", "Amount") &&
    find("수입/지출", "Income/Expense");
  if (!own && !money) throw new ApiError(400, "unknown_format", "Unrecognized import headers");
  const rows: ImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  let total = 0;
  for (const [index, cells] of table.slice(1).entries()) {
    if (cells.every((value) => value.trim() === "")) continue;
    total++;
    const get = (...names: string[]) => {
      const header = find(...names);
      return unguard(header === undefined ? "" : (cells[headers.indexOf(header)] ?? ""));
    };
    try {
      if (cells.length > headers.length) throw new ApiError(400, "invalid_row", "Too many columns");
      const kind = get(own ? "구분" : "수입/지출", "Income/Expense")
        .trim()
        .toLowerCase();
      const type = new Map([
        ["지출", "expense"],
        ["expense", "expense"],
        ["수입", "income"],
        ["income", "income"],
        ["이체", "transfer"],
        ["transfer", "transfer"],
      ]).get(kind);
      const rawAmount = get(own ? "금액" : "KRW", "Amount")
        .replaceAll(",", "")
        .trim();
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(rawAmount)) throw new ApiError(400, "invalid_amount", "Invalid amount");
      const signed = Number(rawAmount);
      const asset = get("자산", "Account").trim();
      const destination = get("이체대상").trim();
      const category = get(own ? "대분류" : "분류", "Category").trim();
      const subcategory = get("소분류", "Subcategory").trim();
      z.string().max(60).parse(asset);
      z.string().max(60).parse(destination);
      z.string().max(30).parse(category);
      z.string().max(30).parse(subcategory);
      if (subcategory && !category) throw new ApiError(400, "invalid_category", "Subcategory needs a category");
      if (type === "transfer" && (!destination || destination === asset)) {
        throw new ApiError(400, "invalid_transfer", "A transfer needs a different destination asset");
      }
      const foreign = get("외화금액").trim();
      const hidden = get("숨김").trim();
      if (hidden && !["0", "1", "false", "true"].includes(hidden)) {
        throw new ApiError(400, "invalid_hidden", "Invalid hidden flag");
      }
      const input = TransactionInputSchema.parse({
        type,
        occurred_at: dateTime(get(own ? "날짜" : "기간", "Date"), get("시간")),
        amount: type === "expense" ? Math.abs(signed) : signed,
        is_refund: type === "expense" && signed < 0,
        currency: get("통화") || "KRW",
        foreign_amount: foreign ? Number(foreign) : null,
        krw_status: foreign && signed === 0 ? "pending" : "exact",
        merchant: get("내용", "Note"),
        memo: get("메모", "Description"),
        ...(type === "transfer" ? { asset_id: asset || "__default", to_asset_id: destination } : {}),
      });
      rows.push({
        row: index + 2,
        input,
        asset,
        destination,
        category,
        subcategory,
        hidden: hidden === "1" || hidden === "true",
      });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof ApiError) {
        errors.push({
          row: index + 2,
          message: error instanceof ApiError ? error.message : "Invalid transaction fields",
        });
      } else throw error;
    }
  }
  return { detected_format: own ? "ledger" : "money_manager", total, rows, errors };
}
