import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, PM, cfg, contactDoc } from "./helpers.mjs";

test("доступ: без токена 401, редактор только по секретному пути", async () => {
  const { api, worker, h } = await setup();
  assert.equal((await api("GET", "/api/admin/bootstrap", undefined, { token: "bad" })).status, 401);
  const get = (p) => worker.default.fetch(new Request("http://x" + p), h.env, h.ctx);
  assert.equal((await get("/s/wrong/")).status, 404);
  assert.equal((await get("/s/sec")).status, 301);              // без слэша — редирект
  assert.equal((await get("/_editor/editor.js")).status, 404);  // прямой доступ закрыт
  assert.equal((await get("/s/sec/editor.js")).status, 200);
});

test("настройки: проверка и миграция конфига фазы 1 до текущей версии", async () => {
  const { api, h } = await setup();
  h.sq.exec("CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  const old = { siteTitle: "Old", maxDepth: 4, compat: { grid: ["grid", "text", "media"] }, defaultLang: "en", langs: [{ code: "en", name: "English", dir: "ltr" }] };
  h.sq.prepare("INSERT INTO settings VALUES ('config', ?)").run(JSON.stringify(old));
  const b = (await api("GET", "/api/admin/bootstrap")).json;
  assert.equal(b.config.ver, PM.DEFAULT_CONFIG.ver);
  for (const t of ["control", "lang", "showcase"]) assert.ok(b.config.compat.grid.includes(t), t);
  assert.deepEqual(b.config.notify, { to: [], subject: "" });
  const c = b.config;
  assert.equal((await api("PUT", "/api/admin/config", { ...c, defaultLang: "zz" })).status, 400);
  assert.equal((await api("PUT", "/api/admin/config", { ...c, notify: { to: ["not-an-email"], subject: "" } })).status, 400);
  assert.equal((await api("PUT", "/api/admin/config", { ...c, turnstileSiteKey: "<script>" })).status, 400);
  assert.equal((await api("PUT", "/api/admin/config", { ...c, maxDepth: 9 })).status, 400);
  assert.equal((await api("PUT", "/api/admin/config", c)).status, 200);
});

test("страницы: глубина, матрица совместимости, дубли адреса, версии", async () => {
  const { api } = await setup();
  const doc = PM.newDoc();
  let r = await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc });
  assert.equal(r.status, 200);
  const id = r.json.id;
  assert.equal((await api("POST", "/api/admin/pages", { slug: "index", title: "Dup", doc })).status, 409);
  // глубже лимита (maxDepth 4 по умолчанию)
  let g = PM.newGrid(), cur = g;
  for (let i = 0; i < 4; i++) { const n = PM.newGrid(); cur.children.push(n); cur = n; }
  const deep = PM.newDoc(); deep.root.children.push(g);
  r = await api("PUT", `/api/admin/pages/${id}`, { title: "Home", doc: deep });
  assert.equal(r.status, 400); assert.match(r.json.error, /nesting/);
  // матрица: запретим сетку в сетке
  const c = (await api("GET", "/api/admin/bootstrap")).json.config;
  c.compat.grid = ["text"];
  await api("PUT", "/api/admin/config", c);
  const nested = PM.newDoc(); nested.root.children.push(PM.newGrid());
  assert.equal((await api("PUT", `/api/admin/pages/${id}`, { title: "Home", doc: nested })).status, 400);
  const ok = PM.newDoc(); ok.root.children.push(PM.newText("en", "hi"));
  assert.equal((await api("PUT", `/api/admin/pages/${id}`, { title: "Home", doc: ok })).status, 200);
  assert.equal((await api("GET", `/api/admin/pages/${id}/versions`)).json.versions.length, 1); // не чаще раза в 5 минут
  assert.equal((await api("DELETE", `/api/admin/pages/${id}`)).status, 400); // главную удалять нельзя
});

test("публикация: готовый HTML отдаётся по адресу, окна не публикуются сами", async () => {
  const { api, worker, h } = await setup();
  const doc = contactDoc();
  const idx = (await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc })).json.id;
  const win = (await api("POST", "/api/admin/pages", { slug: "thanks", title: "Thanks", type: "modal", doc: PM.newDoc({ modal: true }) })).json.id;
  const html = PM.page(doc, PM.DEFAULT_CONFIG, { slug: "index", modals: [] });
  const fm = PM.formsMeta(doc, []);
  assert.equal((await api("POST", `/api/admin/pages/${win}/publish`, { html, meta: { forms: fm.forms } })).status, 400);
  assert.equal((await api("POST", `/api/admin/pages/${idx}/publish`, { html, meta: { forms: { "bad name!": [] } } })).status, 400);
  assert.equal((await api("POST", `/api/admin/pages/${idx}/publish`, { html, meta: { forms: fm.forms } })).status, 200);
  const r = await worker.default.fetch(new Request("http://x/"), h.env, h.ctx);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /pm-i18n/);
  assert.equal((await worker.default.fetch(new Request("http://x/nope"), h.env, h.ctx)).status, 404);
});
