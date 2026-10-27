import { afterEach, describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import {
  defineMessages,
  getLanguagePreference,
  getLocale,
  LANGUAGE_STORAGE_KEY,
  pickLocale,
  setLanguagePreference,
  setLocale,
  useMessages,
} from ".";
import { compactWon, formatDisplayDate, formatMonth, formatSigned, formatWon } from "./format";

afterEach(() => {
  setLanguagePreference("system");
  setLocale("ko");
});

describe("language preference", () => {
  test("a chosen language wins over system language changes and is kept on the device", () => {
    setLanguagePreference("ko");
    expect(getLocale()).toBe("ko");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ko");
    window.dispatchEvent(new Event("languagechange"));
    expect(getLocale()).toBe("ko");
    setLanguagePreference("en");
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
  test("system follows the browser language again and clears the device copy", () => {
    setLanguagePreference("ko");
    setLanguagePreference("system");
    expect(getLanguagePreference()).toBe("system");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(getLocale()).toBe(pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language]));
  });
});

describe("pickLocale", () => {
  test("follows the first supported system language", () => {
    expect(pickLocale(["ko-KR", "en-US"])).toBe("ko");
    expect(pickLocale(["en-GB", "ko"])).toBe("en");
    expect(pickLocale(["ja-JP", "ko-KR"])).toBe("ko");
  });
  test("falls back to English when no product language matches", () => {
    expect(pickLocale(["ja-JP", "fr"])).toBe("en");
    expect(pickLocale([])).toBe("en");
  });
});

describe("formatters use the product language", () => {
  test("Korean", () => {
    expect(formatWon(-1234567)).toBe("-1,234,567원");
    expect(formatSigned("expense", 12345)).toBe("-12,345원");
    expect(compactWon(12_000)).toBe("1.2만");
    expect(formatMonth("2026-10")).toBe("2026년 10월");
    expect(formatDisplayDate("2025-03-04")).toBe("2025년 3월 4일");
  });
  test("English", () => {
    setLocale("en");
    expect(formatWon(-1234567)).toBe("-₩1,234,567");
    expect(formatWon(0)).toBe("₩0");
    expect(formatSigned("income", 12345)).toBe("+₩12,345");
    expect(compactWon(3_500_000)).toBe("3.5M");
    expect(formatMonth("2026-10")).toBe("October 2026");
    expect(formatDisplayDate("2025-03-04")).toBe("Mar 4, 2025");
  });
});

test("components re-render when the language changes and html lang follows", () => {
  const catalog = defineMessages(
    { hello: "안녕하세요", count: (n: number) => `${n}건` },
    { hello: "Hello", count: (n: number) => `${n} items` },
  );
  function Probe() {
    const m = useMessages(catalog);
    return <p>{`${m.hello} ${m.count(2)}`}</p>;
  }
  render(<Probe />);
  expect(screen.getByText("안녕하세요 2건")).toBeTruthy();
  act(() => setLocale("en"));
  expect(getLocale()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByText("Hello 2 items")).toBeTruthy();
});
