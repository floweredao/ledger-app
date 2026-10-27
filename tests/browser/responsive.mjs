import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { kstDate, kstMonth } from "../../shared/dates";
import { authed, makeTestApp, TEST_ORIGIN } from "../helpers";

const port = Number(process.env.LEDGER_TEST_PORT ?? 4365);
const base = `http://127.0.0.1:${port}`;
const dist = resolve(process.env.LEDGER_TEST_DIST ?? "dist");
assert(await Bun.file(join(dist, "index.html")).exists(), "Run the production build before this browser regression");
const app = makeTestApp({
  env: {
    LEDGER_PORT: String(port),
    LEDGER_STATIC_DIR: dist,
    LEDGER_ALLOWED_ORIGINS: TEST_ORIGIN,
  },
});
let server;
let view;
const findings = [];
const checks = [];
const evidence = process.env.RESPONSIVE_EVIDENCE_DIR;
const focusedEdit = process.env.RESPONSIVE_FOCUS === "edit";
if (evidence) mkdirSync(evidence, { recursive: true });

async function settled(extra = "true") {
  await view.evaluate(`new Promise((resolve,reject)=>{
    let observer,queued=false;
    const ready=()=>document.querySelector('main h1')&&window.__layoutPending===0&&(${extra});
    const stop=()=>{observer.disconnect();window.removeEventListener('layout:requests',check);clearTimeout(timer)};
    const check=()=>{if(!ready()||queued)return;queued=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{
      queued=false;if(ready()){stop();resolve(true)}
    }))};
    const timer=setTimeout(()=>{stop();reject(new Error('Layout readiness did not settle: '+${JSON.stringify(JSON.stringify(extra))}))},15000);
    observer=new MutationObserver(check);
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
    window.addEventListener('layout:requests',check);check();
  })`);
}

async function inspect(label, width) {
  await view.evaluate(
    "Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)).then(()=>true)",
  );
  const result = await view.evaluate(`(()=>{
    const root=document.documentElement,issues=[];
    if(root.scrollWidth>root.clientWidth+1)issues.push({element:'document',client:root.clientWidth,scroll:root.scrollWidth});
    for(const e of document.querySelectorAll('.sheet-panel,.sheet-body,.entry-form,.keypad,.entry-datetime,.calendar-main')){
      if(e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+1)
        issues.push({element:e.className,client:e.clientWidth,scroll:e.scrollWidth});
    }
    for(const e of document.querySelectorAll('.screen,.asset-panel,.list-row,.input,.calendar-grid,.stats-panel,.sheet-panel button')){
      const r=e.getBoundingClientRect();
      if(r.width&&(r.right>innerWidth+1||r.left< -1))issues.push({element:e.className,left:r.left,right:r.right});
    }
    for(const row of document.querySelectorAll('.entry-datetime')){
      const fields=[...row.querySelectorAll('.field')].map(f=>({field:f.getBoundingClientRect(),input:f.querySelector('input')?.getBoundingClientRect()}));
      for(const {field,input} of fields){
        if(input&&(input.left<field.left-1||input.right>field.right+1))
          issues.push({element:'entry-datetime input outside its column',field:[field.left,field.right],input:[input.left,input.right]});
      }
      const [date,time]=fields.map(f=>f.input);
      if(date&&time&&date.right>time.left+1)issues.push({element:'entry-datetime overlap',date:date.right,time:time.left});
    }
    const calendarDays=[...document.querySelectorAll('.calendar-day')].map(d=>({date:d.getAttribute('data-calendar-date'),rect:d.getBoundingClientRect()}));
    for(let i=0;i<calendarDays.length;i++){
      for(let j=i+1;j<calendarDays.length;j++){
        const a=calendarDays[i].rect,b=calendarDays[j].rect;
        if(a.right>b.left+0.5&&b.right>a.left+0.5&&a.bottom>b.top+0.5&&b.bottom>a.top+0.5)
          issues.push({element:'calendar day hit targets overlap',days:[calendarDays[i].date,calendarDays[j].date],a:[a.left,a.right],b:[b.left,b.right]});
      }
    }
    for(const amount of document.querySelectorAll('.calendar-compact')){
      if(getComputedStyle(amount).display==='none')continue;
      const cell=amount.closest('.calendar-day').getBoundingClientRect(),r=amount.getBoundingClientRect();
      const fontSize=parseFloat(getComputedStyle(amount).fontSize);
      if(fontSize<12-0.05)issues.push({element:'calendar amount font below 12px',text:amount.textContent,fontSize});
      if(amount.getClientRects().length>1)issues.push({element:'calendar amount wraps',text:amount.textContent});
      if(r.left<cell.left-0.5||r.right>cell.right+0.5)
        issues.push({element:'calendar amount outside its day',text:amount.textContent,day:[cell.left,cell.right],amount:[r.left,r.right]});
    }
    const sheet=document.querySelector('.sheet-body');
    if(sheet&&['auto','scroll'].includes(getComputedStyle(sheet).overflowX))
      issues.push({element:'sheet-body',horizontalScrollPolicy:getComputedStyle(sheet).overflowX});
    return{width:innerWidth,client:root.clientWidth,scroll:root.scrollWidth,issues};
  })()`);
  checks.push({ label, width, ...result });
  if (result.issues.length) findings.push({ label, width, issues: result.issues });
  if (evidence && (result.issues.length || label === "edit-stress")) {
    await Bun.write(join(evidence, `${label}-${width}.png`), await view.screenshot());
  }
}

