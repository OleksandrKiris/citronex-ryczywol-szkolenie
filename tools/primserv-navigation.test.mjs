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

const readerLocationCustom = await fs.readFile(new URL("assets/js/location-custom.js", root), "utf8");
const instructionUpdate = await fs.readFile(new URL("assets/js/instruction-update.js", root), "utf8");
function readerHarness({lang="en", url="", blockedHistory=false, blockedStorage=false}={}) {
  const location = new URL(url || `https://example.test/training/reader.html?lang=${lang}&mode=fixture&from=qa#instructions`);
  let buttons = [];
  const document = { documentElement: {}, body: { dataset: { page: "reader" } }, currentScript: { src: "https://example.test/training-app.js?v=fixture" } };
  const app = { html: "", set innerHTML(value) {
    if (buttons.includes(document.activeElement)) document.activeElement = document.body;
    this.html = value;
    buttons = [...value.matchAll(/<button\b([^>]*\bdata-reader-tab="[^"]*"[^>]*)>/g)].map(([,attrs]) => {
      const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value]) => [key,value]));
      return { attributes, dataset: { readerTab: attributes["data-reader-tab"] }, handlers: {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
        focus(options) { document.activeElement = this; this.focusOptions = options; } };
    });
  }, get innerHTML() { return this.html; }, querySelectorAll(selector) { return selector === "[data-reader-tab]" ? buttons : []; } };
  document.getElementById = id => id === "app" ? app : null;
  const window = {};
  const historyCalls = [];
  const storage = { getItem() { if (blockedStorage) throw Error("Storage denied"); return ""; }, setItem() { if (blockedStorage) throw Error("Storage denied"); } };
  const forbidden = () => { throw Error("Network and operational actions forbidden"); };
  const context = vm.createContext({ window, document, location, URL, URLSearchParams, navigator: {language:lang}, localStorage:storage,
    history: { state: { preserve: true }, replaceState(state, title, url) {
      if (blockedHistory) throw Error("History denied");
      assert.equal(state.preserve, true);
      historyCalls.push(url.toString()); location.href = url.toString();
    } }, fetch: forbidden, open: forbidden });
  vm.runInContext(data, context);
  vm.runInContext(readerLocationCustom, context);
  vm.runInContext(instructionUpdate, context);
  const original = JSON.stringify(window.CX_DATA);
  const instrumentedReader = source.replace(/  renderPage\(\);\n  upgradeCache\(\);\n\}\)\(\);\s*$/, "  window.readerTest = { renderReader, reloadWithLanguage };\n})();");
  assert.notEqual(instrumentedReader, source);
  vm.runInContext(instrumentedReader, context);
  window.readerTest.renderReader();
  return { location, document, app, historyCalls, api:window.readerTest, get buttons(){return buttons;},
    get selected(){return buttons.find(b => b.attributes["aria-pressed"] === "true");},
    click(id) { const b = buttons.find(b => b.dataset.readerTab === id); assert.ok(b); b.focus(); b.handlers.click(); assert.equal(JSON.stringify(window.CX_DATA), original); }
  };
}

