import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nowKst } from "../shared/dates";
import { DEFAULT_SETTINGS } from "../shared/schema";

export const SCHEMA_VERSION = 3;

const MIGRATION_V1 = `
CREATE TABLE assets(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('cash','bank','check_card','credit_card','savings','loan','other')),
  group_name TEXT NOT NULL DEFAULT '', opening_balance INTEGER NOT NULL DEFAULT 0,
  linked_asset_id TEXT REFERENCES assets(id), settlement_day INTEGER, payment_day INTEGER, performance_target INTEGER,
  external_ref TEXT UNIQUE, sort INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE categories(
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income')), parent_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL, icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(type, parent_id, name));
CREATE UNIQUE INDEX categories_top_level_name ON categories(type, name) WHERE parent_id IS NULL;
CREATE TABLE transactions(
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income','transfer')), occurred_at TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>=0), is_refund INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'KRW',
  foreign_amount REAL, krw_status TEXT NOT NULL DEFAULT 'exact' CHECK(krw_status IN ('exact','inferred','pending')),
  asset_id TEXT REFERENCES assets(id), to_asset_id TEXT REFERENCES assets(id), category_id TEXT REFERENCES categories(id),
  merchant TEXT NOT NULL DEFAULT '', merchant_key TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('manual','kakaobank_excel','kakaobank_sms','recurring','import','card_payment')),
  source_key TEXT UNIQUE, source_raw TEXT, src_account TEXT, src_amount INTEGER, src_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, hidden_reason TEXT, user_locked TEXT NOT NULL DEFAULT '[]', recurring_rule_id TEXT,
  deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX transactions_category ON transactions(category_id);
CREATE INDEX transactions_asset ON transactions(asset_id);
CREATE INDEX transactions_merchant_key ON transactions(merchant_key);
CREATE INDEX transactions_src ON transactions(src_account, src_amount, src_at);
CREATE TABLE merchant_rules(
  merchant_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), type TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(merchant_key, type));
CREATE TABLE budgets(
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL DEFAULT '', month TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL,
  UNIQUE(category_id, month));
CREATE TABLE recurring_rules(
  id TEXT PRIMARY KEY, template TEXT NOT NULL, freq TEXT NOT NULL CHECK(freq IN ('daily','weekly','monthly','yearly')),
  interval INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT, last_materialized_date TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE templates(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sessions(
  id_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE TABLE import_state(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE idempotency(
  key TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(key, method, path));
`;

type SeedCategory = readonly [name: string, icon: string, children?: readonly (readonly [string, string])[]];

const EXPENSE_SEED: readonly SeedCategory[] = [
  [
    "식비",
    "utensils",
    [
      ["식사", "utensils-crossed"],
      ["카페", "coffee"],
      ["편의점", "store"],
      ["배달", "bike"],
    ],
  ],
  [
    "교통",
    "bus",
    [
      ["대중교통", "tram-front"],
      ["택시", "car-taxi-front"],
      ["기차", "train-front"],
    ],
  ],
  [
    "쇼핑",
    "shopping-bag",
    [
      ["온라인", "package"],
      ["생활용품", "shopping-cart"],
      ["의류", "shirt"],
    ],
  ],
  [
    "문화/여가",
    "ticket",
    [
      ["PC방", "monitor"],
      ["게임", "gamepad-2"],
      ["영화·공연", "clapperboard"],
    ],
  ],
  [
    "구독",
    "repeat",
    [
      ["디지털", "smartphone"],
      ["멤버십", "badge-check"],
    ],
  ],
  [
    "주거/통신",
    "house",
    [
      ["통신비", "wifi"],
      ["관리비", "receipt"],
    ],
  ],
  [
    "의료/건강",
    "heart-pulse",
    [
      ["병원", "stethoscope"],
      ["약국", "pill"],
    ],
  ],
  ["미용", "scissors"],
  ["교육", "graduation-cap"],
  ["경조사/선물", "gift"],
  [
    "금융",
    "landmark",
    [
      ["수수료", "badge-percent"],
      ["이자비용", "percent"],
    ],
  ],
  ["이체·송금", "arrow-left-right"],
  ["기타지출", "ellipsis"],
  ["미분류", "circle-question-mark"],
];
const INCOME_SEED: readonly SeedCategory[] = [
  ["급여", "wallet"],
  ["용돈", "hand-coins"],
  ["이자", "piggy-bank"],
  ["캐시백·환급", "rotate-ccw"],
  ["이체입금", "arrow-down-left"],
  ["환불", "undo-2"],
  ["기타수입", "circle-plus"],
  ["미분류", "circle-question-mark"],
];
const PALETTE_SIZE = 12;

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  migrate(db);
  return db;
}

function userVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

/** The importer now books KakaoBank card payments on the account itself, so its old check-card assets fold into that account. */
function foldImportedCheckCards(db: Database): void {
  const cards = db
    .query<{ id: string; bank: string }, []>(
      `SELECT c.id, c.linked_asset_id AS bank FROM assets c
       WHERE c.kind='check_card' AND c.external_ref LIKE 'kakaobank-checkcard:%' AND c.linked_asset_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.type='transfer'
           AND ((t.asset_id=c.id AND t.to_asset_id=c.linked_asset_id) OR (t.asset_id=c.linked_asset_id AND t.to_asset_id=c.id)))`,
    )
    .all();
  const now = nowKst();
  for (const { id, bank } of cards) {
    db.query("UPDATE transactions SET asset_id=?, updated_at=? WHERE asset_id=?").run(bank, now, id);
    db.query("UPDATE transactions SET to_asset_id=?, updated_at=? WHERE to_asset_id=?").run(bank, now, id);
    for (const [table, column] of [
      ["templates", "payload"],
      ["recurring_rules", "template"],
    ] as const) {
      for (const row of db
        .query<{ id: string; json: string }, []>(`SELECT id, ${column} AS json FROM ${table}`)
        .all()) {
        const value: Record<string, unknown> = JSON.parse(row.json);
        const keys = ["asset_id", "to_asset_id"].filter((key) => value[key] === id);
        if (keys.length === 0) continue;
        for (const key of keys) value[key] = bank;
        db.query(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(JSON.stringify(value), row.id);
      }
    }
    db.query("UPDATE settings SET value=? WHERE key='default_asset_id' AND value=?").run(
      JSON.stringify(bank),
      JSON.stringify(id),
    );
    db.query("DELETE FROM assets WHERE id=?").run(id);
  }
}

function migrate(db: Database): void {
  if (userVersion(db) >= SCHEMA_VERSION) return;
  db.transaction(() => {
    if (userVersion(db) < 1) {
      db.exec(MIGRATION_V1);
      seed(db);
    }
    if (userVersion(db) < 2) db.exec("ALTER TABLE assets ADD COLUMN opening_date TEXT");
    if (userVersion(db) < 3) foldImportedCheckCards(db);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
  }).immediate();
}

/** Inserts the default categories, the cash asset and settings; rows that already exist are left untouched. */
export function seed(db: Database): void {
  const now = nowKst();
  const find = db.query<{ id: string }, [string, string | null, string]>(
    "SELECT id FROM categories WHERE type=? AND parent_id IS ? AND name=?",
  );
  const insert = db.query(
    "INSERT INTO categories(id,type,parent_id,name,icon,color,sort,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  const ensure = (type: string, parentId: string | null, name: string, icon: string, color: string, sort: number) => {
    const existing = find.get(type, parentId, name);
    if (existing) return existing.id;
    const id = Bun.randomUUIDv7();
    insert.run(id, type, parentId, name, icon, color, sort, now, now);
    return id;
  };
  for (const [type, list] of [
    ["expense", EXPENSE_SEED],
    ["income", INCOME_SEED],
  ] as const) {
    list.forEach(([name, icon, children = []], index) => {
      const color = `cat-${(index % PALETTE_SIZE) + 1}`;
      const parentId = ensure(type, null, name, icon, color, index);
      children.forEach(([childName, childIcon], childIndex) => {
        ensure(type, parentId, childName, childIcon, color, childIndex);
      });
    });
  }
  if (!db.query("SELECT id FROM assets WHERE kind='cash' AND name='현금'").get()) {
    db.query(
      "INSERT INTO assets(id,name,kind,group_name,sort,created_at,updated_at) VALUES(?,'현금','cash','현금',0,?,?)",
    ).run(Bun.randomUUIDv7(), now, now);
  }
  const setting = db.query("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) setting.run(key, JSON.stringify(value));
}
