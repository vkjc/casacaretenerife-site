// Безопасность: утечки, перебор пароля, размеры, заголовки, кэш, фильтрация значений
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, PM, cfg, contactDoc } from "./helpers.mjs";

test("ошибка сервера не раскрывает внутренности", async () => {
  const { worker, h } = await setup();
  h.env.DB = { prepare: () => { throw new Error("SECRET internal path /db/xyz"); }, batch: async () => { throw new Error("SECRET"); } };
  const origErr = console.error; console.error = () => {};
  try {
    const r = await worker.default.fetch(new Request("http://x/api/catalog"), h.env, h.ctx);
    assert.equal(r.status, 500);
    assert.doesNotMatch(await r.text(), /SECRET|xyz|detail/);
  } finally { console.error = origErr; }
});

test("перебор пароля админки: после 8 неудач адрес блокируется, верный пароль с другого адреса работает", async () => {
  const { api } = await setup();
  for (let i = 0; i < 8; i++) assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: "wrong" + i, ip: "9.9.9.9" })).status, 401);
  let r = await api("GET", "/api/admin/bootstrap", undefined, { token: "wrong", ip: "9.9.9.9" });
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "600");
  assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: "tok", ip: "9.9.9.9" })).status, 429); // даже верный, пока блок
  assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: "tok", ip: "8.8.8.8" })).status, 200);
});

test("сравнение секретов: пустой, длинный и похожий токены не проходят", async () => {
  const { api } = await setup();
  assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: null })).status, 401); // заголовка нет совсем
  for (const t of ["to", "tokk", "t".repeat(5000), "TOK"]) assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: t, ip: "2.2.2." + (t.length % 200) })).status, 401);
  assert.equal((await api("GET", "/api/admin/bootstrap")).status, 200);
});

test("публичная форма: большое тело отклоняется до чтения", async () => {
  const { api, worker, h } = await setup();
  const r = await worker.default.fetch(new Request("http://x/api/submit", { method: "POST", headers: { "content-length": "5000000", "content-type": "application/json" }, body: "{}" }), h.env, h.ctx);
  assert.equal(r.status, 413);
});

test("заголовки безопасности на публичной странице, редакторе и медиа", async () => {
  const { api, worker, h } = await setup();
  const doc = contactDoc();
  const id = (await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc })).json.id;
  await api("POST", `/api/admin/pages/${id}/publish`, { html: PM.page(doc, PM.DEFAULT_CONFIG, { slug: "index" }), meta: { forms: PM.formsMeta(doc, []).forms } });
  const page = await worker.default.fetch(new Request("http://x/"), h.env, h.ctx);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(page.headers.get("content-security-policy-report-only"), /default-src 'self'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  const ed = await worker.default.fetch(new Request("http://x/s/sec/"), h.env, h.ctx);
  assert.equal(ed.headers.get("referrer-policy"), "no-referrer");
  assert.equal(ed.headers.get("x-frame-options"), "DENY");
  assert.match(ed.headers.get("x-robots-tag"), /noindex/);
  assert.equal((await api("GET", "/api/admin/bootstrap")).headers.get("x-content-type-options"), "nosniff");
});

test("каталог: строка запроса не обходит кэш", async () => {
  const { worker, h } = await setup();
  const store = new Map(), keys = [];
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v && v.clone(); }, put: async (r, res) => { keys.push(r.url); store.set(r.url, res); } } };
  try {
    for (const q of ["", "?a=1", "?a=2&b=3"]) {
      const r = await worker.default.fetch(new Request("http://x/api/catalog" + q), h.env, h.ctx);
      assert.equal(r.status, 200); await r.text(); await h.flush();
    }
    assert.deepEqual([...new Set(keys)], ["http://x/api/catalog"]);
    assert.equal(keys.length, 1, "после первого запроса остальные берутся из кэша");
  } finally { delete globalThis.caches; }
});

test("витрина: пропорция и вписывание фильтруются, текст экранируется", () => {
  const cat = { fields: [{ key: "name", type: "text", label: { en: "Name" }, opts: [] }], products: [{ id: 1, data: { name: { en: '<img src=x onerror=alert(1)>"' } }, media: [{ src: "javascript:alert(1)", type: "image" }, { src: "https://ok.example/a.jpg", type: "image" }] }] };
  const cfg = PM.newShowcase("en").p;
  cfg.ratio = '4/3;background:url(https://evil.example/x)'; cfg.fit = "x\" onload=\"alert(1)";
  cfg.fields = [{ k: "name", role: "title" }];
  const html = PM.SC.cards(cfg, cat, { lang: "en", def: "en" });
  assert.doesNotMatch(html, /evil\.example|onload=|<img src=x|javascript:/);
  assert.match(html, /aspect-ratio:4\/3/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /https:\/\/ok\.example\/a\.jpg/);
});

test("страница: опасные ссылки, цвета и значения отфильтрованы", () => {
  const d = PM.newDoc(), m = PM.newMedia(), t = PM.newText("en", "</script><script>alert(1)</script>");
  m.p.click = { action: "link", url: "javascript:alert(1)" };
  m.items.push(PM.newItem("javascript:alert(1)"), PM.newItem("//evil.example/x.jpg"));
  t.paras[0].s.color = "red;background:url(//evil)"; t.paras[0].tip = { en: '"><script>alert(2)</script>' };
  d.root.children.push(m, t);
  const html = PM.page(d, PM.DEFAULT_CONFIG, { title: "</title><script>alert(3)</script>" });
  const body = html.split('<script type="application/json"')[0];
  assert.doesNotMatch(body, /<script>alert|javascript:|evil/);
  assert.equal((html.match(/<script>alert/g) || []).length, 0);
  // словарь переводов внутри <script type=json> не может закрыть тег
  const json = html.split('id="pm-i18n">')[1].split("</script>")[0];
  assert.doesNotMatch(json, /</);
});

test("админ: очистка старых заявок по сроку хранения", async () => {
  const { api, h } = await setup();
  await api("GET", "/api/admin/bootstrap");
  const ins = h.sq.prepare("INSERT INTO submissions (slug, form, lang, data, ip_hash, created) VALUES ('index','contact','en','{}','h',?)");
  ins.run(Date.now() - 400 * 86_400_000); ins.run(Date.now() - 10 * 86_400_000);
  assert.equal((await api("DELETE", "/api/admin/submissions")).status, 400);
  assert.equal((await api("DELETE", "/api/admin/submissions?olderThanDays=365")).status, 200);
  assert.equal((await api("GET", "/api/admin/submissions")).json.submissions.length, 1);
});