for (const lang of ["pl","en","ua","ru","az","es","fil","id","ne"]) test(`${lang}: reader selection survives reload and language change with keyboard focus intact`, () => {
  const h = readerHarness({lang});
  for (const id of h.buttons.map(b => b.dataset.readerTab)) {
    h.click(id);
    assert.equal(h.selected.dataset.readerTab, id);
    assert.equal(h.document.activeElement, h.selected);
    assert.equal(h.selected.focusOptions.preventScroll, true);
    assert.equal(h.location.searchParams.get("topic"), id);
    assert.equal(h.location.searchParams.get("mode"), "fixture");
    assert.equal(h.location.searchParams.get("from"), "qa");
    assert.equal(h.location.hash, "#instructions");
    assert.equal(readerHarness({url:h.location.href}).selected.dataset.readerTab, id);
    assert.equal(h.buttons.filter(b => b.attributes["aria-pressed"] === "true").length, 1);
  }
  h.api.reloadWithLanguage(lang === "ua" ? "en" : "ua");
  assert.equal(readerHarness({url:h.location.href}).selected.dataset.readerTab, h.selected.dataset.readerTab);
  assert.equal(h.historyCalls.length, h.buttons.length, "Replace one entry per selection; do not add Back steps");
});
test("reader rejects unknown URL topics without injecting query values", () => {
  const h = readerHarness({url:"https://example.test/reader.html?lang=en&topic=%3Cscript%3Ebad-topic%3C/script%3E"});
  assert.equal(h.selected.dataset.readerTab, "prepare");
  assert.ok(!h.app.html.includes("bad-topic"));
});
test("reader controls and language context work when history and storage are denied", () => {
  const h = readerHarness({blockedHistory:true, blockedStorage:true});
  assert.doesNotThrow(() => h.click("carts"));
  assert.equal(h.document.activeElement, h.selected);
  h.api.reloadWithLanguage("ua");
  assert.equal(h.location.searchParams.get("topic"), "carts");
  assert.equal(readerHarness({url:h.location.href}).selected.dataset.readerTab, "carts");
});
test("reader focus stays on the next control when navigating sections with the keyboard", () => {
  const h = readerHarness();
  h.click("start");
  h.click("restart");
  h.click("rows");
  assert.equal(h.document.activeElement.dataset.readerTab, "rows");
  assert.equal(readerHarness({url:h.location.href}).selected.dataset.readerTab, "rows");
});


// These scenarios run real contact rendering/handlers, without opening contact links.
function contactHarness({lang="en", group="", blocked=false, blockedHistory=false, url=""}={}) {
  const location=new URL(url || `https://example.test/training/kontakty.html?lang=${lang}&mode=bogatynia&section=fixture${group?'&group='+encodeURIComponent(group):''}#contacts`);
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  let buttons=[];
  const document={documentElement:{},body:{dataset:{page:'kontakty'}},currentScript:{src:'https://example.test/training-app.js?v=fixture'}};
  const app={html:'',set innerHTML(value){
    if(buttons.includes(document.activeElement))document.activeElement=document.body;
    this.html=value;
    buttons=[...value.matchAll(/<button\b([^>]*\bdata-contact-group="[^"]*"[^>]*)>/g)].map(([,attrs])=>{
      const attributes=Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,decode(v)]));
      return {attributes,dataset:{contactGroup:attributes['data-contact-group']},handlers:{},
        addEventListener(type,handler){this.handlers[type]=handler;},focus(){document.activeElement=this;}};
    });
  },get innerHTML(){return this.html;},querySelectorAll(){return buttons;}};
  document.getElementById=id=>id==='app'?app:null;
  const storage={getItem(){if(blocked)throw Error('Storage blocked');return '';},setItem(){if(blocked)throw Error('Storage blocked');}};
  const window={};
  const forbidden=()=>{throw Error('Contact/network actions forbidden');};
  const c=vm.createContext({window,document,location,URL,URLSearchParams,localStorage:storage,navigator:{language:'en'},
    history:{state:{keep:true},replaceState(state,_title,value){if(blockedHistory)throw Error('History blocked');assert.equal(state.keep,true);location.href=value.toString();}},fetch:forbidden,open:forbidden});
  vm.runInContext(data,c);
  const custom=new URL('assets/js/location-custom.js',root);
  return fs.readFile(custom,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '';}).then(customSource=>{
    if(customSource)vm.runInContext(customSource,c);
    const original=JSON.stringify(window.CX_DATA);
    const instrumentedContacts=source.replace(/  renderPage\(\);\n  upgradeCache\(\);\n\}\)\(\);\s*$/,'  window.contactsTest = { renderContacts, reloadWithLanguage };\n})();');
    assert.notEqual(instrumentedContacts,source);
    vm.runInContext(instrumentedContacts,c);
    window.contactsTest.renderContacts();
    return {location,document,app,api:window.contactsTest,get buttons(){return buttons;},
      get selected(){return buttons.find(button=>button.attributes.class.split(/\s+/).includes('active'));},
      click(id){const button=buttons.find(b=>b.dataset.contactGroup===id);assert.ok(button);button.focus();button.handlers.click();assert.equal(JSON.stringify(window.CX_DATA),original);}};
  });
}

