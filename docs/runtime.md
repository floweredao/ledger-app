# 런타임

## 포트

| 포트 | 용도 |
| --- | --- |
| `127.0.0.1:4340` | 앱 서버(API + 정적 파일) |
| `127.0.0.1:4341` | Vite 개발 서버, `/api`를 4340으로 프록시 |
| Tailscale Serve `https:4340` | tailnet 전용, `http://127.0.0.1:4340`으로 전달 |
| `4339` | install.sh의 launchd 사전 점검용 임시 포트 |
| `4351`~`4383` | QA 레인 전용(레인마다 자기 포트, 공유하지 않음) |
| `4389` | 운영 준비 번들의 격리 smoke 검증 전용 |

## 신뢰 경계

서버는 루프백에만 바인딩해요. 밖에서 들어오는 길은 Tailscale Serve `https:4340` 하나이고, tailnet 안의 기기만 닿아요. Funnel은 쓰지 않아요.

인증은 쿠키 세션(`ledger_session`, HttpOnly, SameSite=Strict, Serve Host에서는 Secure)이에요. 세션을 만드는 방법은 두 가지예요.

- `data/credentials.json`의 `owner_token`으로 `POST /api/v1/auth/session`
- Serve를 거친 요청에서 Host가 `LEDGER_TAILSCALE_HOST`와 같고 `Tailscale-User-Login`이 `LEDGER_TAILSCALE_LOGIN`과 정확히 같으며 Authorization 헤더가 없으면 `GET /api/v1/auth/session`이 세션을 자동으로 만들어요. Serve가 이 헤더를 붙이고, 루프백으로 직접 온 요청은 Host가 달라서 자동 로그인이 안 돼요.

변경 요청은 허용된 `Origin`과 `X-CSRF-Token`이 있어야 해요.

## 런타임 배치

LaunchAgent는 `~/Documents` 아래에서 작업 디렉터리를 열다 멈출 수 있어서 런타임을 저장소 밖에 둬요.

```
~/Library/Application Support/ledger-app/
  server.js        # bun build로 묶은 서버
  dist/            # 빌드된 클라이언트
  previous/        # 직전 코드 한 개(server.js, dist); DB 백업이 아니에요
  serve-4340.owned # 설치기가 새로 만든 Serve 매핑의 소유권 표시
  data/            # 운영 데이터(ledger.sqlite, credentials.json, 백업)
    logs/
      server.log
      server-error.log
~/Library/LaunchAgents/local.ledger-app.plist
<repo>/data -> ~/Library/Application Support/ledger-app/data
```

LaunchAgent 라벨은 `local.ledger-app`이고 RunAtLoad, KeepAlive가 켜져 있어요.

템플릿은 `ops/local.ledger-app.plist.template`이에요. 설치할 때 `command -v bun`의 절대 경로와 런타임 경로를 넣어요. `LEDGER_HOST=127.0.0.1`, `LEDGER_PORT=4340`, `LEDGER_DATA_DIR=$RT/data`, `LEDGER_STATIC_DIR=$RT/dist`를 명시해요. 원본 모듈과 감시 경로는 각각 `~/.local/share/ddolmeng-mode/bin/ledger.ts`, `~/.local/share/ddolmeng-mode/state/ledger`이고 읽기만 해요.

Tailscale `Self.DNSName`의 마지막 점을 제거하고 `Self.UserID`에 해당하는 `User.LoginName`을 비공개로 plist에 넣어요. 모든 동적 XML 값은 escape해요. 설치된 plist는 로그인 식별자를 포함하므로 0600, 런타임/data/logs 디렉터리는 0700으로 둬요. 템플릿에는 실제 로그인이나 토큰을 넣지 않아요.

## 설치와 갱신

의존성을 준비하고 Mac에서 Tailscale에 로그인한 뒤 저장소 루트에서 실행해요.

```sh
bun install --frozen-lockfile
bash ops/install.sh --dry-run
bash ops/install.sh
bash ops/update.sh
```

dry-run은 계획 출력이에요. 빌드, 서버 기동, LaunchAgent 검증을 하지 않아요. install/update는 `heavy bun run build` 후 `heavy bun build server/index.ts --target bun --outfile <런타임의 임시 stage>/server.js`를 실행해요. 빌드 실패 시 현재 서버는 그대로 있어요. stage에서 합성 모듈·데이터와 4339로 사전 점검하고, 준비 로그를 구독한 뒤 실제 health 200을 확인해요. 격리 서버와 임시 데이터를 정리한 후 운영 코드를 복사해요. 운영 데이터는 복사하지 않아요.

