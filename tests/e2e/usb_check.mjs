// Smoke test for the portable USB export, run in a real browser with the network switched off.
//
//   node tests/e2e/usb_check.mjs <export-folder> [--browser chrome|edge|/path/to/browser] [--shots <folder>]
//
// Opens every page over file://, drives it like a teacher (keyboard and clicks), and fails if any
// request leaves file:// / data: / blob:, if a script error is thrown, or if a check fails.
// Needs Node 22+ (built-in WebSocket) and Chrome or Edge. No npm packages.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BROWSERS = {
  chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"],
  edge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/microsoft-edge"],
};

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--browser" && args[args.indexOf(a) - 1] !== "--shots");
if (!folder) { console.error("Usage: node tests/e2e/usb_check.mjs <export-folder> [--browser chrome|edge] [--shots <folder>]"); process.exit(2); }
const browserArg = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chrome";
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const exe = BROWSERS[browserArg] ? BROWSERS[browserArg].find(existsSync) : browserArg;
if (!exe || !existsSync(exe)) { console.error(`Browser not found: ${browserArg}`); process.exit(2); }
const root = resolve(folder);
const url = (page) => pathToFileURL(join(root, page.split("?")[0])).href + (page.includes("?") ? "?" + page.split("?")[1] : "");
if (shots) mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "dq-usb-"));
const downloads = join(profile, "downloads");
mkdirSync(downloads);
const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--window-size=1400,900", "about:blank"], { stdio: "ignore" });

let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = readFileSync(f, "utf8").split("\n")[0];
}
if (!port) { console.error("Browser did not start"); proc.kill(); process.exit(2); }

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const pending = new Map(), waiters = [];
const offsite = [], jsErrors = [], failures = [];
let seenRequests = 0;
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Network.requestWillBeSent") {
    const u = msg.params.request.url;
    seenRequests++;
    if (!/^(file|data|blob|about|chrome-extension|devtools):/.test(u)) offsite.push(u);
  }
  if (msg.method === "Runtime.exceptionThrown") jsErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") jsErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  waiters.slice().forEach((w) => w(msg));
});
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r)).then((m) => { if (m.error) throw new Error(`${method}: ${m.error.message}`); return m.result; });
}
function waitFor(method, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), ms);
    const w = (m) => { if (m.method === method) { clearTimeout(t); waiters.splice(waiters.indexOf(w), 1); res(m); } };
    waiters.push(w);
  });
}
async function js(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function open(page) {
  const loaded = waitFor("Page.loadEventFired");
  await send("Page.navigate", { url: url(page) });
  await loaded;
  await js("document.fonts.ready.then(() => true)");
  await sleep(250);
}
async function key(k) {
  const extra = k === "Enter" ? { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }
    : k === " " ? { code: "Space", windowsVirtualKeyCode: 32, text: " " }
    : k.startsWith("Arrow") ? { code: k, windowsVirtualKeyCode: { ArrowLeft: 37, ArrowRight: 39 }[k] }
    : { text: k };
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, ...extra });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k });
  await sleep(150);
}
async function shot(name) {
  if (!shots) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${browserArg}-${name}.png`), Buffer.from(data, "base64"));
}
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}
const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`).then((r) => sleep(150).then(() => r));
const imagesOk = () => js(`[...document.images].filter(i => i.offsetParent).every(i => i.complete && i.naturalWidth > 0)`);

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
// Network disconnected: offline emulation plus a block on every http(s) URL.
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "ws://*", "wss://*"] });
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }).catch(() =>
  send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }));

console.log(`Checking ${root} in ${browserArg} (offline)`);

// Home
await open("index.html");
check("home: all topics listed", (await js(`document.querySelectorAll(".topic-card").length`)) === (await js(`window.TOPICS.length`)));
check("home: question bank loaded from data/questions.js", (await js(`window.QUESTIONS.length`)) > 0);
check("home: fonts load from the stick", await js(`document.fonts.check('16px "Atkinson Hyperlegible"')`));
await click("[data-toggle-font]");
check("home: dyslexia font toggle", await js(`document.documentElement.dataset.font === "dyslexic" && document.fonts.load('16px OpenDyslexic').then(f => f.length > 0)`));
await click("[data-toggle-font]");
await shot("home");

