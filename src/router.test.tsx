import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { kstMonth } from "../shared/dates";
import { Link, matchRoute, navigate, useRoute, useSelectedDate, useSelectedMonth, useSelectedYear } from "./router";

function DateProbe() {
  const [date, setDate] = useSelectedDate();
  return (
    <>
      <output data-testid="day">{date}</output>
      <button type="button" onClick={() => setDate("2026-02-17")}>
        select day
      </button>
    </>
  );
}

function MonthProbe() {
  const [month, setMonth] = useSelectedMonth();
  return (
    <>
      <output data-testid="month">{month}</output>
      <button type="button" onClick={() => setMonth("2026-03")}>
        set
      </button>
    </>
  );
}

function YearProbe() {
  const [year, setYear] = useSelectedYear();
  return (
    <>
      <output data-testid="year">{year}</output>
      <button type="button" onClick={() => setYear("2024")}>
        set
      </button>
    </>
  );
}

function RouteProbe() {
  const route = useRoute();
  return (
    <output data-testid="route">
      {route.name}:{route.params.id ?? ""}
    </output>
  );
}

beforeEach(() => history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("useSelectedDate", () => {
  test("selected calendar day survives unmount and remount through the URL", () => {
    history.replaceState(null, "", "/calendar?month=2026-02");
    const before = history.length;
    const view = render(<DateProbe />);
    fireEvent.click(screen.getByText("select day"));
    expect(new URLSearchParams(location.search).get("day")).toBe("2026-02-17");
    expect(history.length).toBe(before);
    view.unmount();
    render(<DateProbe />);
    expect(screen.getByTestId("day").textContent).toBe("2026-02-17");
  });

  test("an invalid or out-of-month URL day falls back to the displayed month's first day", () => {
    for (const day of ["2026-02-31", "2026-03-17"]) {
      history.replaceState(null, "", `/calendar?month=2026-02&day=${day}`);
      const view = render(<DateProbe />);
      expect(screen.getByTestId("day").textContent).toBe("2026-02-01");
      view.unmount();
    }
  });
});

describe("useSelectedMonth", () => {
  test("reads ?month from the URL", () => {
    history.replaceState(null, "", "/?month=2026-02");
    render(<MonthProbe />);
    expect(screen.getByTestId("month").textContent).toBe("2026-02");
  });

  test("defaults to the current KST month when missing or invalid", () => {
    history.replaceState(null, "", "/calendar?month=2026-13");
    render(<MonthProbe />);
    expect(screen.getByTestId("month").textContent).toBe(kstMonth());
  });

  test("setting the month replaces the history entry and keeps the path and other params", () => {
    history.replaceState(null, "", "/calendar?month=2026-02&x=1");
    render(<MonthProbe />);
    const before = history.length;
    fireEvent.click(screen.getByText("set"));
    expect(location.pathname).toBe("/calendar");
    expect(new URLSearchParams(location.search).get("month")).toBe("2026-03");
    expect(new URLSearchParams(location.search).get("x")).toBe("1");
    expect(history.length).toBe(before);
    expect(screen.getByTestId("month").textContent).toBe("2026-03");
  });
});

describe("useSelectedYear", () => {
  test("reads ?year and defaults to the current KST year", () => {
    history.replaceState(null, "", "/monthly?year=2025");
    const { unmount } = render(<YearProbe />);
    expect(screen.getByTestId("year").textContent).toBe("2025");
    unmount();
    history.replaceState(null, "", "/monthly?year=abc");
    render(<YearProbe />);
    expect(screen.getByTestId("year").textContent).toBe(kstMonth().slice(0, 4));
  });

  test("setting the year replaces the entry", () => {
    history.replaceState(null, "", "/monthly");
    render(<YearProbe />);
    const before = history.length;
    fireEvent.click(screen.getByText("set"));
    expect(location.search).toBe("?year=2024");
    expect(history.length).toBe(before);
  });
});

describe("routing", () => {
  test("matches every shell route and params", () => {
    expect(matchRoute("/").name).toBe("ledger");
    expect(matchRoute("/calendar").name).toBe("calendar");
    expect(matchRoute("/monthly").name).toBe("monthly");
    expect(matchRoute("/search").name).toBe("search");
    expect(matchRoute("/stats").name).toBe("stats");
    expect(matchRoute("/budget").name).toBe("budget");
    expect(matchRoute("/assets").name).toBe("assets");
    expect(matchRoute("/assets/a%201").params.id).toBe("a 1");
    expect(matchRoute("/settings/preferences").name).toBe("settings-preferences");
    expect(matchRoute("/settings/data/").name).toBe("settings-data");
    expect(matchRoute("/nope").name).toBe("not-found");
  });

  test("navigate pushes a history entry and re-renders subscribers", () => {
    render(<RouteProbe />);
    const before = history.length;
    act(() => navigate("/assets/abc"));
    expect(screen.getByTestId("route").textContent).toBe("asset-detail:abc");
    expect(history.length).toBe(before + 1);
  });

  test("Link performs client-side navigation on a plain click", () => {
    render(
      <>
        <Link to="/stats">통계</Link>
        <RouteProbe />
      </>,
    );
    fireEvent.click(screen.getByText("통계"));
    expect(location.pathname).toBe("/stats");
    expect(screen.getByTestId("route").textContent).toBe("stats:");
  });
});
