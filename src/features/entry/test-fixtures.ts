const stamp = "2026-10-01T09:00:00+09:00";
const category = (id: string, name: string, type: "expense" | "income", parent: string | null, sort: number) => ({
  id,
  type,
  parent_id: parent,
  name,
  icon: "utensils",
  color: "cat-1",
  sort,
  hidden: false,
  created_at: stamp,
  updated_at: stamp,
});
const asset = (id: string, name: string, sort: number) => ({
  id,
  name,
  kind: "bank",
  group_name: "",
  opening_balance: 0,
  opening_date: null,
  linked_asset_id: null,
  settlement_day: null,
  payment_day: null,
  performance_target: null,
  external_ref: null,
  sort,
  hidden: false,
  created_at: stamp,
  updated_at: stamp,
  balance: 0,
});
export const row = {
  id: "tx1",
  type: "expense",
  occurred_at: "2026-10-03T12:30:00+09:00",
  amount: 12000,
  is_refund: false,
  currency: "KRW",
  foreign_amount: null,
  krw_status: "exact",
  asset_id: "a-bank",
  to_asset_id: null,
  category_id: "c-food",
  merchant: "테스트마트",
  merchant_key: "테스트마트",
  memo: "",
  source: "kakaobank_sms",
  source_key: null,
  src_account: null,
  src_amount: null,
  src_at: null,
  hidden: false,
  hidden_reason: null,
  user_locked: [],
  recurring_rule_id: null,
  deleted_at: null,
  created_at: stamp,
  updated_at: stamp,
};

export function listOf(tx: typeof row) {
  return { items: [tx], totals: { income: 0, expense: tx.amount, net: -tx.amount, count: 1 }, next_cursor: null };
}

export const GETS: Record<string, unknown> = {
  categories: {
    items: [
      {
        ...category("c-food", "식비", "expense", null, 1),
        children: [category("c-cafe", "카페", "expense", "c-food", 1)],
      },
      { ...category("c-transit", "교통", "expense", null, 2), children: [] },
      { ...category("c-salary", "급여", "income", null, 1), children: [] },
    ],
  },
  assets: { items: [asset("a-bank", "테스트통장", 1), asset("a-card", "샘플카드", 2)] },
  settings: { month_start_day: 1, owner_name: "홍길동", theme: "system", default_asset_id: "a-bank" },
  templates: {
    items: [
      {
        id: "t1",
        name: "샘플카페 아메리카노",
        payload: { type: "expense", amount: 4500, category_id: "c-cafe", merchant: "샘플카페", asset_id: "a-card" },
        sort: 0,
        use_count: 3,
        created_at: stamp,
        updated_at: stamp,
      },
    ],
  },
  "merchant-rules": {
    items: [
      { merchant_key: "샘플카페", category_id: "c-cafe", category_name: "카페", type: "expense", updated_at: stamp },
    ],
  },
  transactions: listOf(row),
};
