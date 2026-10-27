import { type ComponentProps, type MouseEvent, useCallback, useMemo, useSyncExternalStore } from "react";
import { daysInMonth, kstDate, kstMonth } from "../shared/dates";
import { type Section, sectionOf } from "./components/nav";

export type RouteName =
  | "ledger"
  | "calendar"
  | "monthly"
  | "search"
  | "stats"
  | "budget"
  | "assets"
  | "asset-detail"
  | "settings"
  | "settings-categories"
  | "settings-rules"
  | "settings-recurring"
  | "settings-templates"
  | "settings-data"
  | "settings-preferences"
  | "not-found";

export type Route = {
  readonly name: RouteName;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
};

const ROUTES: readonly (readonly [pattern: string, name: RouteName])[] = [
  ["/", "ledger"],
  ["/calendar", "calendar"],
  ["/monthly", "monthly"],
  ["/search", "search"],
  ["/stats", "stats"],
  ["/budget", "budget"],
  ["/assets", "assets"],
  ["/assets/:id", "asset-detail"],
  ["/settings", "settings"],
  ["/settings/categories", "settings-categories"],
  ["/settings/rules", "settings-rules"],
  ["/settings/recurring", "settings-recurring"],
  ["/settings/templates", "settings-templates"],
  ["/settings/data", "settings-data"],
  ["/settings/preferences", "settings-preferences"],
];

export function matchRoute(pathname: string, search = ""): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const query = new URLSearchParams(search);
  const segments = path.split("/");
  for (const [pattern, name] of ROUTES) {
    const parts = pattern.split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = parts.every((part, i) => {
      const segment = segments[i] ?? "";
      if (part.startsWith(":")) {
        if (segment === "") return false;
        params[part.slice(1)] = decodeURIComponent(segment);
        return true;
      }
      return part === segment;
    });
    if (ok) return { name, path, params, query };
  }
  return { name: "not-found", path, params: {}, query };
}

const NAVIGATE_EVENT = "ledger:navigate";

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const currentUrl = () => `${location.pathname}${location.search}`;

type Position = { readonly x: number; readonly y: number };
const sectionHistory = new Map<Section, Position & { readonly url: string }>();
let arrival: (Position & { readonly url: string }) | null = null;

/** Only section-return links consult section history; ordinary links remain fresh navigation. */
export function sectionUrl(section: Section, root: string, active: boolean): string {
  return active ? root : (sectionHistory.get(section)?.url ?? root);
}

export function takeNavigationArrival(url: string): Position | null {
  const next = arrival?.url === url ? arrival : null;
  arrival = null;
  return next;
}

export function clearSectionHistory(): void {
  sectionHistory.clear();
  arrival = null;
}

export function navigate(
  to: string,
  options: { readonly replace?: boolean; readonly intent?: "fresh" | "return" } = {},
): void {
  if (to === currentUrl()) {
    if (!options.replace && options.intent !== "return") {
      document.getElementById("main")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    return;
  }
  const leaving = sectionOf(matchRoute(location.pathname).name);
  if (leaving) sectionHistory.set(leaving, { url: currentUrl(), x: window.scrollX, y: window.scrollY });
  const destination = new URL(to, location.origin);
  const section = sectionOf(matchRoute(destination.pathname).name);
  const saved = section ? sectionHistory.get(section) : undefined;
  arrival = options.replace
    ? null
    : {
        x: 0,
        y: 0,
        ...(options.intent === "return" && saved?.url === to ? saved : {}),
        url: `${destination.pathname}${destination.searchParams.size ? `?${destination.searchParams}` : ""}`,
      };
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function useRoute(): Route {
  const url = useSyncExternalStore(subscribe, currentUrl, () => "/");
  return useMemo(() => {
    const index = url.indexOf("?");
    return index === -1 ? matchRoute(url) : matchRoute(url.slice(0, index), url.slice(index));
  }, [url]);
}

type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  readonly to: string;
  readonly replace?: boolean;
  readonly intent?: "fresh" | "return";
};

export function Link({ to, replace, intent = "fresh", onClick, target, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || target) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, { ...(replace ? { replace } : {}), intent });
  };
  return <a href={to} target={target} onClick={handleClick} {...rest} />;
}

function withParam(route: Route, name: string, value: string): string {
  const query = new URLSearchParams(route.query);
  query.set(name, value);
  return `${route.path}?${query.toString()}`;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validDay(date: string): boolean {
  return DAY.test(date) && Number(date.slice(8)) <= daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
}

/** Calendar integration: replace local selectedDate state with this URL-owned selection. */
export function useSelectedDate(): readonly [date: string, setDate: (date: string) => void] {
  const route = useRoute();
  const [month] = useSelectedMonth();
  const today = kstDate();
  const raw = route.query.get("day");
  const date = raw?.startsWith(month) && validDay(raw) ? raw : today.startsWith(month) ? today : `${month}-01`;
  const setDate = useCallback((next: string) => {
    if (!validDay(next)) return;
    // Read the current URL: selecting an adjacent-month day may just have changed month.
    const current = matchRoute(location.pathname, location.search);
    const query = new URLSearchParams(current.query);
    query.set("month", next.slice(0, 7));
    query.set("day", next);
    navigate(`${current.path}?${query}`, { replace: true });
  }, []);
  return [date, setDate] as const;
}

/** `?month=YYYY-MM` on `/` and `/calendar` (AM-3); defaults to the current KST month; changes replace history. */
export function useSelectedMonth(): readonly [month: string, setMonth: (month: string) => void] {
  const route = useRoute();
  const raw = route.query.get("month");
  const month = raw && MONTH.test(raw) ? raw : kstMonth();
  const setMonth = useCallback(
    (next: string) => {
      if (MONTH.test(next)) navigate(withParam(route, "month", next), { replace: true });
    },
    [route],
  );
  return [month, setMonth] as const;
}

/** `?year=YYYY` on `/monthly`; defaults to the current KST year; changes replace history. */
export function useSelectedYear(): readonly [year: string, setYear: (year: string) => void] {
  const route = useRoute();
  const raw = route.query.get("year");
  const year = raw && YEAR.test(raw) ? raw : kstMonth().slice(0, 4);
  const setYear = useCallback(
    (next: string) => {
      if (YEAR.test(next)) navigate(withParam(route, "year", next), { replace: true });
    },
    [route],
  );
  return [year, setYear] as const;
}
