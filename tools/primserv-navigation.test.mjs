import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import crypto from "node:crypto";

const root = new URL("../", import.meta.url);
const source = await fs.readFile(new URL("assets/js/training-app.js", root), "utf8");
const data = await fs.readFile(new URL("assets/js/training-data.js", root), "utf8");
const custom = await fs.readFile(new URL("assets/js/location-custom.js", root), "utf8");
const worker = await fs.readFile(new URL("sw.js", root), "utf8");
const instrumented = source.replace(/  renderPage\(\);\n  upgradeCache\(\);\n\}\)\(\);\s*$/, "  window.navigationTest = { renderHeader, reloadWithLanguage, href };\n})();");
assert.notEqual(source, instrumented, "Only instrument startup; never execute operational UI, audio or network actions");
const langs = ["pl", "en", "ua", "ru", "az", "es", "fil", "id", "ne"];

function header(lang, page = "home", blockedStorage = false) {
  const location = new URL(`https://oleksandrkiris.github.io/citronex-ryczywol-szkolenie/${page === "home" ? "index" : page}.html?lang=${lang}&section=fixture#wanted`);
  const document = {
    documentElement: {}, currentScript: { src: `${location.origin}/assets/js/training-app.js?v=release` },
    body: { dataset: { page }, insertAdjacentHTML(_position, html) { this.html = html; } },
    getElementById: () => ({ addEventListener() {} })
  };
  const localStorage = {
    getItem() { if (blockedStorage) throw new Error("Storage blocked"); return "pl"; },
    setItem() { if (blockedStorage) throw new Error("Storage blocked"); }
  };
  const window = {};
  const context = vm.createContext({ window, document, location, localStorage, URL, URLSearchParams, navigator: { language: "pl", languages: ["pl"] } });
  vm.runInContext(data, context);
  vm.runInContext(custom, context);
  assert.ok(window.CX_DATA.meta.location.includes("Ryczywół"));
  const original = JSON.stringify(window.CX_DATA);
  vm.runInContext(instrumented, context);
  window.navigationTest.renderHeader();
  assert.equal(JSON.stringify(window.CX_DATA), original);
  return { window, document, location, html: document.body.html };
}