test('confirmed Ryczywół accommodation contact renders direct call and WhatsApp actions in all languages', async () => {
  for (const lang of ['pl','en','ua','ru','az','es','fil','id','ne']) {
    const h = await contactHarness({lang});
    assert.ok(h.app.html.includes('Dmytro (Dima)'));
    assert.ok(h.app.html.includes('href="tel:+48511472583"'));
    assert.ok(h.app.html.includes('https://wa.me/48511472583'));
    assert.ok(!h.app.html.includes('536110591'));
    assert.ok(!h.app.html.includes('Liudmyla'));
    assert.ok(h.app.html.includes('Maksym Saliuk'));
  }
});

for(const lang of ['pl','en','ua','ru','az','es','fil','id','ne'])test(`${lang}: contact selection survives language change and page return with focus intact`,async()=>{
  const h=await contactHarness({lang});
  const target=h.buttons.find(b=>b.dataset.contactGroup!=='coordinators').dataset.contactGroup;
  h.click(target);
  assert.equal(h.selected.dataset.contactGroup,target);
  assert.equal(h.document.activeElement,h.selected,'Focus must return to the new selected button');
  assert.equal(h.location.searchParams.get('group'),target);
  assert.equal(h.location.searchParams.get('section'),'fixture');
  assert.equal(h.location.searchParams.get('mode'),'bogatynia');
  assert.equal(h.location.hash,'#contacts');
  h.api.reloadWithLanguage(lang==='ua'?'en':'ua');
  const next=await contactHarness({url:h.location.href});
  assert.equal(next.selected.dataset.contactGroup,target);
  assert.equal(next.buttons.filter(b=>b.attributes['aria-pressed']==='true').length,1);
  assert.equal(next.selected.attributes['aria-pressed'],'true');
});
test('each real contact group supports a direct URL and selection state',async()=>{
  const h=await contactHarness();
  for(const b of h.buttons){const next=await contactHarness({group:b.dataset.contactGroup});assert.equal(next.selected.dataset.contactGroup,b.dataset.contactGroup);assert.equal(next.selected.attributes['aria-pressed'],'true');}
});
test('unknown contact group uses the existing default without inserting query content',async()=>{
  const h=await contactHarness({group:'<script>invalid-group</script>'});
  assert.equal(h.selected.dataset.contactGroup,'coordinators');
  assert.equal(h.app.html.includes('invalid-group'),false);
});
test('denied storage/history keep contact controls and language context usable',async()=>{
  const h=await contactHarness({blocked:true,blockedHistory:true});
  const target=h.buttons.find(b=>b.dataset.contactGroup!=='coordinators').dataset.contactGroup;
  assert.doesNotThrow(()=>h.click(target));
  assert.equal(h.document.activeElement,h.selected);
  h.api.reloadWithLanguage('ua');
  assert.equal(h.location.searchParams.get('group'),target);
  assert.equal((await contactHarness({url:h.location.href,blocked:true})).selected.dataset.contactGroup,target);
});

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
    assert.ok(html.includes("assets/js/training-app.js?v=20261017-glossary-context2"), file);
    assert.ok(html.includes("assets/css/primserv.css?v=20261016-progress1"), file);
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
      async match(request) { return (request.url.includes("primserv") || request.url.includes("20261017-glossary-context2") || request.url.includes("20261016-language1") || request.url.includes("20261016-housing-contact1")) ? null : new Response("old valid asset"); },
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
  assert.ok(w.added.some(url => url.endsWith("/assets/js/location-custom.js?v=20261016-housing-contact1")));
  assert.ok(w.added.some(url => url.endsWith("/index.html")));
  assert.ok(w.added.some(url => url.endsWith("/manifest.webmanifest")));
  assert.ok(w.added.some(url => url.endsWith("/assets/js/training-app.js?v=20261017-glossary-context2")));
  assert.ok(w.added.some(url => url.endsWith("/assets/js/instruction-update.js?v=20261016-language1")));
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

