# ledger-app 에이전트 지침

## 프로젝트

개인용 한국어 가계부 PWA예요. 서버는 Bun + Hono + bun:sqlite, 클라이언트는 React + Vite예요.

- UI를 바꾸기 전에 `DESIGN.md`를 먼저 읽어요.
- API나 데이터 동작을 바꾸기 전에 `docs/API.md`를 먼저 읽어요. 엔드포인트를 추가하거나 바꾸면 같은 변경에서 문서도 고쳐요.
- 레이아웃, 모션, 인터랙션, 플랫폼 관례를 정할 때는 StyleGallery를 참고해요. 위치는 `$(npm root -g)/stylegallery`이고 `README.md`부터 읽어요. CLI는 `stylegallery`, `stylegallery-material`이에요. 프로젝트 디자인 시스템(`DESIGN.md`)과 오너의 명시적 선택이 우선이에요.
- 런타임과 포트는 `docs/runtime.md`에 있어요.
- 한국어 문서 이름은 README-ko.md로 통일한다.

## 검증

```sh
bun test
bunx tsc --noEmit
bunx biome check .
bun run build
```

이 Mac에서는 전체 테스트와 빌드를 반드시 `heavy`로 감싸서 돌려요: `heavy bun test`, `heavy bun run build`. heavy는 모든 에이전트 세션을 통틀어 무거운 작업을 최대 2개까지만 동시에 돌리고, Mac이 과부하일 때는 기다려요. 기다림은 정상이에요. 우회하지 마세요. 파일 하나 테스트나 타입 검사처럼 짧은 일은 그냥 돌려도 돼요. 슬롯 사용 현황은 `heavy --status`, 기록은 `~/.local/state/heavy/heavy.log`에 있어요.

리눅스에서 테스트를 돌리고 싶으면 GCP 빌드 VM을 써도 돼요: `gcprun . 'bun install --frozen-lockfile && bun test'` (사용법: `~/.local/share/mac-offload/README.md`).

## 하지 말아야 할 것

- `data/`는 절대 커밋하지 않아요.
- 자격 증명을 출력하지 않아요. `data/credentials.json`의 `owner_token`을 로그, 리포트, 채팅, QA 증거에 옮기지 않아요.
- 다른 Tailscale Serve 포트나 항목을 바꾸지 않아요. `tailscale funnel`, `tailscale serve reset`은 쓰지 않아요. 이 앱이 쓰는 건 `https:4340` 하나뿐이에요.
- `~/.local/share/ddolmeng-mode/bin/ledger.ts`와 `~/.local/share/ddolmeng-mode/state/ledger/*`는 읽기만 하고 고치지 않아요.
- 서버는 루프백(`127.0.0.1`, `localhost`, `::1`)에만 바인딩해요. 다른 주소로 노출하지 않아요.
- `package.json` 버전은 오너가 승인할 때까지 `0.0.x`로 둬요.
- 테스트와 픽스처는 합성 데이터만 써요(예: "테스트마트", "샘플카페", "홍길동"). 실제 이름, 계좌번호, 거래 내역은 넣지 않아요.
- 런타임은 `~/Library/Application Support/ledger-app`에 있어요. LaunchAgent는 `~/Documents` 아래에서 작업 디렉터리를 열다 멈추기 때문에, 런타임 파일을 저장소 안으로 옮기지 않아요.
- GitHub Actions 워크플로를 추가하지 않아요.

## 테스트 원칙

동작 변경은 구현 전에 실패하는 회귀 테스트로 먼저 보여 주고, 구현 뒤에는 실제 표면(HTTP, 브라우저)으로 확인해요. 파괴적인 테스트는 임시 데이터 디렉터리(`LEDGER_DATA_DIR=$(mktemp -d)`)에서만 돌려요.