for (const lang of langs) test(`${lang}: header links on home, map and contacts use supported languages`, () => {
  for (const page of ["home", "mapa", "kontakty"]) {
    const c = header(lang, page);
    assert.ok(c.html.includes('alt="PrimServ"'));
    assert.ok(c.html.includes("PrimServ · HYDRA"));
    assert.ok(c.html.includes(`citronex-hydra-project/?lang=${lang}`));
    assert.ok(c.html.includes(`kiris-jobs/?lang=${lang === "ua" ? "uk" : lang}`));
    assert.ok(c.html.includes('href="https://www.primserv.pl/"'));
    assert.ok(c.html.includes('href="https://t.me/KirisWorkPoland_bot"'));
    assert.ok(c.html.includes(`kontakty.html?lang=${lang}`));
    for (const match of c.html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.ok(match[0].includes('rel="noopener noreferrer"'));
    assert.equal(c.document.documentElement.lang, lang === "ua" ? "uk" : lang);
    assert.equal(c.html.includes("English (EN)"), false);
  }
});

for (const alias of ["uk", "ka", "hy"]) test(`${alias}: explicit language beats saved Polish with truthful fallback`, () => {
  const c = header(alias);
  const actual = alias === "uk" ? "ua" : "en";
  assert.ok(c.html.includes(`citronex-hydra-project/?lang=${actual}`));
  assert.equal(c.html.includes("English (EN)"), alias !== "uk");
});

test("blocked storage does not prevent opening or changing language; query/hash survive", () => {
  const c = header("ua", "mapa", true);
  c.window.navigationTest.reloadWithLanguage("ru");
  const url = new URL(c.location.href);
  assert.equal(url.searchParams.get("lang"), "ru");
  assert.equal(url.searchParams.get("section"), "fixture");
  assert.equal(url.hash, "#wanted");
});

test("official logo and every production page use the new worker/UI entry", async () => {
  const logo = await fs.readFile(new URL("assets/primserv-logo.svg", root));
  assert.equal(crypto.createHash("sha256").update(logo).digest("hex"), "1a29802a4a0065ad84e8f8dbdd5bc46dcb9b67bbecb2190de6a99464feaf5157");
  for (const file of (await fs.readdir(root)).filter(p => p.endsWith(".html"))) {
    const html = await fs.readFile(new URL(file, root), "utf8");
    assert.ok(html.includes('href="assets/primserv-logo.svg"'), file);
    assert.match(html, /<title>[^<]*PrimServ<\/title>/, file);
    if (html.includes('data-standalone-tool=')) continue;
    assert.ok(html.includes('property="og:site_name"'), file);
    assert.ok(html.includes("assets/js/training-app.js?v=20261016-primserv-ryczywol1"), file);
    assert.ok(html.includes("assets/css/primserv.css?v=20261016-primserv-ryczywol1"), file);
    assert.match(html, /assets\/js\/training-data\.js\?v=[^\"\s]+/, file);
  }
  const css = await fs.readFile(new URL("assets/css/primserv.css", root), "utf8");
  assert.ok(css.includes("min-height: 44px"));
  assert.ok(css.includes(":focus-visible"));
});

function workerHarness() {
  const origin = "https://oleksandrkiris.github.io";
  const scope = `${origin}/citronex-ryczywol-szkolenie/`;
  const handlers = {}, added = [], copied = [], deleted = [], lifecycle = [];
  const context = vm.createContext({
    self: { location: { origin }, addEventListener(name, handler) { handlers[name] = handler; }, skipWaiting() { lifecycle.push("skip"); }, clients: { claim() { lifecycle.push("claim"); } } },
    caches: {
      async open() { return { async add(request) { added.push(request.url); }, async put(request) { copied.push(request.url); } }; },
      async match(request) { return request.url.includes("primserv") ? null : new Response("old valid asset"); },
      async keys() { return ["unrelated", "citronex-ryczywol-older", "citronex-ryczywol-another", vm.runInContext("CACHE_NAME", context)]; },
      async delete(name) { deleted.push(name); }
    },
    Request: class extends Request { constructor(input, options) { super(new URL(input, scope), options); } },
    URL, Response,
    fetch() { throw new Error("Network must not run in tests"); }
  });
  vm.runInContext(worker, context);
  return { added, copied, deleted, lifecycle, async run(name) { let promise; handlers[name]({ waitUntil(value) { promise = value; } }); await promise; } };
}

test("worker migrates exact unchanged cached assets but refreshes documents and changed assets", async () => {
  const w = workerHarness();
  await w.run("install");
  assert.ok(w.copied.some(url => url.endsWith("/assets/orientation/sklarnia-etap-excel.png")));
  assert.ok(w.copied.some(url => url.endsWith("/assets/css/training.css?v=20260718-greenhouse-separate1")));
  assert.ok(w.copied.some(url => url.endsWith("/assets/js/location-custom.js?v=20260718-greenhouse-separate1")));
  assert.ok(w.added.some(url => url.endsWith("/index.html")));
  assert.ok(w.added.some(url => url.endsWith("/manifest.webmanifest")));
  assert.ok(w.added.some(url => url.endsWith("/assets/js/training-app.js?v=20261016-primserv-ryczywol1")));
  assert.ok(w.added.some(url => url.endsWith("/assets/primserv-logo.svg")));
  assert.equal(w.added.some(url => url.includes(".mp3")), false);
  assert.ok(w.lifecycle.includes("skip"));
});

test("activation clears only old location caches", async () => {
  const w = workerHarness();
  await w.run("activate");
  assert.deepEqual(w.deleted, ["citronex-ryczywol-older", "citronex-ryczywol-another"]);
  assert.ok(w.lifecycle.includes("claim"));
});

function timeoutHarness({ network = async () => new Response("fresh"), cached = () => undefined } = {}) {
  const handlers = {}, timers = [], cleared = [], calls = [], writes = [], matches = [];
  const origin = "https://oleksandrkiris.github.io";
  const cache = {
    async match(request, options) { matches.push({ request, options }); return cached(request); },
    async put(request, response) { writes.push({ request, body: await response.text() }); }
  };
  vm.runInNewContext(worker, {
    self: { addEventListener(name, handler) { handlers[name] = handler; } },
    location: { origin }, URL, Response,
    caches: { async open() { return cache; }, async match(request) { return cached(request); } },
    fetch(request, options) { calls.push({ request, options }); return network(request); },
    setTimeout(callback, delay) { assert.equal(delay, 1400); return timers.push(callback); },
    clearTimeout(id) { cleared.push(id); }
  });
  return {
    timers, cleared, calls, writes, matches,
    request({ path = "assets/new.png", method = "GET", html = false } = {}) {
      const request = { url: new URL(path, `${origin}/citronex-ryczywol-szkolenie/`).href, method,
        mode: html ? "navigate" : "cors", headers: new Headers({ accept: html ? "text/html" : "image/png" }) };
      let result;
      handlers.fetch({ request, respondWith(value) { result = value; } });
      return result;
    }
  };
}

for (const status of [200, 404, 503]) test(`worker HTTP ${status}: settled request clears its own unused timeout`, async () => {
  const h = timeoutHarness({ network: async () => new Response("result", { status }) });
  assert.equal((await h.request()).status, status);
  await new Promise(setImmediate); // Existing cache.put is intentionally fire-and-forget.
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options, undefined, "Request options and cancellation policy stay unchanged");
  assert.equal(h.writes.length, status === 200 ? 1 : 0);
});

test("worker network rejection clears the timer and preserves the error fallback", async () => {
  const h = timeoutHarness({ network: async () => { throw Error("offline"); } });
  assert.equal((await h.request()).type, "error");
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.writes.length, 0);
});

test("worker timeout retains the cache fallback without aborting or caching a late response", async () => {
  let resolveNetwork, expired = false;
  const h = timeoutHarness({ network: () => new Promise(resolve => { resolveNetwork = resolve; }),
    cached: () => expired ? new Response("available offline") : undefined });
  const result = h.request();
  await new Promise(setImmediate);
  assert.equal(h.timers.length, 1);
  expired = true;
  h.timers[0]();
  assert.equal(await (await result).text(), "available offline");
  assert.deepEqual(h.cleared, [1]);
  resolveNetwork(new Response("late"));
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  assert.equal(h.writes.length, 0);
});

test("worker concurrent requests do not clear each other's timeout", async () => {
  const pending = [];
  const h = timeoutHarness({ network: () => new Promise(resolve => pending.push(resolve)) });
  const first = h.request(), second = h.request({ path: "assets/second.png" });
  await new Promise(setImmediate);
  pending[0](new Response("first"));
  assert.equal(await (await first).text(), "first");
  assert.deepEqual(h.cleared, [1]);
  h.timers[1]();
  assert.equal((await second).type, "error");
  assert.deepEqual(h.cleared, [1, 2]);
  pending[1](new Response("late"));
  await new Promise(setImmediate);
  assert.equal(h.writes.length, 1);
});

test("worker cached page returns immediately, refreshes in background and allocates no timer", async () => {
  const h = timeoutHarness({ cached: () => new Response("cached") });
  assert.equal(await (await h.request({ html: true })).text(), "cached");
  await new Promise(setImmediate);
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.writes[0].body, "fresh");
  assert.equal(h.matches[0].options.ignoreSearch, true);
});

test("worker offline navigation may use the existing HTML shell; assets may not", async () => {
  for (const html of [true, false]) {
    const h = timeoutHarness({ network: async () => { throw Error("offline"); },
      cached: request => request === "./index.html" ? new Response("shell") : undefined });
    const result = await h.request({ html });
    assert.equal(html ? await result.text() : result.type, html ? "shell" : "error");
  }
});

test("worker non-GET and cross-origin requests never allocate timers or network calls", () => {
  const h = timeoutHarness();
  assert.equal(h.request({ method: "POST" }), undefined);
  assert.equal(h.request({ path: "https://www.primserv.pl/" }), undefined);
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls.length, 0);
});
