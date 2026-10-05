# API

모든 경로는 `/api/v1` 아래에 있고 JSON을 주고받아요(내보내기와 가져오기 미리보기는 예외). 거래 금액 `amount`는 0 이상의 정수 원(KRW)이고, 시각은 `+09:00`이 붙은 ISO 문자열, 서버가 만드는 id는 UUIDv7 문자열이에요.

## 공통 규칙

- 인증: `GET /health`와 `/auth/session`을 빼면 모두 `ledger_session` 쿠키가 필요해요. 없거나 만료됐으면 401 `unauthenticated`예요. 세션은 30일이고, 마지막 갱신에서 1시간이 지난 요청이 오면 만료를 다시 30일로 늘리고 쿠키를 새로 내려줘요.
- 변경 요청: POST, PUT, PATCH, DELETE는 허용 목록에 있는 `Origin`(아니면 403 `origin`)과 세션의 `X-CSRF-Token`(아니면 403 `csrf`)이 있어야 해요. 허용 목록은 `LEDGER_ALLOWED_ORIGINS`, `http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://127.0.0.1:4341`, `http://localhost:4341`, 그리고 설정돼 있으면 `https://<LEDGER_TAILSCALE_HOST>`예요.
- JSON 본문: `Content-Type: application/json`이 아니면 415 `unsupported_media_type`, 문법이 깨지면 400 `invalid_json`이에요. 스키마는 대부분 `strict`라서 모르는 필드가 오면 400 `invalid_input`이에요.
- 본문 한도: 기본 32 KiB(32768바이트), 로그인은 4096바이트, 가져오기 파일은 10 MiB, 백업 복원은 50 MiB예요. 넘으면 413 `too_large`예요.
- Idempotency-Key: 거래 변경 요청(`POST /transactions`, `PATCH/DELETE /transactions/:id`, `POST /transactions/:id/restore`)만 이 헤더를 써요. 1~200자가 아니면 400 `invalid_idempotency_key`예요. 같은 키, 메서드, 경로로 다시 오면 저장된 상태 코드와 본문을 그대로 돌려줘요. 7일이 지난 키는 다음 변경 때 지워져요.
- 응답 헤더: `/api/` 응답에는 `Cache-Control: no-store`가 붙어요.

### 날짜와 월

- 거래 입력·수정의 `occurred_at`은 UTC를 포함한 시간대 표기를 받아요. 저장할 때 같은 순간의 KST `+09:00` 표기로 정규화해 한국 날짜별 조회와 집계가 일치하게 해요.
- 공개 `from`, `to` 쿼리는 `YYYY-MM-DD`이고 **양 끝을 포함**해요. 서버는 내부에서 `to` 다음 날 00:00(KST) 전까지로 바꿔 계산해요. `from`이 `to`보다 늦으면 400이에요.
- **회계 월**은 설정 `month_start_day`(1~28)부터 다음 달 같은 날 전까지예요. 예산(`GET /budgets`)과 추이(`GET /stats/trend`)의 기본 집계가 이걸 써요. 가계부 월별 화면은 추이에 `basis=calendar`를 지정해 달력 월로 조회해요.
- **달력 월**은 1일부터 말일까지예요. `GET /stats/calendar`는 `month_start_day`와 관계없이 달력 월을 써요.

### 집계 규칙

- 삭제된 거래(`deleted_at`)는 목록과 합계에서 항상 빠져요.
- 숨긴 거래(`hidden`)는 따로 고르지 않으면 빠져요.
- 이체는 수입, 지출 합계에 들어가지 않아요. `is_refund`인 지출은 지출 합계에서 빼요(음수로 더해요).

## 오류

형식은 `{"error":{"code":"...","message":"..."}}`예요. 스키마 검증 실패(`invalid_input`)에는 `details`(Zod issue 배열)가 더 붙어요.