// Topic page
const slug = await js(`window.TOPICS.find(t => t.slug === "angle-facts")?.slug || window.TOPICS[0].slug`);
await open(`topic-${slug}.html`);
check("topic: maths rendered by KaTeX", (await js(`document.querySelectorAll(".katex").length`)) > 0);
check("topic: diagrams load", await imagesOk());
await click('[data-year="7"]');
check("topic: year filter", await js(`[...document.querySelectorAll("[data-q-year]")].every(li => li.hidden === (li.dataset.qYear !== "7"))`));
await shot("topic");

// Present mode
await open(`present.html?kind=topic&key=${slug}`);
check("present: first question shown", (await js(`document.getElementById("stem").textContent.length`)) > 5);
check("present: options rendered with maths", (await js(`document.querySelectorAll("#options .option").length`)) === 4);
await key("ArrowRight");
check("present: → moves on", (await js(`document.getElementById("counter").textContent`)).startsWith("Question 2"));
await key("r");
check("present: R reveals the answer", (await js(`document.querySelectorAll(".option.is-correct").length`)) === 1);
await key("m");
check("present: M shows three misconceptions", (await js(`document.querySelectorAll(".miscon").length`)) === 3);
await key("t");
check("present: T starts the timer", await js(`!document.getElementById("timer").hidden`));
check("present: diagram loads", await imagesOk());
await key("y");
await js(`(() => { const i = document.querySelectorAll("#tally-inputs input"); [3, 12, 7, 4].forEach((v, k) => { i[k].value = v; i[k].dispatchEvent(new Event("input")); }); })()`);
await click("#tally-save");
await sleep(200);
check("present: tally saved to the data store", (await js(`DQStore.tallies().length`)) === 1);
await shot("present");

// Print view
await open(`print.html?kind=topic&key=${slug}`);
check("print: worksheet and answer key", await js(`document.querySelectorAll(".sheet-questions > li").length > 0 && !!document.querySelector(".answer-key")`));
check("print: maths and diagrams", (await js(`document.querySelectorAll(".katex").length`)) > 0 && (await imagesOk()));

// Quiz builder
await open("sets.html?new=1");
await js(`(() => { const f = document.querySelector("[data-builder]"); f.name.value = "Y8 starter wk 6";
  [...f.querySelectorAll("input[name=q]")].slice(0, 3).forEach(c => { c.checked = true; }); f.requestSubmit(); })()`);
await sleep(200);
const sets = await js(`DQStore.sets().map(s => [s.id, s.name, s.question_ids.length])`);
const made = sets.find((s) => s[1] === "Y8 starter wk 6");
check("sets: new set saved", !!made && made[2] === 3);
check("sets: unsaved-changes reminder shown", await js(`!document.querySelector("[data-store-status]").hidden`));
await shot("sets");

// Download the data file, wipe the browser cache, load the file back
await click("[data-download]");
let file;
for (let i = 0; i < 50 && !file; i++) { await sleep(100); file = readdirSync(downloads).find((f) => f.endsWith(".json")); }
check("data: Download data writes a JSON file", !!file);
if (file) {
  const saved = JSON.parse(readFileSync(join(downloads, file), "utf8"));
  check("data: file holds the set and tally", saved.quiz_sets.some((s) => s.name === "Y8 starter wk 6") && saved.tallies.length === 1);
  check("data: file holds no personal data", JSON.stringify(Object.keys(saved).sort()) === JSON.stringify(["exported", "format", "quiz_sets", "tallies", "version"]));
  await js(`localStorage.clear()`);
  await open("sets.html");
  check("data: without the file the set is gone (cache only)", !(await js(`DQStore.sets().some(s => s.name === "Y8 starter wk 6")`)));
  const { root: doc } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: doc.nodeId, selector: "[data-load]" });
  await send("DOM.setFileInputFiles", { nodeId, files: [join(downloads, file)] });
  await sleep(400);
  check("data: Load data restores it", await js(`DQStore.sets().some(s => s.name === "Y8 starter wk 6") && DQStore.tallies().length === 1`));
}

