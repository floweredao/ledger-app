import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, isApiError, isNetworkError } from "../../api/client";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Field";
import { OfflineBanner } from "../../components/OfflineBanner";

type Props = {
  readonly offline: boolean;
  readonly onLoggedIn: () => void;
};

function messageFor(error: unknown): string {
  if (isNetworkError(error)) return "서버에 연결할 수 없어요. 네트워크를 확인해 주세요";
  if (isApiError(error) && error.status === 401) return "토큰이 맞지 않아요";
  if (isApiError(error) && error.status === 429) return "시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요";
  if (isApiError(error) && error.status === 403) return "허용되지 않은 주소에서 접속했어요";
  return "로그인하지 못했어요. 다시 시도해 주세요";
}

export default function LoginScreen({ offline, onLoggedIn }: Props) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.trim() === "") {
      setError("접근 토큰을 입력해 주세요");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(token.trim());
      if (session.authenticated) {
        setToken("");
        onLoggedIn();
      } else setError("토큰이 맞지 않아요");
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login" id="main">
      {offline ? <OfflineBanner /> : null}
      <form className="login-card" onSubmit={submit} noValidate>
        <span className="login-mark" aria-hidden="true">
          <KeyRound size={24} strokeWidth={2} />
        </span>
        <h1 className="screen-title">가계부</h1>
        <p className="login-lead">이 기기에서 처음 열었어요. 접근 토큰을 붙여 넣어 주세요.</p>
        <Field label="접근 토큰" hint="토큰은 서버 데이터 폴더의 credentials.json에 있어요." error={error}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" block disabled={busy}>
          로그인
        </Button>
      </form>
    </main>
  );
}