| 상태 | code | 언제 |
| --- | --- | --- |
| 400 | `invalid_input` | 본문, 쿼리, 경로 값이 Zod 스키마와 안 맞아요. 설정의 없는 `default_asset_id`도 이 코드예요 |
| 400 | `invalid_request` | 통계 쿼리 오류, 백업 복원 확인값 누락이나 백업 내용 오류 |
| 400 | `invalid_json` | JSON 문법 오류 |
| 400 | `invalid_idempotency_key`, `invalid_cursor`, `invalid_query`, `invalid_range` | 헤더, 커서, 불리언 쿼리, 내보내기 기간이 잘못됐어요 |
| 400 | `invalid_category`, `invalid_asset`, `invalid_reference`, `invalid_transfer` | 거래나 예산이 가리키는 분류, 자산이 맞지 않아요 |
| 400 | `invalid_reorder`, `invalid_reassign`, `invalid_parent`, `max_depth`, `invalid_card_payment`, `invalid_upload` | 각 엔드포인트 설명 참고 |
| 401 | `unauthenticated` | 세션이 없거나 만료됐어요, 또는 로그인 토큰이 틀렸어요 |
| 403 | `origin` / `csrf` | Origin이나 CSRF 토큰이 맞지 않아요 |
| 404 | `not_found` | 대상이 없어요(알 수 없는 `/api` 경로 포함) |
| 404 | `preview_not_found` | 가져오기 미리보기가 없거나 15분이 지났어요 |
| 409 | `in_use` | 다른 데이터가 참조하고 있어서 지울 수 없어요 |
| 409 | `conflict` | 클라이언트가 준 거래 `id`가 이미 있거나, 같은 부모 아래 같은 이름의 분류가 있어요 |
| 413 | `too_large` | 본문이 한도를 넘었어요 |
| 415 | `unsupported_media_type` | Content-Type이 맞지 않아요 |
| 429 | `rate_limited` | 로그인 시도가 1분에 5회를 넘었어요(`Retry-After: 60`) |
| 500 | `internal_error` | 서버 오류(자세한 내용은 노출하지 않아요) |
| 503 | `not_available` | 가져오기 모듈이 연결되지 않은 상태에서 동기화를 요청했어요 |

## 상태와 인증

SessionState는 `{authenticated, csrf_token, expires_at}`이에요. 로그인 안 된 상태는 `{authenticated: false, csrf_token: null, expires_at: null}`이에요.

### `GET /health`
인증 없이 `{ok: true, version}`을 돌려줘요.

### `POST /auth/session`
본문 `{token}`. 순서대로 확인해요: 1분에 6번째 시도부터 429, 허용되지 않은 Origin이면 403 `origin`, 토큰이 틀리면 401. 성공하면 쿠키를 설정하고 SessionState를 돌려줘요. CSRF 토큰은 필요 없어요.

### `GET /auth/session`
쿠키 세션이 살아 있으면 SessionState(필요하면 만료 연장)를 돌려줘요. 세션이 없어도 Host가 `LEDGER_TAILSCALE_HOST`, `Tailscale-User-Login`이 `LEDGER_TAILSCALE_LOGIN`과 정확히 같고 Authorization 헤더가 없으면 새 세션을 만들어요. 둘 다 아니면 로그아웃 상태를 돌려줘요(401이 아니에요).

### `DELETE /auth/session`
허용된 Origin이 필요해요. 세션이 있으면 `X-CSRF-Token`도 맞아야 하고 세션을 지워요. 쿠키를 지우고 `{authenticated: false, csrf_token: null, expires_at: null}`을 돌려줘요.

## 거래

Transaction 필드: `id, type('expense'|'income'|'transfer'), occurred_at, amount, is_refund, currency, foreign_amount, krw_status('exact'|'inferred'|'pending'), asset_id, to_asset_id, category_id, merchant, merchant_key, memo, source, source_key, src_account, src_amount, src_at, hidden, hidden_reason, user_locked, recurring_rule_id, deleted_at, created_at, updated_at`.

- `source`는 `manual | kakaobank_excel | kakaobank_sms | recurring | import | card_payment`예요.
- `src_account`, `src_amount`, `src_at`은 가져오기 전용이라 API로 쓸 수 없어요. `amount`는 항상 정수 원이지만, 원본 금액 `src_amount`는 소수일 수 있어요.

### `GET /transactions`
쿼리:

| 이름 | 값 |
| --- | --- |
| `from`, `to` | `YYYY-MM-DD`, 양 끝 포함 |
| `q` | 가맹점, 메모 부분 일치(대소문자 무시, 100자까지) |
| `type` | `expense|income|transfer` |
| `category_id` | 일반 분류 id는 하위 분류까지 포함해요. `uncategorized`는 `category_id IS NULL`인 미분류 거래만 골라요. 생략하면 분류를 제한하지 않아요. 목록과 CSV/XLSX 내보내기에 같은 규칙을 적용해요 |
| `asset_id` | 출금, 입금 양쪽과 이 계좌에 연결된 체크카드 거래까지 포함해요 |
| `min`, `max` | 금액 범위(정수), `min`이 `max`보다 크면 400 |
| `source` | 위 source 값 중 하나 |
| `hidden` | `exclude`(기본) `include` `only` |
| `limit` | 1~1000, 기본 200 |
| `cursor` | 이전 응답의 `next_cursor` |

`month`나 `include_deleted`는 없어요. 정렬은 `occurred_at`, `id` 내림차순이에요. 응답 `{items: Transaction[], totals: {income, expense, net, count}, next_cursor: string | null}`. `totals`는 커서와 상관없이 필터 전체 기준이에요.

### `GET /transactions/:id`
페이지 크기나 날짜 필터와 관계없이 거래 하나를 읽어요. 숨김·소프트 삭제 기록도 해당 플래그와 함께 반환하고, 없는 ID는 404예요. 다른 거래 API와 마찬가지로 인증이 필요해요.

### `POST /transactions`
본문: 필수 `type, occurred_at(오프셋 포함 ISO), amount`. 선택 `id(UUID)`, `is_refund`(기본 false), `currency`(기본 `KRW`, 대문자 3자), `foreign_amount`(양수 또는 null), `krw_status`(기본 `exact`), `asset_id`, `to_asset_id`(이체는 `asset_id`와 다른 값 필수), `category_id`, `merchant`(100자), `memo`(500자). 분류 타입이 거래 타입과 다르면 400 `invalid_category`, 없는 자산이면 400 `invalid_asset`. 응답 201 `Transaction`.

### `PATCH /transactions/:id`
본문: 위 필드(`id` 제외)와 `hidden`, `hidden_reason`의 일부, 그리고 선택 `learn`, `apply_to_past`. 실제로 바뀐 필드 이름은 `user_locked`에 쌓여서 가져오기가 덮어쓰지 않아요.

분류가 바뀌고 `learn`이 false가 아니며 가맹점 키가 있으면 `merchant_rules`에 학습해요. 그때 `apply_to_past: true`면 같은 가맹점 키, 같은 타입의 다른 거래 중 `category_id`가 잠기지 않은 것도 바꿔요. 응답은 `Transaction`에 `applied_count`(바꾼 과거 거래 수, 기본 0)를 더한 객체예요. 없으면 404.

수입·지출을 다른 자산과 주고받은 이체로 바꿀 때도 이 PATCH를 써요. 거래 편집 화면의 "이체로 바꾸기"는 나간 돈(지출)이면 `{type:'transfer', to_asset_id:<고른 자산>, category_id:null}`, 들어온 돈(수입·환불)이면 `{type:'transfer', asset_id:<고른 자산>, to_asset_id:<원래 자산>, category_id:null}`(환불이면 `is_refund:false` 포함)을 보내요. 바뀐 필드가 잠기므로 같은 거래를 다시 가져오거나 엑셀로 병합해도 이체가 유지돼요. 이체는 통계와 합계에서 빠지고, 잔액에는 각 자산의 `opening_date` 규칙대로 반영돼요. 자동으로 바꾸는 규칙은 없어요.

### `DELETE /transactions/:id`
소프트 삭제(`deleted_at` 설정). 응답 `Transaction`.

### `POST /transactions/:id/restore`
삭제를 되돌려요. 응답 `Transaction`.

## 분류

Category: `id, type('expense'|'income'), parent_id, name, icon, color, sort, hidden, created_at, updated_at`.

### `GET /categories`
쿼리 `type`, `include_hidden`(`true|false|1|0`, 다른 값은 400 `invalid_query`). 응답 `{items: Category[]}`.

