import { defineMessages } from "../../i18n";

export const loginMessages = defineMessages(
  {
    networkFailed: "서버에 연결할 수 없어요. 네트워크를 확인해 주세요",
    invalidToken: "토큰이 맞지 않아요",
    tooManyAttempts: "시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요",
    forbiddenAddress: "허용되지 않은 주소에서 접속했어요",
    loginFailed: "로그인하지 못했어요. 다시 시도해 주세요",
    enterToken: "접근 토큰을 입력해 주세요",
    firstVisit: "이 기기에서 처음 열었어요. 접근 토큰을 붙여 넣어 주세요.",
    accessToken: "접근 토큰",
    tokenHint: "토큰은 서버 데이터 폴더의 credentials.json에 있어요.",
    signIn: "로그인",
  },
  {
    networkFailed: "Can't connect to the server. Check your network.",
    invalidToken: "Invalid token",
    tooManyAttempts: "Too many attempts. Try again in a minute.",
    forbiddenAddress: "Access isn't allowed from this address",
    loginFailed: "Couldn't sign in. Try again.",
    enterToken: "Enter your access token",
    firstVisit: "First time on this device? Paste your access token to sign in.",
    accessToken: "Access token",
    tokenHint: "Find your token in credentials.json in the server's data folder.",
    signIn: "Sign in",
  },
);
