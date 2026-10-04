/** Specific merchants precede broad matches (membership before shopping, PC cafe before cafe). */
export const merchantDictionary: readonly (readonly [RegExp, string, string?])[] = [
  [/와우멤버십|배민클럽|멤버십/i, "구독", "멤버십"],
  [/pc카페|피씨|pc방/i, "문화/여가", "PC방"],
  [/이마트24|cu|씨유|gs25|세븐일레븐|미니스톱/i, "식비", "편의점"],
  [/우아한형제|배달의민족|배민|쿠팡이츠|요기요/i, "식비", "배달"],
  [/스타벅스|투썸|이디야|메가|컴포즈|빽다방|카페/i, "식비", "카페"],
  [/쿠팡|쿠페이/i, "쇼핑", "온라인"],
  [/apple|anthrop|openai|google|netflix|넷플릭스|유튜브/i, "구독", "디지털"],
  [/한게임|넥슨|게임/i, "문화/여가", "게임"],
  [/택시|카카오t/i, "교통", "택시"],
  [/코레일|지하철|버스|티머니|k-패스/i, "교통"],
  [/미용|헤어/i, "미용"],
  [/병원|의원|약국/i, "의료/건강"],
];