### `POST /categories`
본문 `type, name(1~30자)`, 선택 `parent_id, icon, color`(각 40자). 분류는 두 단계까지예요. 부모 타입이 다르면 400 `invalid_parent`, 하위 분류 아래에 만들면 400 `max_depth`, 같은 이름이 있으면 409 `conflict`. 201 `Category`.

### `PATCH /categories/:id`
본문 `name, icon, color, hidden, sort, parent_id` 중 일부. 응답 `Category`.

### `DELETE /categories/:id`
쿼리 `reassign_to`가 없으면, 하위 분류가 있거나 거래, 예산, 가맹점 규칙, 반복 거래, 템플릿이 참조할 때 409 `in_use`예요.

`reassign_to`를 주면 한 트랜잭션 안에서 거래, 예산(같은 월 예산은 합산), 가맹점 규칙과 반복 거래·템플릿의 분류 참조를 대상으로 옮기고, 하위 분류는 대상 아래로 옮긴 뒤 지워요. 대상이 자기 자신이거나 타입이 다르면 400 `invalid_reassign`, 하위 분류가 있는데 대상이 하위 분류면 역시 400 `invalid_reassign`이에요. 응답 `{ok: true}`.

### `POST /categories/reorder`
본문 `{ids: string[]}`(1~500개, 같은 타입, 같은 부모). 중복이나 형제가 아닌 id가 섞이면 400 `invalid_reorder`. 응답 `{ok: true}`.

### `GET /merchant-rules`
응답 `{items: [{merchant_key, category_id, category_name, type, updated_at}]}`.

### `DELETE /merchant-rules/:key`
`key`는 URL 인코딩한 가맹점 키예요. 쿼리 `type`(`expense|income`)을 주면 그 타입 규칙만 지워요. 없으면 404, 성공하면 `{ok: true}`.

## 자산

Asset: `id, name, kind, group_name, opening_balance, opening_date, linked_asset_id, settlement_day, payment_day, performance_target, external_ref, sort, hidden, created_at, updated_at`. `kind`는 `cash | bank | check_card | credit_card | savings | loan | other`예요.

`opening_date`는 한국 시간(KST) 기준 `YYYY-MM-DD` 또는 null이에요. null이면 기존처럼 전체 거래를 기존 잔액에 반영해요. 날짜가 있으면 그날 이전 거래 효과는 `opening_balance`에 이미 포함된 것으로 보고, 그날 00:00 KST부터 이후 거래만 잔액에 반영해요. 이체의 출금과 입금은 각각 해당 자산의 기준일을 따르므로 한쪽만 제외될 수 있어요. 체크카드는 먼저 연결 계좌로 해석한 뒤 그 계좌의 기준일을 적용해요. 카드 사용액·실적·청구 주기·예상 결제액과 거래 내역 조회는 이 기준일로 잘라내지 않아요.

AssetSummaryRow는 Asset에 다음을 더해요: `balance`, `usage`(카드의 이번 주기 사용액, 카드가 아니면 null), `cycle: {from, to} | null`, `payment_date`, `expected_payment`(신용카드의 직전 마감 주기 미납액), `performance: {target, achieved, pct} | null`, `reported_balance`, `reported_at`, `mismatch`(장부 잔액 빼기 보고 잔액). 체크카드의 `balance`는 연결 계좌 잔액이에요.

### `GET /assets`
쿼리 `include_hidden`(`true|false|1|0`). 응답 `{items: AssetSummaryRow[]}`.

### `GET /assets/summary`
쿼리 `include_hidden`. 응답 `{assets: AssetSummaryRow[], totals: {assets, debts, net_worth}}`. 합계에서 체크카드와 가져오기가 본인 이체 상대로 만든 "내 다른 계좌"(`external_ref` `self:other`, 잔액을 알 수 없는 자리표시)는 빼고, 양수 잔액은 `assets`, 음수 잔액의 절댓값은 `debts`에 더해요.

### `POST /assets`
본문 `name(1~60자), kind`, 선택 `group_name`(40자, 기본 ""), `opening_balance`(기본 0, 음수 가능), `opening_date`(기본 null, 유효한 `YYYY-MM-DD` 또는 null), `linked_asset_id, settlement_day, payment_day, performance_target, sort, hidden`. 카드 필드는 카드 자산에만 쓸 수 있고, 체크카드는 연결 계좌가 필수, 연결 대상은 `bank` 또는 `savings`여야 해요(아니면 400 `invalid_asset`). 잘못된 기준일은 400 `invalid_input`이에요. 201 `Asset`.

