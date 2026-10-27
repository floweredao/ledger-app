import { defineMessages } from "../../i18n";

export const calendarMessages = defineMessages(
  {
    dayLoading: "날짜별 거래 불러오는 중",
    dayLoadFailed: "거래를 불러오지 못했어요",
    emptyDay: "이 날짜에 기록이 없어요",
    unnamed: "이름 없는 거래",
    krwPending: "원화 미확정",
    calendarLabel: (month: string) => `${month} 달력`,
    calendarLoading: "달력 불러오는 중",
    calendarLoadFailed: "달력을 불러오지 못했어요",
    pickDate: "날짜 선택",
    dayRecords: (day: string) => `${day} 내역`,
    recordCount: (n: number) => `${n}건의 기록`,
    addOnDate: "이 날짜에 기록",
  },
  {
    dayLoading: "Loading this day's records",
    dayLoadFailed: "Couldn't load records",
    emptyDay: "No records on this day",
    unnamed: "Untitled record",
    krwPending: "KRW pending",
    calendarLabel: (month: string) => `${month} calendar`,
    calendarLoading: "Loading calendar",
    calendarLoadFailed: "Couldn't load the calendar",
    pickDate: "Choose a date",
    dayRecords: (day: string) => `Records for ${day}`,
    recordCount: (n: number) => `${n} ${n === 1 ? "record" : "records"}`,
    addOnDate: "Add record on this day",
  },
);
