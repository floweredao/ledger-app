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
    const timer=setTimeout(()=>{stop();reject(new Error('Layout readiness did not settle'))},15000);
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
    for(const e of document.querySelectorAll('.sheet-panel,.sheet-body,.entry-form,.keypad,.entry-datetime')){
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
    for(const amount of document.querySelectorAll('.calendar-compact')){
      if(getComputedStyle(amount).display==='none')continue;
      const cell=amount.closest('.calendar-day').getBoundingClientRect(),r=amount.getBoundingClientRect();
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
  const iconLeft = (selector) =>
    view.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().left ?? null`);
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