const speechSource = source.replace(/  renderPage\(\);\n  upgradeCache\(\);\n\}\)\(\);\s*$/, "  window.speechTest = { renderSpeech };\n})();");
assert.notEqual(source, speechSource);
const decodeAttribute = value => value.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function speechHarness(lang) {
  const groups = [];
  const search = { value: "", addEventListener(_type, handler) { this.input = handler; } };
  const empty = { hidden: true };
  const status = {};
  const app = {
    addEventListener() {},
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<details class="[^"]*speech-group"([^>]*)data-group-id="([^"]+)"/g)) {
        const group = { dataset: { groupId: match[2] }, open: /\bopen\b/.test(match[1]), hidden: false, cards: [],
          addEventListener(_type, handler) { this.toggle = handler; },
          querySelector: () => list,
          querySelectorAll: () => group.cards
        };
        const list = { set innerHTML(value) {
          group.cards = [...value.matchAll(/data-key="([^"]*)"/g)].map(m => ({ dataset: { key: decodeAttribute(m[1]) }, hidden: false }));
        } };
        groups.push(group);
      }
    },
    querySelector(selector) { return ({ '#speechSearch': search, '.speech-empty': empty, '#speechStatus': status })[selector] || null; },
    querySelectorAll: () => groups
  };
  const document = { documentElement: {}, body: { dataset: { page: 'mowa' } }, getElementById: () => app,
    activeElement: search, currentScript: { src: 'https://example.invalid/training-app.js?v=fixture' } };
  const window = {};
  const location = new URL(`https://oleksandrkiris.github.io/citronex-ryczywol-szkolenie/mowa.html?lang=${lang}`);
  const forbidden = () => { throw Error('Voice, clipboard, network and navigation actions forbidden'); };
  const context = vm.createContext({ window, document, location, URL, URLSearchParams,
    localStorage: { getItem: () => null }, navigator: { language: lang, clipboard: { writeText: forbidden } },
    fetch: forbidden, open: forbidden, setTimeout: forbidden });
  vm.runInContext(data, context);
  vm.runInContext(custom, context);
  const originalData = JSON.stringify(window.CX_DATA);
  vm.runInContext(speechSource, context);
  window.speechTest.renderSpeech();
  assert.ok(groups.length > 1, 'Use real production phrase groups');
  return { groups, empty, search, app, document, phrases: window.CX_DATA.speechPhrases,
    input(value) { search.value = value; search.input(); assert.equal(document.activeElement, search); assert.equal(JSON.stringify(window.CX_DATA), originalData); },
    expand(group, open) { group.open = open; group.toggle(); },
    flushToggles() { groups.forEach(group => group.toggle()); }
  };
}

for (const lang of langs) {
  test(`${lang}: empty or whitespace search keeps all lazy phrase groups visible`, () => {
    const c = speechHarness(lang);
    const initial = c.groups.map(g => ({ open: g.open, rendered: g.dataset.rendered, count: g.cards.length }));
    for (const query of ['', ' ', '\t \n']) {
      c.input(query);
      assert.ok(c.groups.every(g => !g.hidden));
      assert.deepEqual(c.groups.map(g => ({ open: g.open, rendered: g.dataset.rendered, count: g.cards.length })), initial);
      assert.equal(c.empty.hidden, true);
    }
    c.expand(c.groups[1], true);
    assert.ok(c.groups[1].cards.length > 0, 'Lazy opening still renders phrases');
  });

  test(`${lang}: clearing no-results restores all phrases and the pre-search expanded groups`, () => {
    const c = speechHarness(lang);
    c.expand(c.groups[0], false);
    c.expand(c.groups[1], true);
    const original = c.groups.map(g => g.open);
    c.input('___no_phrase_matches_this___');
    assert.ok(c.groups.every(g => g.hidden));
    assert.equal(c.empty.hidden, false);
    c.input('  ');
    assert.ok(c.groups.every(g => !g.hidden && g.cards.every(card => !card.hidden)));
    assert.deepEqual(c.groups.map(g => g.open), original);
    assert.equal(c.empty.hidden, true);
  });
}

