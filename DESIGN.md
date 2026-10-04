# ledger-app design system

이 문서는 가계부 UI의 공통 계약이에요. 색·크기·간격은 `src/styles/tokens.css`에서 정의하고, 컴포넌트는 그 토큰을 사용해요. 오너의 명시적 선택과 AGENTS.md가 이 문서보다 우선해요.

## References

- StyleGallery: `platform-guides/adaptive-navigation.md`, `input-and-focus.md`, `apple-interaction.md`, `recipes/list-detail.md`, `recipes/form-flow.md`를 읽었어요. 화면 크기가 바뀌어도 선택·입력 초안을 유지하고, 스크롤·포커스·닫기의 책임을 분명히 하는 원칙을 적용해요.
- `appllama-app-design-skill`의 단일 강조색, 일관된 모서리, 전체 상태 구현, 사용 빈도에 따른 모션 원칙을 참고했어요.
- 기능 참고: [편한가계부](https://apps.apple.com/kr/app/id560481810), [Realbyte](https://www.realbyteapps.com/), [Money Lover](https://moneylover.me/), [YNAB](https://www.ynab.com/features), [Monarch](https://www.monarch.com/).
- Toss와 Banksalad를 포함한 조사에서 얻은 기능·탐색 패턴을 참고하되, 특정 앱의 화면을 복제하지 않아요. 구체적인 화면 배치는 이 앱의 설계 결정이며 경쟁 앱에서 검증한 사실로 표현하지 않아요.
- Appllama MCP 인증이 완료되지 않아 실제 화면을 조회하지 못했어요. Appllama 화면을 검토했다는 주장은 하지 않아요.
- 웹은 네이티브 시트·햅틱을 그대로 제공하지 않아요. 웹의 키보드, 포커스, 포인터, safe-area 동작으로 구현하고 실제 검증 범위를 별도로 기록해요.

## IA

| 목적지 | 경로 | 기간 |
| --- | --- | --- |
| 가계부 일일 | `/?month=YYYY-MM` | 달력 월 |
| 가계부 달력 | `/calendar?month=YYYY-MM` | 달력 월 |
| 가계부 월별 | `/monthly?year=YYYY` | 달력 연도 |
| 검색 | `/search` + API와 같은 필터 이름 | 시작일·종료일 포함 |
| 통계 | `/stats?period=month|week|year|custom&from&to` | 월 시작일을 적용한 회계 월 |
| 예산 | `/budget` | 회계 월 |
| 자산 | `/assets`, `/assets/:id` | 잔액과 카드 이용기간 |
| 설정 | `/settings`와 하위 경로 | 분류·반복·데이터·환경 |

월 시작일이 1일이 아니면 예산·통계 제목 아래에 실제 날짜 범위를 표시해요. 가계부 달력과 같은 범위인 것처럼 보이면 안 돼요.

- 900px 미만: 상단바와 하단 메뉴 `가계부 / 통계 / + / 자산 / 설정`을 사용해요. `+`는 탭이 아니라 기록하기 명령이며 활성 탭으로 표시하지 않아요.
- 900px 이상: 240px 사이드바와 기록하기 버튼을 사용해요. 바닥 탭바는 표시하지 않아요.
- 기본 내용 최대 폭은 720px이에요. 충분한 내용 영역에서는 1080px 한도 안에서 달력/일별 상세, 차트/분류 목록을 두 열로 배치해요.
- 390×844, 820×1180, 1440×900에서 같은 목적지와 기능을 제공해요. 화면 크기 변경은 새 이력 항목을 만들거나 초안을 초기화하지 않아요.
- 월 변경은 URL의 `month`를 replace해요. 일반 탐색은 브라우저 이력을 따르고, Esc·닫기·배경 클릭은 최상단 임시 화면만 닫아요.

## Typography

- 시스템 글꼴: `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", sans-serif`. 외부 폰트를 다운로드하지 않아요.
- 크기: display 32px, xl 22px, lg 18px, md 16px, sm 14px, xs 12px의 rem 토큰을 사용해요.
- 한 화면에서 큰 대표 숫자는 하나예요. 금액·날짜·비율은 `.num`의 tabular numerals를 사용해요.
- 금액은 행에서 생략하지 않아요. 긴 상호는 한 줄 말줄임으로 표시하고 편집 화면에서 전체를 보여줘요.
- 입력 글자는 최소 16px로 유지해 iOS 입력 확대를 방지해요. 한국어 IME 조합 중 Enter는 저장하지 않아요.

## Color

| 역할 | 밝은 테마 | 어두운 테마 |
| --- | --- | --- |
| 배경 | `#f7f8fa` | `#0f1115` |
| 표면 / 보조 표면 | `#ffffff` / `#edf0f4` | `#161a21` / `#1f242d` |
| 본문 / 보조 / 메타 | `#141a24` / `#48515b` / `#606a74` | `#eef1f5` / `#a8b2be` / `#86909b` |
| 강조 / 강조 위 글자 | `#2769c6` / `#ffffff` | `#70a6f5` / `#0f1115` |
| 입력 경계 | `#7d8691` | `#6b7581` |
| 환불 | `#03765e` | `#4ebb9d` |
| 위험 | `#c52b30` | `#f47a79` |
| 경고 | `#955b02` | `#e8ab3e` |

강조색은 파랑 하나, 중립색은 차가운 회색 계열 하나로 고정해요. 수입은 강조색과 `+`, 지출은 본문색과 `-`, 환불은 환불색과 `+` 및 환불 표기를 함께 사용해요. 이체는 방향과 이체 라벨을 표시하고 수입·지출로 표현하지 않아요.

`--cat-1`부터 `--cat-12`는 분류 이름이 아닌 색상 슬롯이에요. DB의 `cat-N`을 CSS 변수로 바꾸고 하위 분류는 부모 색을 이어받아요. 아이콘 원·차트·범례의 채움에만 사용하고 글자색으로 사용하지 않아요. 아이콘은 흰 glyph를 사용해요. 동일한 색이 재사용돼도 이름·금액·범례를 생략하지 않아요.

`data-theme`는 html에만 설정해요. 속성이 없으면 시스템 설정, light/dark는 명시적 선택이에요. 두 dark 선언 블록의 값은 같아야 해요.

밝은 테마에서 강조색 글자를 accent-soft 위에 올릴 때는 surface 위에서만 사용해요. bg 위의 옅은 강조 배경에는 본문색을 사용해요. 위험 버튼도 어두운 테마에서 흰 글자를 위험색 위에 두지 않고 danger-soft와 danger를 조합해요.

## Spacing & Radius

- 간격은 4px 배수예요. 페이지·카드 안쪽 16px, 섹션 간 24px을 기본으로 해요.
- 행동 버튼·칩·진행 막대·아이콘 원은 `--radius-pill`, 카드·시트·대화상자는 16px, 입력·키패드 타일은 10px이에요.
- 터치 영역은 최소 44×44px, 목록 행은 최소 56px, 키패드 키는 52px이에요. 시각적으로 작은 칩도 터치 영역을 확장해요.
- 좌우 여백은 `max(16px, safe-area-inset-left/right)`를 적용해요.

## Elevation

페이지는 bg, 카드와 바는 surface, 입력 보조 표면은 surface-2예요. 선택 pill은 shadow-1, 팝오버·toast·dialog는 shadow-2, 바닥 시트는 shadow-sheet를 사용해요.

sticky 10, tabbar 20, overlay 30, toast 40의 z-index 순서를 유지해요. 어두운 테마는 그림자보다 표면 명도 차이로 층을 구분해요. 장식용 blur·gradient·glass는 사용하지 않아요.

## Motion

- 탭·라우트·기간 전환은 즉시 바꿔요. 숫자 count-up이나 차트 성장 애니메이션은 넣지 않아요.
- 버튼 눌림은 최대 120ms, 시트 열기는 240ms, 닫기는 200ms, 대화상자는 160ms예요.
- 위치 모션은 transform과 opacity만 사용해요. 리스트 행은 크기 대신 배경 변화로 반응해요.
- 시트 드래그에는 닫기 버튼과 Esc 대안이 있어야 해요. 움직이는 도중에도 사용자가 닫거나 방향을 바꿀 수 있어야 해요.
- reduced-motion에서는 이동을 없애요. JS 애니메이션도 미디어 쿼리를 확인해요. 반복되는 숫자·차트의 움직임은 없어요.

## Components

- AppShell: main과 내비게이션, 오프라인 배너, PendingBadge, toast 영역을 소유해요. 기본 문서 스크롤은 하나예요.
- TabBar/Sidebar: 활성 위치는 색 외에 굵기·배경과 `aria-current`로 표시해요. 기록하기는 명령 버튼이에요.
- Sheet/Dialog: 같은 폼 인스턴스로 모바일 시트와 큰 화면 대화상자를 바꿔요. 포커스 진입·가둠·복귀와 Esc를 지원해요. 작성 중인 초안은 확인 없이 버리지 않아요.
- 시트는 `100dvh`를 사용하고 `max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)`을 키보드 inset으로 적용해요. 내부 스크롤과 고정 저장 영역이 입력·오류 메시지를 가리지 않아야 해요.
- 시트 본문은 세로 축만 스크롤해요. 가로 축과 가로 overscroll은 허용하지 않고, 입력·필드의 최소 폭을 0으로 제한해 좁은 컨테이너에 맞춰요. 문서 overflow를 숨기는 방식 대신 320·375·390px의 문서·시트·자식 요소 폭을 실제 브라우저 회귀로 검사해요.
- ConfirmDialog: 안전한 선택을 처음 포커스해요. 삭제와 취소의 의미를 구분해요.
- SegmentedControl: 화면 탐색에는 링크, 값 선택에는 radio group을 사용해요.
- Chip: 선택 상태는 check 또는 형태 차이와 `aria-pressed`로 구분해요. 필터 해제 버튼에 구체적인 접근성 이름을 붙여요.
- ListRow: 분류 아이콘, 상호, 메모·자산 보조 행, 오른쪽 금액 순서예요. 자동·숨김·동기화 대기·원화 미확정은 읽을 수 있는 표기가 있어야 해요.
- AmountText: 공유 포맷 함수를 쓰고 수입·지출·환불·이체를 스크린리더 이름으로도 구분해요.
- CategoryIcon: 36px solid 분류색 원과 흰 lucide glyph를 사용해요. 이름이 따로 있으면 장식으로 처리해요.
- MonthSwitcher/PeriodPicker: 44px 이전·다음 버튼과 실제 날짜 범위, 사용자 정의 기간 오류를 제공해요.
- Keypad: 1~9, 00, 0, 지우기예요. 내용·메모를 입력할 때 접어서 OS 키보드와 중첩되지 않게 해요.
- Calendar: 7열, 일요일 시작이에요. 날짜·수입·지출 부호를 표시하고 방향키 이동과 날짜별 기록하기를 제공해요.
- Donut/Bars: 텍스트 요약, 이름·금액·비율 범례를 제공해요. 차트만이 상세 거래로 들어가는 유일한 경로여서는 안 돼요.
- ProgressBar: 초과 상태는 빨강만 쓰지 않고 `N원 초과했어요`를 표시해요.
- Field/Input/Select: 별도 label, 입력 경계 border-input, 오류 설명과 `aria-invalid`를 제공해요.
- Button/IconButton: 역할별 토큰을 사용해요. disabled는 실제 disabled 상태로 설정해요.
- Toast: `role=status`, 실행 취소는 6초 동안 표시하고 포커스·hover 중에는 유지해요. 탭바 위 또는 큰 화면 하단 중앙에 표시해요.
- EmptyState/Skeleton: 아래의 전체 상태 계약을 따라요.

라벨은 저장, 삭제, 실행 취소, 취소, 기록하기, 다시 시도, 지금 동기화, 내보내기로 통일해요.

## States

모든 데이터 화면에 loading, empty, error, offline, pending 상태가 있어야 해요. skeleton은 최종 레이아웃과 같은 형태로 만들고 부분 갱신 때문에 전체 화면을 가리지 않아요.

빈 화면에는 `이번 달 기록이 없어요`와 기록하기처럼 다음 행동을 함께 표시해요. 검색 결과가 없으면 필터 초기화를 제공해요. NaN·undefined를 사용자에게 출력하지 않아요.

실패 메시지는 해당 필드나 영역 가까이에 표시해요. 네트워크 오류를 인증 실패로 오해해 로그인 화면으로 보내지 않아요. 오프라인에서는 마지막 저장 데이터를 보여주고 대기 건수를 표시해요.

은행 잔액 차이, 예산 초과, 원화 미확정은 숫자와 설명을 함께 제공해요. 서버에 저장되지 않은 작업을 저장 완료로 표시하지 않아요.

## Accessibility

`lang=ko`, 하나의 main과 화면 h1, 이름 붙은 nav, 논리적인 DOM·Tab 순서를 유지해요. 입력 label과 오류 연결을 지키고, 차트의 내용을 텍스트로도 읽을 수 있게 해요.

일반 글자는 배경 대비 4.5:1 이상, 입력 경계와 아이콘은 3:1 이상을 검증해요. 수작업 계산은 검증 결과로 사용하지 않고 실제 토큰으로 계산한 증거를 남겨요.

200% 글자 확대, 키보드 Tab/Enter/Esc, 44px 터치 영역, reduced-motion, 강한 대비 설정을 확인해요. 고정 바·시트 footer가 포커스를 가리지 않도록 scroll-padding을 적용해요.

safe-area와 336px 키보드 inset을 적용한 화면을 각각 검증해요. 390×844·820×1180·1440×900의 light/dark에서 overflow·잘림·겹침을 확인해요. 실제 iOS 홈 화면 상태바·공유 시트는 데스크톱 에뮬레이션만으로 검증 완료라 하지 않아요.

## Slop pre-flight

UI 변경을 검증할 때 다음을 확인해요.

- 강조색 계열 하나, 중립색 계열 하나.
- 모서리 반경은 세 토큰만 사용.
- chrome의 emoji 아이콘, 장식용 gradient·blur는 없음.
- 같은 행동에는 같은 라벨 사용.
- 숫자는 고정폭 숫자이며 부호와 단위를 표시.
- 색만으로 의미를 전달하는 상태가 없음.
- loading·empty·error·offline 상태가 빠지지 않음.
- 원시 색·폰트·그림자·지속시간을 화면별로 추가하지 않음.
- 화면을 작게 만들거나 키보드를 열어도 선택과 초안이 유지됨.
