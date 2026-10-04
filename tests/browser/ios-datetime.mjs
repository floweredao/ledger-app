// iOS Safari lane for the entry sheet date/time row. Chrome and macOS WebKit do not reproduce iOS's native
// date/time control width, so this drives the built app inside Simulator Safari at 390/375/320px.
// Needs Xcode's simctl and an available iPhone simulator (IOS_SIM_UDID overrides the choice).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { kstDate, kstMonth } from "../../shared/dates";
import { authed, makeTestApp, TEST_ORIGIN } from "../helpers";

const port = Number(process.env.LEDGER_TEST_PORT ?? 4368);
const base = `http://127.0.0.1:${port}`;
const dist = resolve(process.env.LEDGER_TEST_DIST ?? "dist");
const evidence = process.env.RESPONSIVE_EVIDENCE_DIR;
const widths = [320, 375, 390];
assert(await Bun.file(join(dist, "index.html")).exists(), "Run the production build before this browser regression");
if (evidence) mkdirSync(evidence, { recursive: true });

const devices = JSON.parse(await Bun.$`xcrun simctl list devices available -j`.text()).devices;
const iphones = Object.values(devices)
  .flat()
  .filter((device) => device.name.startsWith("iPhone"));
const device =
  iphones.find((item) => item.udid === process.env.IOS_SIM_UDID) ??
  iphones.find((item) => item.state === "Booted") ??
  iphones[0];
assert(device, "No available iPhone simulator");
const bootedHere = device.state !== "Booted";

const app = makeTestApp({
  env: { LEDGER_PORT: String(port), LEDGER_STATIC_DIR: dist, LEDGER_ALLOWED_ORIGINS: `${TEST_ORIGIN},${base}` },
});
let server;
let timer;
try {
  const request = await authed(app);
  const create = async (path, body) => {
    const response = await request(`/api/v1/${path}`, { method: "POST", body });
    assert.equal(response.status, 201, `Synthetic ${path} fixture failed`);
    return response.json();
  };
  const bank = await create("assets", { name: "테스트통장", kind: "bank", opening_balance: 100000 });
  await create("transactions", {
    type: "expense",
    amount: 8000,
    asset_id: bank.id,
    occurred_at: `${kstDate()}T21:44:00+09:00`,
    merchant: "샘플카페",
  });

  const page = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0"><script>
const token=${JSON.stringify(app.ownerToken)},widths=${JSON.stringify(widths)},month=${JSON.stringify(kstMonth())};
const until=(check,label,ms=20000)=>new Promise((ok,fail)=>{const start=performance.now();const tick=()=>{let value;try{value=check()}catch{}
  if(value)return ok(value);if(performance.now()-start>ms)return fail(new Error(label));requestAnimationFrame(tick)};tick()});
const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
(async()=>{const results=[];try{
  for(const reg of await navigator.serviceWorker?.getRegistrations?.()??[])await reg.unregister();
  for(const key of await caches.keys())await caches.delete(key);
  const login=await fetch('/api/v1/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  if(login.status!==200)throw new Error('login '+login.status);
  for(const width of widths){
    document.body.replaceChildren();
    const frame=document.createElement('iframe');
    frame.style.cssText='display:block;border:0;width:'+width+'px;height:844px';
    frame.src='/?month='+month;
    document.body.append(frame);
    const row=await until(()=>frame.contentDocument.querySelector('.daily-day-rows .list-row'),'daily row '+width);
    row.click();
    const doc=frame.contentDocument;
    const date=await until(()=>doc.querySelector('[role=dialog] input[type=date]'),'edit sheet '+width);
    date.scrollIntoView({block:'center'});
    await Promise.allSettled(doc.getAnimations().map(a=>a.finished));await frames();
    const issues=[];
    const fields=[...doc.querySelectorAll('.entry-datetime .field')].map(f=>({field:f.getBoundingClientRect(),input:f.querySelector('input').getBoundingClientRect()}));
    for(const {field,input} of fields)if(input.left<field.left-1||input.right>field.right+1)issues.push({input:[input.left,input.right],field:[field.left,field.right]});
    if(fields.length===2&&fields[0].input.right>fields[1].input.left+1)issues.push({overlap:[fields[0].input.right,fields[1].input.left]});
    const body=doc.querySelector('.sheet-body').getBoundingClientRect();
    if(fields.some(f=>f.input.right>body.right+1))issues.push({clippedBySheet:body.right});
    results.push({width,inner:frame.contentWindow.innerWidth,inputs:fields.map(f=>[Math.round(f.input.left),Math.round(f.input.right)]),issues});
  }
}catch(error){results.push({error:String(error)})}
navigator.sendBeacon('/__ios-qa/report',JSON.stringify({ua:navigator.userAgent,results}));})();
</script></body></html>`;

  const { promise: report, resolve: settle } = Promise.withResolvers();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/__ios-qa") return new Response(page, { headers: { "Content-Type": "text/html" } });
      if (path === "/__ios-qa/report") {
        settle(await req.json());
        return new Response("ok");
      }
      // Only this harness frames the app (same origin) so the page can drive it; production keeps frame-ancestors 'none'.
      const response = await app.app.fetch(req);
      const csp = response.headers.get("Content-Security-Policy");
      if (!csp) return response;
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  });
  if (bootedHere) {
    await Bun.$`xcrun simctl boot ${device.udid}`;
    await Bun.$`xcrun simctl bootstatus ${device.udid} -b`.quiet();
  }
  await Bun.$`xcrun simctl openurl ${device.udid} ${`${base}/__ios-qa?run=${Date.now()}`}`;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Simulator Safari did not report within 90s")), 90000);
  });
  const result = await Promise.race([report, timeout]);
  if (evidence) await Bun.$`xcrun simctl io ${device.udid} screenshot ${join(evidence, "ios-datetime.png")}`.quiet();
  console.log(JSON.stringify({ device: device.name, ...result }));
  assert.equal(result.results.length, widths.length, "Every width must be measured");
  for (const item of result.results) {
    assert.equal(item.error, undefined, item.error);
    assert.equal(item.inner, item.width, `iframe width ${item.width}`);
    assert.deepEqual(item.issues, [], `Date/time row overflows at ${item.width}px`);
  }
} finally {
  clearTimeout(timer);
  if (server) await server.stop(true);
  app.cleanup();
  if (bootedHere) await Bun.$`xcrun simctl shutdown ${device.udid}`.quiet().nothrow();
  console.log("IOS_DATETIME_CLEANED");
}