test('Polish and translated phrase matches still filter correctly across consecutive searches', () => {
  const c = speechHarness('ua');
  const phrase = c.phrases.find(p => p.say && p.label.ua);
  const original = c.groups.map(g => g.open);
  for (const query of [phrase.say, phrase.label.ua]) {
    c.input(query.toUpperCase());
    const visible = c.groups.flatMap(g => g.hidden ? [] : g.cards.filter(card => !card.hidden));
    assert.ok(visible.length > 0);
    assert.ok(visible.every(card => card.dataset.key.includes(query.toLowerCase())));
    assert.equal(c.empty.hidden, true);
  }
  c.input('');
  assert.deepEqual(c.groups.map(g => g.open), original);
});

test('a second search remembers the newly chosen group state, not the first snapshot', () => {
  const c = speechHarness('en');
  c.input('___no_match___');
  c.input('');
  c.expand(c.groups[0], false);
  c.expand(c.groups.at(-1), true);
  const selected = c.groups.map(g => g.open);
  c.input(c.phrases[0].say);
  c.input('');
  assert.deepEqual(c.groups.map(g => g.open), selected);
  assert.ok(c.groups.every(g => !g.hidden));
});


test('search keeps every matching group expanded after toggle notifications', () => {
  const c = speechHarness('pl');
  c.expand(c.groups.at(-1), true);
  const before = c.groups.map(g => g.open);
  c.input('proszę');
  const matches = c.groups.filter(g => !g.hidden);
  assert.ok(matches.length > 1, 'Production phrases match multiple sections');
  c.flushToggles();
  assert.ok(matches.every(g => g.open), 'Accordion must not collapse search results');
  c.input('');
  c.flushToggles();
  assert.deepEqual(c.groups.map(g => g.open), before);
});

test('outside search the existing single-open-section behavior remains', () => {
  const c = speechHarness('pl');
  c.expand(c.groups[0], true);
  c.expand(c.groups[1], true);
  assert.equal(c.groups[0].open, false);
  assert.equal(c.groups[1].open, true);
  assert.equal(c.groups.filter(g => g.open).length, 1);
});

const expectedLanguageLabels = ['Język','Language','Мова','Язык','Dil','Idioma','Wika','Bahasa','भाषा'];
const expectedReturnLabels = ['Wszystkie sekcje','All sections','Усі розділи','Все разделы','Bütün bölmələr','Todas las secciones','Lahat ng seksyon','Semua bagian','सबै खण्डहरू'];
langs.forEach((lang,index) => test(`${lang}: language picker and return control use the same clear training labels`, () => {
  const h=header(lang,'reader');
  assert.ok(h.html.includes('id="langSelect" aria-label="'+expectedLanguageLabels[index]+'"'));
  assert.ok(h.html.includes(expectedReturnLabels[index]));
  assert.match(h.html,/<option value="id"[^>]*>Bahasa Indonesia<\/option>/);
}));

for (const lang of langs) test(`${lang}: quiz uses this location's medical section, not Siechnice clinic hours`, () => {
  const {window} = header(lang,'test');
  const D = window.CX_DATA;
  const question = D.test[14];
  assert.equal(question.ok,true);
  assert.ok(question.text[lang].includes(D.pages.lekarz.title[lang]));
  assert.ok(question.text[lang].includes('Ryczywół'));
  assert.doesNotMatch(question.text[lang], /Siechnice|8:00|८:००/);
});
test('location correction preserves the other 29 questions, answer keys and original teaching data', () => {
  const original = {window:{}}; vm.createContext(original); vm.runInContext(data, original);
  const expected = JSON.parse(JSON.stringify(original.window.CX_DATA.test));
  vm.runInContext(custom, original);
  const actual = JSON.parse(JSON.stringify(original.window.CX_DATA.test));
  assert.equal(actual.length,30);
  actual.forEach((question,index)=>{
    assert.equal(question.ok,expected[index].ok);
    if(index !== 14) assert.deepEqual(question,expected[index]);
  });
});
test('every production page loads the corrected location module before the renderer', async () => {
  for(const file of (await fs.readdir(root)).filter(p=>p.endsWith('.html'))) {
    const html=await fs.readFile(new URL(file,root),'utf8');
    if(!html.includes('training-app.js'))continue;
    assert.ok(html.includes('location-custom.js?v=20261016-housing-contact1'),file);
    assert.ok(html.indexOf('location-custom.js') < html.indexOf('training-app.js'),file);
  }
});