### `PATCH /assets/:id`
일부 필드. 빠진 필드는 그대로 둬요. `opening_date: null`은 기준일을 지우고 전체 거래를 다시 반영해요. 응답 `Asset`.

### `DELETE /assets/:id`
응답 `{ok: true}`. 거래, 연결 카드, 반복 거래 또는 템플릿이 참조하면 409 `in_use`예요(숨기려면 `hidden`을 쓰세요). 반복 거래의 활성 여부와 관계없이 출발·도착 자산 참조를 모두 확인해요.

### `POST /assets/:id/card-payment`
신용카드 대금을 연결 계좌에서 카드로 가는 이체로 기록해요. 본문 `{amount?, date?}`(`date`는 `YYYY-MM-DD`, 그날 00:00 KST로 기록, 없으면 지금). `amount`가 없으면 그 날짜 기준 `expected_payment`를 써요. 신용카드가 아니거나 연결 계좌가 없거나 낼 금액이 0이면 400 `invalid_card_payment`. 201 `Transaction`(source `card_payment`).

## 예산

### `GET /budgets`
쿼리 `month=YYYY-MM`(필수, 회계 월). 응답 `{month, range: {from, to}, total, categories}`. `range.to`는 회계 월 마지막 날을 포함하는 값이에요.

`total`과 각 `categories` 항목에는 `budget_id`, `budget_month`, `budget`, `spent`, `remaining`, `pct`, `over`가 있어요. 분류 항목에는 `category_id`, `name`, `icon`, `color`도 있어요.

- `budget_id`는 지금 적용된 예산의 실제 ID예요.
- `budget_month`가 빈 문자열이면 기본 월 예산, `YYYY-MM`이면 그 달의 덮어쓰기예요. 예산이 없으면 `budget_id`, `budget_month`, `budget`, `remaining`, `pct`가 모두 null이에요.
- 월별 값이 기본값보다 우선하고, 월별 예산을 지우면 기본값이 다시 적용돼요.
- `spent`는 숨기지 않은 지출(환불 차감)이고, 상위 분류는 숨기지 않은 하위 분류 지출까지 합쳐요. 예산도 지출도 없는 분류는 빠져요.

### `PUT /budgets`
본문 `{category_id?: string, month?: string, amount}`. 빈 문자열이거나 생략한 `category_id`는 전체 예산, 빈 문자열이거나 생략한 `month`는 기본 월 예산이에요. 분류는 지출 분류여야 해요(아니면 400 `invalid_category`). 같은 키가 있으면 금액만 바꿔요. 응답 200 `{id, category_id, month, amount}`.

### `DELETE /budgets/:id`
조회 응답의 `budget_id`로 지워요. 없으면 404, 성공하면 `{ok: true}`.

## 반복과 템플릿

TemplatePayload는 `{type, amount?, is_refund?, asset_id?, to_asset_id?, category_id?, merchant?, memo?}`예요.

반복 거래와 템플릿의 생성·수정은 저장할 payload의 참조를 확인해요. null이 아닌 `asset_id`·`to_asset_id`가 없으면 400 `invalid_asset`, `category_id`가 없으면 400 `invalid_category`예요. 거절된 요청은 저장된 내용을 바꾸지 않아요. 생략하거나 null인 참조와 템플릿의 선택 금액은 그대로 허용해요.

### `GET /recurring`
응답 `{items: RecurringRule[]}`(`id, template, freq, interval, start_date, end_date, last_materialized_date, active, created_at, updated_at`).

### `POST /recurring`
본문 `template(TemplatePayload, amount 필수), freq('daily'|'weekly'|'monthly'|'yearly'), start_date`, 선택 `interval`(1~366, 기본 1), `end_date`, `active`(기본 true). 201 `RecurringRule`.

### `PATCH /recurring/:id` / `DELETE /recurring/:id`
`:id`는 UUID예요. PATCH는 일부 수정 후 `RecurringRule`, DELETE는 `{ok: true}`. 이미 만들어진 거래는 남아요. 없으면 404.