try {
  const request = await authed(app);
  const create = async (path, body) => {
    const response = await request(`/api/v1/${path}`, { method: "POST", body });
    assert.equal(response.status, 201, `Synthetic ${path} fixture failed`);
    return response.json();
  };
  // The assertions read Korean copy, so pin the language instead of following the headless browser's locale.
  const language = await request("/api/v1/settings", { method: "PATCH", body: { language: "ko" } });
  assert.equal(language.status, 200, "Synthetic language setting failed");
  const bank = await create("assets", { name: "테스트자산".repeat(8), kind: "bank", opening_balance: 100000 });
  const category = await create("categories", { type: "expense", name: "테스트분류", icon: "coffee", color: "cat-1" });
  await create("templates", {
    name: "테스트즐겨찾기".repeat(5),
    payload: {
      type: "expense",
      amount: 1000,
      asset_id: bank.id,
      category_id: category.id,
      merchant: "테스트상점",
    },
  });
  await create("transactions", {
    type: "expense",
    amount: 9999999999,
    asset_id: bank.id,
    category_id: category.id,
    occurred_at: `${kstDate()}T09:12:00+09:00`,
    merchant: "테스트상점".repeat(12),
    memo: "긴메모".repeat(100),
  });
  for (const [day, type, amount] of [
    ["01", "expense", 12345678],
    ["02", "expense", 99994000],
    ["03", "expense", 123456789],
    ["03", "income", 12345678],
  ]) {
    await create("transactions", {
      type,
      amount,
      asset_id: bank.id,
      category_id: type === "expense" ? category.id : undefined,
      occurred_at: `${kstMonth()}-${day}T10:00:00+09:00`,
      merchant: "테스트마트",
    });
  }
  server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.app.fetch });
  view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    dataStore: { directory: join(app.dataDir, "browser-profile") },
    width: 390,
    height: 844,
  });
  await view.navigate(`${base}/api/v1/health`);
  const split = request.cookie.indexOf("=");
  await view.cdp("Network.setCookie", {
    name: request.cookie.slice(0, split),
    value: request.cookie.slice(split + 1),
    url: base,
    path: "/",
    httpOnly: true,
  });
  await view.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.__layoutPending=0;const originalFetch=window.fetch.bind(window);
    window.fetch=async(...args)=>{window.__layoutPending++;
      try{const response=await originalFetch(...args);await response.clone().arrayBuffer();return response}
      finally{window.__layoutPending--;window.dispatchEvent(new Event('layout:requests'))}
    };
  `,
  });
  const routes = [
    ["daily", `/?month=${kstMonth()}`],
    ["calendar", `/calendar?month=${kstMonth()}`],
    ["monthly", `/monthly?year=${kstMonth().slice(0, 4)}`],
    ["search", "/search"],
    ["stats", "/stats"],
    ["budget", "/budget"],
    ["assets", "/assets"],
    ["asset-detail", `/assets/${bank.id}`],
    ["settings", "/settings"],
    ["categories", "/settings/categories"],
    ["rules", "/settings/rules"],
    ["recurring", "/settings/recurring"],
    ["templates", "/settings/templates"],
    ["data", "/settings/data"],
    ["preferences", "/settings/preferences"],
  ];
  const inspectCalendarZoomAndDetail = async (width) => {
    for (const rootFontSize of ["100%", "200%"]) {
      const zoomIssues = await view.evaluate(`(()=>{
        document.documentElement.style.fontSize=${JSON.stringify(rootFontSize)};
        const issues=[],main=document.querySelector('.calendar-main');
        if(main&&main.scrollWidth>main.clientWidth+1)
          issues.push({element:'calendar-main',rootFontSize:${JSON.stringify(rootFontSize)},client:main.clientWidth,scroll:main.scrollWidth});
        for(const amount of document.querySelectorAll('.calendar-compact')){
          if(getComputedStyle(amount).display==='none')continue;
          const cell=amount.closest('.calendar-day').getBoundingClientRect(),r=amount.getBoundingClientRect();
          const fontSize=parseFloat(getComputedStyle(amount).fontSize);
          if(fontSize<12-0.05)issues.push({element:'calendar amount font below 12px',rootFontSize:${JSON.stringify(rootFontSize)},text:amount.textContent,fontSize});
          if(amount.getClientRects().length>1)issues.push({element:'calendar amount wraps',rootFontSize:${JSON.stringify(rootFontSize)},text:amount.textContent});
          if(r.left<cell.left-0.5||r.right>cell.right+0.5)
            issues.push({element:'calendar amount outside its day',rootFontSize:${JSON.stringify(rootFontSize)},text:amount.textContent,day:[cell.left,cell.right],amount:[r.left,r.right]});
        }
        document.documentElement.style.fontSize='';
        return issues;
      })()`);
      if (zoomIssues.length) findings.push({ label: `calendar-${rootFontSize}`, width, issues: zoomIssues });
    }
    const day03 = `${kstMonth()}-03`;
    await view.click(`[data-calendar-date="${day03}"]`);
    await settled(
      `document.querySelector('.calendar-day-panel')?.textContent?.includes('123,456,789원') && document.querySelector('.calendar-day-panel')?.textContent?.includes('12,345,678원')`,
    );
  };
  // The balance-adjustment notice is an ordinary toast: it needs even side padding and must clear the tab bar.
  const inspectToast = async (width) => {
    await view.navigate(`${base}/assets/${bank.id}`);
    await view.resize(width, 844);
    await settled("[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='편집')");
    await view.evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='편집').click()");
    await settled("document.querySelector('#asset-editor-form input[inputmode]')");
    await view.evaluate(`(()=>{
      const input=[...document.querySelectorAll('#asset-editor-form .field')].find(f=>f.textContent.includes('현재 잔액')).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(Number(input.value)+1));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('asset-editor-form').requestSubmit();
    })()`);
    await settled("document.querySelector('.toast')");
    await view.evaluate("Promise.allSettled(document.getAnimations().map(a=>a.finished)).then(()=>true)");
    const toast = await view.evaluate(`(()=>{
      const t=document.querySelector('.toast'),r=t.getBoundingClientRect(),range=document.createRange();
      range.selectNodeContents(t.querySelector('.toast-message'));
      const text=range.getBoundingClientRect(),tab=document.querySelector('.tabbar').getBoundingClientRect();
      return{left:r.left,right:r.right,textLeft:text.left-r.left,textRight:r.right-text.right,gapAboveTabbar:tab.top-r.bottom};
    })()`);
    const issues = [];
    if (toast.textLeft < 16 - 0.5 || toast.textRight < 16 - 0.5)
      issues.push({ element: "toast side padding", ...toast });
    if (toast.gapAboveTabbar < 12 - 0.5) issues.push({ element: "toast too close to the tab bar", ...toast });
    if (toast.left < 16 - 0.5 || toast.right > width - 16 + 0.5)
      issues.push({ element: "toast outside the side insets", ...toast });
    checks.push({ label: "toast", width, issues });
    if (issues.length) findings.push({ label: "toast", width, issues });
    if (evidence) await Bun.write(join(evidence, `toast-${width}.png`), await view.screenshot());
  };
  // The undo toast floats over the list; scrolled to the end, the last row must still clear it.
  const inspectToastClearance = async (width, height) => {
    await view.navigate(`${base}/?month=${kstMonth()}`);
    await view.resize(width, height);
    await settled("document.querySelector('.daily-day-rows .list-row')");
    const rows = await view.evaluate("document.querySelectorAll('main .list-row').length");
    await view.click(".daily-day-rows .list-row");
    await settled("[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.trim()==='삭제')");
    await view.evaluate(
      "[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='삭제').click()",
    );
    await settled("document.querySelector('.toast-has-action')&&!document.querySelector('[role=dialog]')");
    await view.evaluate("Promise.allSettled(document.getAnimations().map(a=>a.finished)).then(()=>true)");
    const clearance = await view.evaluate(`new Promise(resolve=>{
      window.scrollTo(0,document.scrollingElement.scrollHeight);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const toast=document.querySelector('.toast-region').getBoundingClientRect();
        const last=[...document.querySelectorAll('main .list-row')].at(-1).getBoundingClientRect();
        resolve({toastTop:toast.top,lastRowBottom:last.bottom});
      }));
    })`);
    const issues =
      clearance.lastRowBottom > clearance.toastTop + 0.5
        ? [{ element: "toast covers the list end", ...clearance }]
        : [];
    checks.push({ label: "toast-clearance", width, issues });
    if (issues.length) findings.push({ label: "toast-clearance", width, issues });
    if (evidence) await Bun.write(join(evidence, `toast-clearance-${width}.png`), await view.screenshot());
    // Undo restores the fixture row so the later edit-stress checks see the same list.
    await view.evaluate("document.querySelector('.toast-has-action .toast-action').click()");
    await settled(`!document.querySelector('.toast')&&document.querySelectorAll('main .list-row').length===${rows}`);
  };
  for (const [width, height] of focusedEdit
    ? []
    : [
        [390, 844],
        [320, 640],
        [1440, 900],
      ])
    await inspectToastClearance(width, height);
  const iconLeft = (selector) =>
    view.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().left ?? null`);
  for (const width of focusedEdit ? [] : [390, 375, 320]) await inspectToast(width);
  for (const width of [390, 375, 320]) {
    let dailyIconLeft = null;
    for (const [label, route] of focusedEdit ? [] : routes) {
      await view.navigate(base + route);
      await view.resize(width, 844);
      if (label === "daily") {
        await settled("document.querySelector('.daily-day-rows .category-icon')");
        dailyIconLeft = await iconLeft(".daily-day-rows .category-icon");
      } else if (label === "calendar") {
        await settled("document.querySelector('.calendar-transactions .category-icon')");
        const calendarIconLeft = await iconLeft(".calendar-transactions .category-icon");
        if (dailyIconLeft === null || calendarIconLeft === null || Math.abs(calendarIconLeft - dailyIconLeft) > 1) {
          findings.push({
            label,
            width,
            issues: [{ element: "day detail icon inset", dailyIconLeft, calendarIconLeft }],
          });
        }
        await inspectCalendarZoomAndDetail(width);
      } else {
        await settled();
      }
      await inspect(label, width);
    }
    await view.navigate(`${base}/?month=${kstMonth()}`);
    await view.resize(width, 844);
    await settled("document.querySelector('.daily-day-rows .list-row')");
    await view.scrollTo(".daily-day-rows .list-row");
    await view.click(".daily-day-rows .list-row");
    await settled("document.querySelector('[role=dialog] .entry-form input[type=date]')");
    await inspect("edit-stress", width);
    await view.scrollTo("[role=dialog] input[type=date]");
    await inspect("edit-scrolled", width);
    await view.click('[role=dialog] button[aria-label="닫기"]');
    await settled("!document.querySelector('[role=dialog]')");
    if (!focusedEdit) {
      await view.navigate(`http://localhost:${port}/`);
      await view.resize(width, 844);
      await settled("document.querySelector('input[type=password]')");
      await inspect("login", width);
    }
  }
  console.log(JSON.stringify({ mode: focusedEdit ? "edit" : "all", responsiveChecks: checks.length, findings }));
  assert.equal(findings.length, 0, "Horizontal overflow or unintended sideways sheet scrolling");
} finally {
  if (view) await view.close();
  if (server) await server.stop(true);
  app.cleanup();
  console.log("RESPONSIVE_QA_CLEANED");
}
