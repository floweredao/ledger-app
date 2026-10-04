import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { insertTransaction } from "../server/domain/tx-core";
import { TransactionInputSchema } from "../shared/schema";
import { type AuthedFetch, authed, makeTestApp, type TestApp } from "./helpers";

const HEADER = "날짜,시간,구분,대분류,소분류,금액,통화,외화금액,자산,이체대상,내용,메모,출처,숨김";
const own = (merchant = "샘플카페", date = "2026-10-04") =>
  `${HEADER}\r\n${date},09:15:00,지출,식비,카페,4500,KRW,,현금,,${merchant},,manual,0\r\n`;
let app: TestApp;
let request: AuthedFetch;
beforeEach(async () => {
  app = makeTestApp();
  request = await authed(app);
});
afterEach(() => app.cleanup());

function seed(merchant = "샘플카페") {
  return insertTransaction(
    app.db,
    TransactionInputSchema.parse({
      type: "expense",
      occurred_at: "2026-10-04T09:15:00+09:00",
      amount: 4500,
      merchant,
      memo: '메모, "인용"\n두 번째 줄',
    }),
  );
}
async function preview(data: string | Uint8Array | Blob, name = "ledger.csv") {
  const form = new FormData();
  form.set("file", new File([data instanceof Uint8Array ? new Uint8Array(data) : data], name));
  return request("/api/v1/import/preview", { method: "POST", body: form });
}
async function commit(preview_id: string, include_duplicates = false) {
  return request("/api/v1/import/commit", { method: "POST", body: { preview_id, include_duplicates } });
}
const count = (table: string) => app.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;