function fullscreenFixture(languageIndex = 0) {
  const handlers = {}, controls = [], copies = [];
  let modal;
  const document = {activeElement: null, addEventListener(type, handler) {handlers[type] = handler;}};
  function element() {
    const classes = new Set(), attributes = {}, listeners = {};
    return {
      dataset: {}, isConnected: true, attributes, listeners,
      classList: {add(v) {classes.add(v);}, remove(v) {classes.delete(v);}, contains(v) {return classes.has(v);}},
      setAttribute(name, value) {attributes[name] = value;}, removeAttribute(name) {delete attributes[name];},
      addEventListener(type, handler) {listeners[type] = handler;},
      focus() {document.activeElement = this;}, getClientRects() {return [{}];},
      closest() {return null;}, appendChild() {}, remove() {}
    };
  }
  const close = element(), inside = element(), hidden = element(), content = element();
  hidden.getClientRects = () => [];
  controls.push(close, inside, hidden);
  const schema = element();
  const step = {querySelector: () => schema, cloneNode() {
    const copySchema = element();
    ['role','tabindex','aria-label','title'].forEach(name => copySchema.setAttribute(name, 'copied'));
    copies.push(copySchema);
    return {querySelectorAll(selector) {return selector === '.schema[role="button"]' ? [copySchema] : [];}};
  }};
  document.body = element();
  document.querySelectorAll = () => [step];
  document.querySelector = () => null;
  document.createElement = tag => {
    if (tag !== 'div') return element();
    modal = element();
    modal.querySelector = selector => selector === '.orientation-modal-close' ? close : content;
    modal.querySelectorAll = () => controls;
    modal.contains = node => controls.includes(node);
    return modal;
  };
  const start = source.indexOf('  function setupGreenhouseFullscreen()');
  const end = source.indexOf('  function readerTabButton', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({document, text: v => v, tx: (...values) => values[languageIndex], esc: v => v, setupGreenhouseNavePicker() {}});
  vm.runInContext(source.slice(start, end) + '\nsetupGreenhouseFullscreen();', context);
  function event(key, target = schema, shiftKey = false) {
    return {key, target, shiftKey, prevented: false, preventDefault() {this.prevented = true;}};
  }
  function key(value, shiftKey = false) {
    const e = event(value, document.activeElement, shiftKey);handlers.keydown(e);return e;
  }
  return {document, modal, schema, close, inside, copies, controls, key,
    open(method = 'click') {
      const e = event(method === 'click' ? '' : method);
      schema.listeners[method === 'click' ? 'click' : 'keydown'](e);
      return e;
    }};
}

langs.forEach((lang, index) => test(`${lang}: full-screen diagram has a localized name and returns to its originating diagram`, () => {
  for (const method of ['click','Enter',' ']) {
    const f = fullscreenFixture(index);
    const e = f.open(method);
    assert.equal(f.modal.classList.contains('is-open'), true);
    assert.equal(f.document.activeElement, f.close);
    assert.equal(f.modal.attributes['aria-label'], f.schema.attributes['aria-label']);
    assert.ok(f.modal.attributes['aria-label']);
    assert.deepEqual(Object.keys(f.copies[0].attributes), []);
    if (method !== 'click') assert.equal(e.prevented, true);
    f.close.listeners.click();
    assert.equal(f.document.activeElement, f.schema);
    assert.equal(f.modal.attributes['aria-hidden'], 'true');
  }
}));
test('diagram Tab stays within visible controls in both directions and recovers escaped focus', () => {
  const f = fullscreenFixture();f.open();
  assert.equal(f.key('Tab', true).prevented, true);
  assert.equal(f.document.activeElement, f.inside);
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.document.activeElement, f.close);
  assert.equal(f.key('Tab').prevented, false, 'normal navigation between controls is left to the browser');
  f.document.activeElement = f.schema;
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.document.activeElement, f.close);
  f.document.activeElement = f.schema;
  f.key('Tab', true);assert.equal(f.document.activeElement, f.inside);
});
test('Escape and backdrop close restore focus; closed dialog does not capture page keyboard events', () => {
  const f = fullscreenFixture();f.open();
  assert.equal(f.key('Escape').prevented, true);
  assert.equal(f.document.activeElement, f.schema);
  assert.equal(f.key('Tab').prevented, false);
  assert.equal(f.key('Escape').prevented, false);
  f.open();f.modal.listeners.click({target:f.inside});
  assert.equal(f.modal.classList.contains('is-open'), true);
  f.modal.listeners.click({target:f.modal});
  assert.equal(f.document.activeElement, f.schema);
  assert.equal(f.modal.classList.contains('is-open'), false);
});
test('single-control diagram wraps to Close and safely closes after its trigger is removed', () => {
  const f = fullscreenFixture();f.controls.splice(1);f.open();
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.document.activeElement, f.close);
  assert.equal(f.key('Tab', true).prevented, true);
  f.schema.isConnected = false;
  assert.doesNotThrow(() => f.close.listeners.click());
  assert.equal(f.modal.classList.contains('is-open'), false);
});