### `POST /recurring/run`
선택 본문 `{today?: 'YYYY-MM-DD'}`. 그날까지 밀린 반복 거래를 만들어요. 응답 `{created: number}`.

### `GET /templates`
응답 `{items: Template[]}`(`id, name, payload, sort, use_count, created_at, updated_at`). `sort` 오름차순, `use_count` 내림차순, `created_at`, `id` 순서예요.

### `POST /templates` / `PATCH /templates/:id` / `DELETE /templates/:id`
본문 `name(1~40자), payload, sort?`. 생성은 201 `Template`, 수정은 `Template`, 삭제는 `{ok: true}`. 없으면 404.

### `POST /templates/:id/use`
템플릿으로 거래를 만들어요. 선택 본문으로 `occurred_at, amount, is_refund, currency, foreign_amount, krw_status, asset_id, to_asset_id, category_id, merchant, memo`를 덮어쓸 수 있고, `occurred_at`이 없으면 지금이에요. 201 `Transaction`, `use_count`가 1 늘어요.

## 통계

`/stats/summary`, `/stats/categories`, `/stats/compare`, `/stats/merchants`, `/stats/assets`는 `from`, `to`(필수, 양 끝 포함)를 받아요. 통계는 이체와 삭제된 거래를 빼요. 쿼리 오류는 400 `invalid_request`예요.

| 엔드포인트 | 추가 쿼리 | 응답 |
| --- | --- | --- |
| `GET /stats/summary` | `type`, `include_hidden`(`true|false`) | `{income, expense, net, count}` |
| `GET /stats/categories` | `type`, `include_hidden` | `{total, rows: [{category_id, name, icon, color, amount, pct, children: [...]}]}` |
| `GET /stats/trend` | `months`(1~60, 기본 12), `end`(`YYYY-MM`, 기본 이번 달), `type`, `basis`(`accounting` 기본 또는 `calendar`) | `{buckets: [{month, from, to, income, expense, net}]}`, 선택한 월 기준, `to`는 다음 기간 시작일(미포함) |
| `GET /stats/compare` | `type` | `{range, previous_range, rows: [{category_id, name, current, previous, delta, pct_change}]}`. 직전 같은 길이 기간과 비교해요. 두 범위 모두 `to`를 포함한 날짜예요. `pct_change`는 이전 값이 0이면 null |
| `GET /stats/merchants` | `limit`(1~100, 기본 20) | `{rows: [{merchant, merchant_key, amount, count}]}`, 숨긴 거래 제외 |
| `GET /stats/assets` | 없음 | `{rows: [{asset_id, name, income, expense}]}`, 모든 자산, 숨긴 거래 제외 |
| `GET /stats/calendar` | `month`(`YYYY-MM`, 필수) | `{month, range: {from, to}, days: [{date, income, expense, count}]}`, 달력 월, `range.to`는 다음 달 1일(미포함) |

`trend`, `compare`, `merchants`, `assets`, `calendar`는 `include_hidden`을 받지 않고 숨긴 거래를 항상 빼요.

## 내보내기와 가져오기

### `GET /export`
쿼리 `format`(`csv|xlsx`, 기본 csv)과 `GET /transactions`의 필터(`from`, `to`, `type`, `hidden` 등). 조건에 맞는 거래 전부를 `ledger-YYYYMMDD.csv|xlsx` 첨부 파일로 내려줘요. 기간이 뒤집히면 400 `invalid_range`.

### `POST /import/preview`
`multipart/form-data`의 `file`(CSV 또는 XLSX, 10 MiB까지, 아니면 413). multipart가 아니면 415, 파일이 없거나 깨졌으면 400 `invalid_upload`. 저장하지 않고 다음을 돌려줘요.

```
{
  preview_id,
  detected_format: "ledger" | "money_manager",
  rows: [...],            // 앞 50행, 거래 입력 필드 + row, asset_name, to_asset_name, category_name, subcategory_name, hidden, duplicate
  counts: {total, new, duplicate, error},
  errors: [{row, message}]
}
```

미리보기는 서버 메모리에 15분 동안 남아요.

