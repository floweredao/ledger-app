import { useSyncExternalStore } from "react";

/** Product languages. By default the app follows the system language: Korean when it prefers Korean, otherwise English. */
export type Locale = "ko" | "en";
/** The language the owner chose in preferences: a fixed product language, or the system language. */
export type LanguagePreference = "system" | Locale;

/** Device copy of the saved language preference so the first paint uses it before settings load. */
export const LANGUAGE_STORAGE_KEY = "ledger:language";

/** Intl tags for each product language; all number and date formatting goes through these. */
export const INTL_TAG: Readonly<Record<Locale, string>> = { ko: "ko-KR", en: "en-US" };

/** First supported language in the user's preference order; English when none matches. */
export function pickLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "ko" || base === "en") return base;
  }
  return "en";
}

function systemLocale(): Locale {
  if (typeof navigator === "undefined") return "ko";
  return pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

function storedPreference(): LanguagePreference {
  try {
    const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "ko" || stored === "en" ? stored : "system";
  } catch {
    return "system";
  }
}

let preference: LanguagePreference = storedPreference();
let current: Locale = preference === "system" ? systemLocale() : preference;
const listeners = new Set<() => void>();

function apply(locale: Locale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
apply(current);

export const getLocale = (): Locale => current;

/** Switches the product language (system language changes and tests); re-renders every `useMessages` user. */
export function setLocale(locale: Locale): void {
  apply(locale);
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

export const getLanguagePreference = (): LanguagePreference => preference;

/** Applies the owner's language choice and keeps a device copy for the next first paint. */
export function setLanguagePreference(next: LanguagePreference): void {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    console.warn("language_preference_not_persisted");
  }
  setLocale(next === "system" ? systemLocale() : next);
}

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preference === "system") setLocale(systemLocale());
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/**
 * A message catalog: the Korean source and an English copy with exactly the same keys and signatures.
 * Values are strings, or functions for copy that takes values (counts, names, amounts).
 */
type Message = string | ((...args: never[]) => string);
export type Catalog<T extends Record<string, Message>> = { readonly ko: T; readonly en: { [K in keyof T]: T[K] } };

export function defineMessages<T extends Record<string, Message>>(ko: T, en: { [K in keyof T]: T[K] }): Catalog<T> {
  return { ko, en };
}

/** Current-language messages for non-React code (toasts from the outbox, formatters). */
export const messages = <T extends Record<string, Message>>(catalog: Catalog<T>): T => catalog[current] as T;

/** Current-language messages; the component re-renders when the system language changes. */
export function useMessages<T extends Record<string, Message>>(catalog: Catalog<T>): T {
  return catalog[useLocale()] as T;
}