function glossaryHarness({lang='en', url='', blockedHistory=false, blockedStorage=false}={}) {
  const location = new URL(url || `https://example.test/ryczywol/slownik.html?lang=${lang}&from=fixture#terms`);
  const calls = [];
  const document = {documentElement:{}, body:{dataset:{page:'slownik'}}, currentScript:{src:'https://example.test/training-app.js?v=fixture'}};
  const classes = () => ({hidden:false,toggle(name,on){if(name==='is-hidden')this.hidden=on;}});
  const search = {value:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}};
  const empty = {classList:classes()}; let cards = [], groups = [];
  const app = {html:'',set innerHTML(value) {
    this.html=value; cards=[];
    groups=[...value.matchAll(/<details[^>]*data-glossary-group[^>]*>([\s\S]*?)<\/details>/g)].map(([,body])=>{
      const own=[...body.matchAll(/data-search="([^"]*)"/g)].map(([,key])=>({dataset:{search:key},classList:classes()}));cards.push(...own);
      return {open:false,classList:classes(),handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},querySelector(){return own.find(c=>!c.classList.hidden)||null;}};
    });
  },get innerHTML(){return this.html;},querySelector(s){return s==='[data-glossary-search]'?search:s==='[data-glossary-empty]'?empty:null;},querySelectorAll(s){return s==='[data-glossary-card]'?cards:s==='[data-glossary-group]'?groups:[];}};
  document.getElementById = id => id==='app'?app:null;
  const window={};const forbidden=()=>{throw Error('Network and operational actions forbidden');};
  const localStorage={getItem(){if(blockedStorage)throw Error('denied');return '';},setItem(){if(blockedStorage)throw Error('denied');}};
  const context=vm.createContext({window,document,location,URL,URLSearchParams,navigator:{language:lang},localStorage,fetch:forbidden,open:forbidden,
    history:{state:{keep:true},replaceState(state,title,url){if(blockedHistory)throw Error('denied');assert.equal(state.keep,true);calls.push(String(url));location.href=String(url);}}});
  vm.runInContext(data,context);
  vm.runInContext(custom,context);
  const original=JSON.stringify(window.CX_DATA);
  const instrumented=source.replace(/  renderPage\(\);\n  upgradeCache\(\);\n\}\)\(\);\s*$/, '  window.glossaryTest={renderGlossary,reloadWithLanguage};\n})();');
  assert.notEqual(instrumented,source);vm.runInContext(instrumented,context);
  window.glossaryTest.renderGlossary();
  return {app,search,empty,location,calls,document,api:window.glossaryTest,
    get groups(){return groups;},
    get visible(){return cards.filter(c=>!c.classList.hidden);},
    type(value){document.activeElement=search;search.value=value;search.handlers.input();assert.equal(document.activeElement,search);assert.equal(JSON.stringify(window.CX_DATA),original);}};
}
for(const lang of ['pl','en','ua','ru','az','es','fil','id','ne'])test(`${lang}: glossary query survives language change, reload and browser-return URL`,()=>{
 const h=glossaryHarness({lang});h.type('reader');assert.ok(h.visible.length > 0 && h.visible.length < 54);assert.ok(h.visible.every(c=>c.dataset.search.includes('reader')));
 assert.equal(h.location.searchParams.get('q'),'reader');assert.equal(h.location.hash,'#terms');assert.equal(h.location.searchParams.get('from'),'fixture');
 const returnURL=h.location.href;h.api.reloadWithLanguage(lang==='en'?'ua':'en');
 const next=glossaryHarness({url:h.location.href});assert.equal(next.search.value,'reader');assert.ok(next.visible.length > 0 && next.visible.length < 54);assert.ok(next.visible.every(c=>c.dataset.search.includes('reader')));
 const back=glossaryHarness({url:returnURL});assert.equal(back.search.value,'reader');assert.ok(back.visible.length > 0 && back.visible.length < 54);assert.ok(back.visible.every(c=>c.dataset.search.includes('reader')));
 assert.equal(h.calls.length,1,'uses replaceState once per edit, no extra navigation');
});
test('glossary clearing removes only its query; empty results are announced without changing focus',()=>{
 const h=glossaryHarness();h.type('does-not-exist-xyz');assert.equal(h.visible.length,0);assert.equal(h.empty.classList.hidden,false);
 assert.match(h.app.html,/role="status" data-glossary-empty/);
 h.type('');assert.equal(h.location.searchParams.has('q'),false);assert.equal(h.visible.length,54);assert.equal(h.empty.classList.hidden,true);
 assert.equal(h.location.hash,'#terms');assert.equal(h.location.searchParams.get('from'),'fixture');
});
test('glossary handles unavailable history/storage and still carries current text into language navigation',()=>{
 const h=glossaryHarness({blockedHistory:true,blockedStorage:true});h.type('reader');assert.ok(h.visible.length > 0 && h.visible.length < 54);assert.ok(h.visible.every(c=>c.dataset.search.includes('reader')));assert.equal(h.calls.length,0);
 h.api.reloadWithLanguage('ua');assert.equal(h.location.searchParams.get('q'),'reader');
 h.type('');h.api.reloadWithLanguage('en');assert.equal(h.location.searchParams.has('q'),false);
});
test('glossary URL input is bounded and assigned as a value, never interpolated as markup',()=>{
 const payload='<img src=x onerror=alert(1)>';
 const h=glossaryHarness({url:'https://example.test/slownik.html?lang=en&q='+encodeURIComponent(payload)});
 assert.equal(h.search.value,payload);assert.ok(!h.app.html.includes(payload));assert.equal(h.visible.length,0);
 h.type('x'.repeat(1000));assert.equal(h.search.value.length,160);assert.equal(h.location.searchParams.get('q').length,160);
 assert.equal(glossaryHarness({url:h.location.href}).search.value.length,160);
});
test('glossary query restores with unsupported language fallback and empty legacy URLs',()=>{
 const h=glossaryHarness({url:'https://example.test/slownik.html?lang=ka&q=reader'});
 assert.equal(h.search.value,'reader');assert.ok(h.visible.length > 0 && h.visible.length < 54);assert.ok(h.visible.every(c=>c.dataset.search.includes('reader')));assert.match(h.app.html,/Search a word/);
 const legacy=glossaryHarness();assert.equal(legacy.search.value,'');assert.equal(legacy.visible.length,54);assert.equal(legacy.calls.length,0);
});
test('queued glossary toggle events keep all matching groups open during search',()=>{
 const h=glossaryHarness();h.type('r');
 const matching=h.groups.filter(g=>!g.classList.hidden);assert.ok(matching.length>1);
 for(const g of matching)g.handlers.toggle();
 assert.ok(matching.every(g=>g.open),'accordion must not collapse search matches');
 h.type('reader');for(const g of h.groups)g.handlers.toggle();
 assert.ok(h.groups.filter(g=>!g.classList.hidden).every(g=>g.open));
 h.type('');assert.ok(h.groups.every(g=>!g.open));
 h.groups[0].open=true;h.groups[1].open=true;h.groups[1].handlers.toggle();
 assert.equal(h.groups[0].open,false,'normal accordion behaviour remains with empty search');
 assert.equal(h.groups[1].open,true);
});
