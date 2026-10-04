import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import SettingsScreen from "./SettingsScreen";

afterEach(cleanup);

describe("SettingsScreen", () => {
  test("renders settings title", () => {
    render(<SettingsScreen onLoggedOut={() => {}} />);
    expect(screen.getByText("설정")).toBeTruthy();
  });

  test("displays version number", () => {
    render(<SettingsScreen onLoggedOut={() => {}} />);
    expect(screen.getByText("0.0.1")).toBeTruthy();
  });

  test("renders menu items", () => {
    render(<SettingsScreen onLoggedOut={() => {}} />);
    expect(screen.getByText("분류 관리")).toBeTruthy();
    expect(screen.getByText("가게별 자동 분류")).toBeTruthy();
    expect(screen.getByText("환경 설정")).toBeTruthy();
  });

  test("has logout button", () => {
    render(<SettingsScreen onLoggedOut={() => {}} />);
    expect(screen.getByText("로그아웃")).toBeTruthy();
  });

  test("component exports as default", () => {
    expect(SettingsScreen).toBeTruthy();
    expect(typeof SettingsScreen).toBe("function");
  });
});
