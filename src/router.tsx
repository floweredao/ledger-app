import { type ComponentProps, type MouseEvent, useCallback, useMemo, useSyncExternalStore } from "react";
import { kstMonth } from "../shared/dates";

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

export function navigate(to: string, options: { readonly replace?: boolean } = {}): void {
  if (to === currentUrl()) return;
  const samePath = new URL(to, location.origin).pathname === location.pathname;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (!options.replace && !samePath) window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const url = useSyncExternalStore(subscribe, currentUrl, () => "/");
  return useMemo(() => {
    const index = url.indexOf("?");
    return index === -1 ? matchRoute(url) : matchRoute(url.slice(0, index), url.slice(index));
  }, [url]);
}

type LinkProps = Omit<ComponentProps<"a">, "href"> & { readonly to: string; readonly replace?: boolean };

export function Link({ to, replace, onClick, target, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || target) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, replace ? { replace } : {});
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