// Present a saved quiz set
if (made) {
  await open(`present.html?kind=set&key=${encodeURIComponent(made[0])}`);
  check("present: quiz set from the data file", (await js(`document.getElementById("counter").textContent`)).endsWith("/ 3"));
}

// Game: class mode, one full Vote -> Argue -> Revote round
await open(`game.html?kind=topic&key=${slug}`);
await js(`(() => { const f = document.querySelector("[data-setup]"); f.style.value = "class"; f.mix.value = "standard"; f.requestSubmit(); })()`);
await sleep(200);
check("game: thinking timer runs", await js(`!document.getElementById("timer").hidden`));
await key("v");
await js(`(() => { const ins = document.querySelectorAll(".count-inputs input"); [10, 12, 6, 2].forEach((v, i) => { ins[i].value = v; }); })()`);
await key("Enter"); // the counts box has focus: Enter submits the vote, as for a teacher typing
check("game: Vote 1 chart, answer still hidden", await js(`!!document.querySelector(".vote-chart") && !document.querySelector(".is-correct")`));
await shot("game-chart");
await key("a");
check("game: Argue phase with prompt", await js(`document.body.textContent.includes("convince them")`));
await key("v");
await js(`(() => { const ins = document.querySelectorAll(".count-inputs input"); [2, 25, 2, 1].forEach((v, i) => { ins[i].value = v; }); })()`);
await key("Enter"); // the counts box has focus: Enter submits the vote, as for a teacher typing
check("game: reveal shows both votes", (await js(`document.querySelectorAll(".vote-chart").length`)) === 2 && (await js(`!!document.querySelector(".is-correct")`)));
check("game: shift highlighted", await js(`/Correct: \\d+% → \\d+%/.test(document.querySelector(".shift").textContent)`));
await shot("game-reveal");
await click('[data-action="end"]');
check("game: end screen", await js(`document.body.textContent.includes("What the class learned") && document.body.textContent.includes("Still to reteach")`));
const before = await js(`DQStore.tallies().length`);
await click('[data-action="savetally"]');
await sleep(200);
check("game: Save tally stores both votes", await js(`DQStore.tallies().length === ${before + 1} && Array.isArray(DQStore.tallies().at(-1).vote2)`));
await click('[data-action="discard"]');
check("game: discarded from the session", await js(`sessionStorage.getItem("dq-game") === null`));

// Game: team mode scoring
await open(`game.html?kind=topic&key=${slug}`);
await js(`(() => { const f = document.querySelector("[data-setup]"); f.style.value = "team"; f.dispatchEvent(new Event("change")); f.requestSubmit(); })()`);
await sleep(200);
await click('[data-action="start"]');
const correct = await js(`(() => { const s = JSON.parse(sessionStorage.getItem("dq-game")); return window.QUESTIONS.find(q => q.id === s.qids[0]).correct; })()`);
await js(`(() => { const f = document.querySelector("[data-vote]"); const pick = (n, v) => { f.querySelector('[name="' + n + '"][value="' + v + '"]').checked = true; };
  const wrong = ["A","B","C","D"].find(l => l !== ${JSON.stringify(correct)});
  pick("answer0", ${JSON.stringify(correct)}); pick("bet0", "3"); pick("answer1", wrong); pick("bet1", "2");
  pick("answer2", ${JSON.stringify(correct)}); pick("answer3", wrong); f.requestSubmit(); })()`);
await sleep(200);
await click('[data-action="reveal"]');
const scores = await js(`JSON.parse(sessionStorage.getItem("dq-game")).teams.map(t => t.score)`);
check("game: team scores (+bet right, -bet wrong, never below 0)", JSON.stringify(scores) === "[3,0,1,0]", JSON.stringify(scores));
await shot("game-team");

check("request monitor is working", seenRequests > 20, String(seenRequests));
check("no requests left file://", offsite.length === 0, offsite.slice(0, 3).join(", "));
check("no script errors", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