describe("export and import", () => {
  test("CSV exports BOM, quoted multiline fields and duplicates on round trip", async () => {
    seed();
    const response = await request("/api/v1/export?format=csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/ledger-\d{8}\.csv/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    expect(new TextDecoder().decode(bytes)).toContain('"메모, ""인용""\n두 번째 줄"');
    const result = await preview(bytes);
    expect(result.status).toBe(200);
    expect((await result.json()).counts).toEqual({ total: 1, new: 0, duplicate: 1, error: 0 });
  });

  test("guards all spreadsheet formula prefixes without losing the imported merchant", async () => {
    for (const prefix of ["=", "+", "-", "@"]) seed(`${prefix}샘플카페`);
    const bytes = new Uint8Array(await (await request("/api/v1/export?format=csv")).arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    for (const prefix of ["=", "+", "-", "@"]) expect(text).toContain(`'${prefix}샘플카페`);
    expect((await (await preview(bytes)).json()).counts.duplicate).toBe(4);
  });

  test("XLSX has a complete workbook, numeric cells and duplicate round trip", async () => {
    seed("=샘플카페");
    const response = await request("/api/v1/export?format=xlsx");
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/sharedStrings.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
      ]),
    );
    expect(strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array())).toContain("<v>4500</v>");
    expect(strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array())).not.toContain("<f>");
    expect((await (await preview(bytes, "ledger.xlsx")).json()).counts.duplicate).toBe(1);
  });

  test("Money Manager Korean headers plan names without database writes and commit them", async () => {
    const assets = count("assets");
    const categories = count("categories");
    const result = await preview(await Bun.file("tests/fixtures/io/money-manager.csv").text());
    expect(result.status).toBe(200);
    const plan = await result.json();
    expect(plan.detected_format).toBe("money_manager");
    expect(plan.counts).toEqual({ total: 2, new: 2, duplicate: 0, error: 0 });
    expect(count("assets")).toBe(assets);
    expect(count("categories")).toBe(categories);
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 2, skipped: 0 });
    expect(app.db.query("SELECT amount, source, merchant, memo FROM transactions ORDER BY occurred_at").all()).toEqual([
      { amount: 4500, source: "import", merchant: "샘플카페", memo: '메모, "인용"' },
      { amount: 12000, source: "import", merchant: "홍길동", memo: "합성 데이터" },
    ]);
    expect(app.db.query("SELECT name FROM categories WHERE name LIKE '테스트%'").all()).toHaveLength(3);
    expect(
      app.db
        .query<{ source_key: string }, []>("SELECT source_key FROM transactions")
        .all()
        .every((row) => /^imp:[a-f0-9]{64}$/.test(row.source_key)),
    ).toBe(true);
  });

  test("English Money Manager headers map amounts and income", async () => {
    const response = await preview(
      "Date,Account,Category,Subcategory,Note,Amount,Income/Expense,Description\n2026-10-04 09:15:00,현금,급여,,홍길동,12000,Income,합성\n",
    );
    expect(response.status).toBe(200);
    const plan = await response.json();
    expect(plan.rows[0]).toMatchObject({ type: "income", amount: 12000, merchant: "홍길동" });
  });

  test("reports invalid calendar dates and commits only valid rows", async () => {
    const result = await preview(`${own()}2026-02-30,09:15:00,지출,,,1,KRW,,현금,,테스트마트,,,0\n`);
    const plan = await result.json();
    expect(plan.counts).toEqual({ total: 2, new: 1, duplicate: 0, error: 1 });
    expect(plan.errors[0].row).toBe(3);
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 1, skipped: 1 });
  });

  test("rejects unknown headers", async () => {
    const response = await preview("not,a,ledger\n1,2,3", "unknown.txt");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("unknown_format");
  });

  test("rejects malformed quoted CSV", async () => {
    const response = await preview(`${HEADER}\n"unterminated`);
    expect(response.status).toBe(400);
  });

  test("rejects oversized uploads", async () => {
    const response = await preview(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]));
    expect(response.status).toBe(413);
  });

  test("limits displayed rows but commits the entire plan", async () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `2026-10-04,09:15:00,지출,,,${i + 1},KRW,,현금,,테스트마트${i},,,0`,
    );
    const plan = await (await preview(`${HEADER}\n${rows.join("\n")}`)).json();
    expect(plan.rows).toHaveLength(50);
    expect(plan.counts.total).toBe(60);
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 60, skipped: 0 });
  });

  test("skips existing and within-file duplicates by default", async () => {
    seed();
    const plan = await (await preview(`${own()}${own().split("\r\n")[1]}\r\n`)).json();
    expect(plan.counts).toEqual({ total: 2, new: 0, duplicate: 2, error: 0 });
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 0, skipped: 2 });
  });

  test("include_duplicates imports once while source keys prevent replay", async () => {
    seed();
    const plan = await (await preview(own())).json();
    expect(await (await commit(plan.preview_id, true)).json()).toEqual({ inserted: 1, skipped: 0 });
    const again = await (await preview(own())).json();
    expect(await (await commit(again.preview_id, true)).json()).toEqual({ inserted: 0, skipped: 1 });
    expect(count("transactions")).toBe(2);
  });

  test("commit rechecks duplicates inserted after preview", async () => {
    const plan = await (await preview(own())).json();
    seed();
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 0, skipped: 1 });
  });

  test("preview expires at fifteen minutes with an injected clock", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
    try {
      const plan = await (await preview(own())).json();
      clock.mockReturnValue(1_790_000_900_000);
      expect((await commit(plan.preview_id)).status).toBe(404);
    } finally {
      clock.mockRestore();
    }
  });

  test("preview ids cannot cross database boundaries or be reused", async () => {
    const plan = await (await preview(own())).json();
    const other = makeTestApp();
    try {
      const otherRequest = await authed(other);
      expect(
        (
          await otherRequest("/api/v1/import/commit", {
            method: "POST",
            body: { preview_id: plan.preview_id },
          })
        ).status,
      ).toBe(404);
    } finally {
      other.cleanup();
    }
    expect((await commit(plan.preview_id)).status).toBe(200);
    expect((await commit(plan.preview_id)).status).toBe(404);
  });

  test("export applies inclusive date, query, amount, source and hidden filters", async () => {
    const visible = seed();
    insertTransaction(
      app.db,
      TransactionInputSchema.parse({
        type: "income",
        amount: 9000,
        occurred_at: "2026-10-05T00:00:00+09:00",
        merchant: "홍길동",
      }),
      { hidden: true },
    );
    const response = await request(
      "/api/v1/export?format=csv&from=2026-10-04&to=2026-10-04&q=샘플&type=expense&min=4500&max=4500&source=manual",
    );
    const plan = await (await preview(new Uint8Array(await response.arrayBuffer()))).json();
    expect(plan.counts.total).toBe(1);
    expect(plan.rows[0].amount).toBe(visible.amount);
    const hidden = await request("/api/v1/export?format=csv&hidden=only");
    expect((await (await preview(new Uint8Array(await hidden.arrayBuffer()))).json()).counts.total).toBe(1);
    expect((await request("/api/v1/export?format=pdf")).status).toBe(400);
    expect((await request("/api/v1/export?format=csv&from=2026-02-30")).status).toBe(400);
  });

  test("preview maps existing named assets and child categories to their ids", async () => {
    const plan = await (await preview(own())).json();
    const asset = app.db.query<{ id: string }, []>("SELECT id FROM assets WHERE name='현금'").get();
    const category = app.db.query<{ id: string }, []>("SELECT id FROM categories WHERE name='카페'").get();
    expect(plan.rows[0]).toMatchObject({ asset_id: asset?.id, category_id: category?.id });
  });

  test("preserves refunds, foreign amounts, hidden flags and named transfers at commit", async () => {
    const plan = await (
      await preview(
        `${HEADER}\n2026-10-04,09:15:00,지출,,,'-4500,USD,3,현금,,테스트환불,,,1\n2026-10-04,10:00:00,이체,,,7000,KRW,,현금,테스트저축,테스트이체,,,0\n`,
      )
    ).json();
    expect(plan.counts).toEqual({ total: 2, new: 2, duplicate: 0, error: 0 });
    expect(await (await commit(plan.preview_id)).json()).toEqual({ inserted: 2, skipped: 0 });
    expect(
      app.db
        .query("SELECT amount,is_refund,currency,foreign_amount,hidden FROM transactions WHERE type='expense'")
        .get(),
    ).toEqual({ amount: 4500, is_refund: 1, currency: "USD", foreign_amount: 3, hidden: 1 });
    expect(
      app.db
        .query("SELECT a.name FROM transactions t JOIN assets a ON a.id=t.to_asset_id WHERE t.type='transfer'")
        .get(),
    ).toEqual({ name: "테스트저축" });
  });

  test("export walks every page instead of silently truncating at the list limit", async () => {
    app.db.transaction(() => {
      for (let i = 0; i < 1001; i++) seed(`테스트마트${i}`);
    })();
    const response = await request("/api/v1/export?format=csv");
    const plan = await (await preview(new Uint8Array(await response.arrayBuffer()))).json();
    expect(plan.counts).toEqual({ total: 1001, new: 0, duplicate: 1001, error: 0 });
  });

  test("rejects malformed XLSX archives and executable formula cells", async () => {
    expect((await preview(new Uint8Array([80, 75, 0, 0]), "invalid.xlsx")).status).toBe(400);
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
      ),
    });
    expect((await preview(bytes, "formula.xlsx")).status).toBe(400);
  });

  test("imports numeric Excel dates and inline strings from Money Manager XLSX", async () => {
    const cells = ["Date", "Account", "Category", "Subcategory", "Note", "Amount", "Income/Expense", "Description"];
    const header = cells
      .map((s, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${s}</t></is></c>`)
      .join("");
    const sheet = `<worksheet><sheetData><row r="1">${header}</row><row r="2"><c r="A2" s="1"><v>46299.5</v></c><c r="B2" t="inlineStr"><is><t>현금</t></is></c><c r="E2" t="inlineStr"><is><t>테스트마트</t></is></c><c r="F2"><v>4500</v></c><c r="G2" t="inlineStr"><is><t>Expense</t></is></c></row></sheetData></worksheet>`;
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(sheet),
      "xl/styles.xml": strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>'),
    });
    const plan = await (await preview(bytes, "money.xlsx")).json();
    expect(plan.rows[0]).toMatchObject({ occurred_at: "2026-10-04T12:00:00+09:00", amount: 4500 });
  });
});