재설치는 자기 라벨이 로드돼 있으면 bootout하고 logs를 미리 만든 뒤 bootstrap해요. update도 코드 교체 동안 자기 agent만 중지하고 bootstrap해요. 시작 로그를 변경 전부터 구독하고 새 준비 로그 및 health를 확인해요(준비 제한 10초, HTTP 제한 5초). 실패하면 로그를 살펴보고 아래 되돌리기를 실행해요. 성공한 install만 현재 DNS 이름의 URL을 반환해요. 다른 앱이나 원본 ledger 수집 프로세스는 재시작하지 않아요.

4340에 Serve 항목이 없을 때만 `tailscale serve --bg --https=4340 http://127.0.0.1:4340`을 추가해요. 정확히 같은 루트 Proxy가 이미 있으면 유지하며 소유하지 않아요. 다른 Proxy, 경로, TCP 전달, Funnel 설정은 충돌로 거부해요. 제거는 소유권 표시가 있고 현재 매핑도 일치할 때만 `tailscale serve --https=4340 off`를 실행해요. 다른 포트는 변경하지 않고 reset/Funnel은 쓰지 않아요.

저장소 data가 없거나 비어 있을 때만 링크를 만들어요. 데이터가 있거나 다른 링크이면 설치가 중단돼요. 수동 이전은 서버를 중지하고 비공개 백업을 만든 다음 운영 데이터와 병합 여부를 판단해야 해요. 설치기가 어느 쪽도 덮어쓰지 않아요.

## 백업과 되돌리기

백업 경로는 Documents 밖의 본인 전용 디렉터리로 정해요. 일관된 SQLite 백업을 위해 자기 서버를 멈춘 상태에서 data 전체를 복사해요. 명령은 운영 담당자가 직접 실행해요.

```sh
RT="$HOME/Library/Application Support/ledger-app"
BACKUP="$HOME/Library/Application Support/ledger-app-backups/$(date +%Y%m%d-%H%M%S)"
umask 077
launchctl bootout "gui/$(id -u)/local.ledger-app"
mkdir -p "$BACKUP"
cp -R "$RT/data" "$BACKUP/data"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.ledger-app.plist"
bash ops/update.sh
# 코드만 직전 버전으로:
bash ops/update.sh --rollback
```

`previous/`는 직전 코드 한 개만 보관해요. 다음 install/update는 더 오래된 코드를 대체해요. 최초 설치에는 이전 버전이 없어요. DB 호환성이 바뀌었다면 코드만 되돌리지 말고, 자기 agent를 중지한 뒤 현재 data를 별도 비공개 경로로 옮기고 백업을 복원해요. 백업 이후 거래는 복원 DB에 없으므로 먼저 보존 여부를 판단해요.

```sh
launchctl bootout "gui/$(id -u)/local.ledger-app"
mv "$RT/data" "$RT/data-before-restore-$(date +%Y%m%d-%H%M%S)"
cp -R "$BACKUP/data" "$RT/data"
chmod 700 "$RT/data"
cp "$RT/previous/server.js" "$RT/server.js"
rm -rf "$RT/dist" # 자기 런타임의 클라이언트 코드만
cp -R "$RT/previous/dist" "$RT/dist"
mkdir -p "$RT/data/logs"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.ledger-app.plist"
curl --fail http://127.0.0.1:4340/api/v1/health
```

## 제거와 폰 설치

`bash ops/uninstall.sh`는 자기 라벨/plist/코드와 소유한 Serve 4340만 제거하고 data와 저장소 링크는 보존해요. `--purge`는 `LEDGER_CONFIRM_PURGE='DELETE ledger-app data'`를 명시했을 때만 data와 자기 링크를 지워요. 비공개 백업을 확인한 운영 담당자만 실행하고 QA에서는 실행하지 않아요.

iPhone/iPad에서 Tailscale을 연결하고 Safari로 설치 출력 URL을 연 뒤 **공유 → 홈 화면에 추가**를 선택해요. 본인 Tailscale 계정의 자동 인증이 실패하면 Mac의 `$RT/data/credentials.json`을 비공개로 열고 `owner_token`을 로그인 화면에 한 번 붙여 넣어요. 토큰 값을 출력하거나 보고에 담지 않아요. Mac은 Safari의 파일 → Dock에 추가 또는 Chrome 설치 버튼을 써요.

## 로그

`~/Library/Application Support/ledger-app/data/logs/server.log`와 `server-error.log`에 남아요. 서버는 요청 본문이나 토큰을 기록하지 않아요.

## 재시작과 상태 확인

```sh
launchctl kickstart -k gui/$(id -u)/local.ledger-app   # 재시작
launchctl print gui/$(id -u)/local.ledger-app          # 상태
curl -s http://127.0.0.1:4340/api/v1/health            # {"ok":true,"version":"0.0.x"}
tailscale serve status                                 # https:4340 항목 확인
bash ops/update.sh                                     # 코드 갱신 후 재시작
```