### `POST /import/commit`
본문 `{preview_id, include_duplicates?}`(기본 false). 한 트랜잭션으로 넣고, 없는 자산과 분류는 이름으로 만들어요. 이미 같은 원본 키로 들어온 행은 항상 건너뛰고, 중복 의심 행(같은 분, 금액, 가맹점 키)은 `include_duplicates`가 true일 때만 넣어요. 응답 `{inserted, skipped}`(`skipped`에 파싱 오류 행도 포함). 미리보기가 없거나 만료면 404 `preview_not_found`.

## 백업

### `GET /backup`
`{version: 1, exported_at, tables: {assets, categories, transactions, merchant_rules, budgets, recurring_rules, templates, settings}}`. 각 표는 데이터베이스 행 그대로예요(불리언은 0/1, JSON 필드는 문자열). 세션, 자격 증명, 멱등성 키, 가져오기 상태는 들어가지 않아요.

### `POST /backup/restore?confirm=REPLACE`
`confirm=REPLACE`가 없으면 400 `invalid_request`. 본문은 `GET /backup` 형식 그대로이고 50 MiB까지예요.

1. 모든 행을 검사해요: 열 이름과 개수가 현재 표와 같아야 하고, 타입, NOT NULL, 0/1 플래그, 정수 범위(`src_amount`만 소수 허용), 그리고 각 도메인 스키마까지 맞아야 해요. 이전 백업의 자산 행에 새 열 `opening_date`만 없으면 null로 복원해요. 새 백업은 날짜를 그대로 보존해요. 다른 누락·추가 열이나 잘못된 날짜는 허용하지 않아요. 하나라도 틀리면 아무것도 바꾸지 않고 400 `invalid_request`예요.
2. 현재 DB를 `data/backups/pre-restore-<uuid>.sqlite`로 스냅숏해요.
3. 한 트랜잭션 안에서 8개 표를 비우고 다시 채우고, 멱등성 키와 가져오기 상태를 지워요. 제약 조건 위반이면 롤백하고 400 `invalid_request`예요.

응답 `{ok: true}`.

## 설정

### `GET /settings`
응답 `{month_start_day, owner_name, theme, default_asset_id}`. 저장값이 없으면 기본값 `{1, "", "system", null}`이에요.

### `PATCH /settings`
위 필드의 일부. `month_start_day`는 1~28, `owner_name`은 40자까지, `theme`은 `system|light|dark`. 없는 `default_asset_id`는 400 `invalid_input`이에요. 저장은 한 트랜잭션이고, `owner_name`이 바뀌면 같은 트랜잭션 안에서 카카오뱅크 거래를 다시 분류해요(사용자가 잠근 필드는 빼고). 응답은 전체 설정이에요.

## 동기화(카카오뱅크)

카카오뱅크 내역은 계좌마다 `카카오뱅크 입출금 (끝자리)` 자산 하나로 들어와요. 체크카드 결제와 해외결제도 별도 카드 자산을 만들지 않고 그 계좌에 기록해요. 스키마 3 마이그레이션은 이전 가져오기가 만든 체크카드 자산(`external_ref`가 `kakaobank-checkcard:`로 시작)의 거래, 즐겨찾기·반복 기록의 자산 참조, 기본 자산 설정을 연결 계좌로 옮기고 그 카드 자산을 지워요. 체크카드 잔액은 원래 연결 계좌로 계산했으므로 잔액과 통계는 바뀌지 않아요. 직접 만든 체크카드와, 카드와 그 연결 계좌 사이의 이체가 있는 카드는 그대로 두어요.

### `GET /sync/status`
응답 `{last_run_at, last_result, last_error, next_run_at}`, 기록이 없으면 각각 null. `last_result`는 마지막 실행 결과(아래 형태), `last_error`는 `"import_failed"` 또는 null이에요.

### `POST /sync/run`
즉시 한 번 가져와요. 응답 `{inserted, merged, skipped, hidden, errors: string[]}`. 이미 실행 중이면 409를 내지 않고 그 실행이 끝나기를 기다려 같은 결과를 돌려줘요. 원본 모듈이 실패하면 숫자는 모두 0이고 `errors: ["import_failed"]`인 200 응답이에요. 가져오기 모듈이 연결되지 않은 앱에서는 503 `not_available`이에요.
