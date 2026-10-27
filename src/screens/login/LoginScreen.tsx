import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, isApiError, isNetworkError } from "../../api/client";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Field";
import { OfflineBanner } from "../../components/OfflineBanner";
import { messages, useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { loginMessages } from "./messages";

type Props = {
  readonly offline: boolean;
  readonly onLoggedIn: () => void;
};

function messageFor(error: unknown): string {
  const m = messages(loginMessages);
  if (isNetworkError(error)) return m.networkFailed;
  if (isApiError(error) && error.status === 401) return m.invalidToken;
  if (isApiError(error) && error.status === 429) return m.tooManyAttempts;
  if (isApiError(error) && error.status === 403) return m.forbiddenAddress;
  return m.loginFailed;
}

export default function LoginScreen({ offline, onLoggedIn }: Props) {
  const m = useMessages(loginMessages);
  const c = useMessages(common);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.trim() === "") {
      setError(m.enterToken);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(token.trim());
      if (session.authenticated) {
        setToken("");
        onLoggedIn();
      } else setError(m.invalidToken);
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
        <h1 className="screen-title">{c.appName}</h1>
        <p className="login-lead">{m.firstVisit}</p>
        <Field label={m.accessToken} hint={m.tokenHint} error={error}>
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
          {m.signIn}
        </Button>
      </form>
    </main>
  );
}
