// Общие помощники автотестов: воркер, подделка D1 на node:sqlite, подделка R2, клиент запросов.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PM = createRequire(import.meta.url)(path.join(root, "public/_editor/render.js"));

// Воркер — ES-модуль с импортом CJS-файла; копируем во временную папку с исправленным путём и экспортом помощников.
export async function loadWorker() {
  const dir = path.join(root, "tests/.build");
  fs.mkdirSync(dir, { recursive: true });
  const src = fs.readFileSync(path.join(root, "src/worker.js"), "utf8")
    .replace('"../public/_editor/render.js"', '"../../public/_editor/render.js"') + "\nexport { buildMime, mailProvider };\n";
  const f = path.join(dir, "worker.mjs");
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href + "?v=" + Date.now());
}

export function makeEnv(extra = {}) {
  const sq = new DatabaseSync(":memory:");
  const mk = (sql, args = []) => ({
    bind: (...a) => mk(sql, a),
    first: async () => sq.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sq.prepare(sql).all(...args) }),
    run: async () => { const r = sq.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
  });
  const DB = { prepare: (s) => mk(s), batch: async (st) => { for (const s of st) await s.run(); return []; } };
  const objects = new Map();
  const MEDIA = { put: async (k, body) => { objects.set(k, await new Response(body).arrayBuffer()); }, delete: async (k) => { objects.delete(k); }, get: async () => null };
  const jobs = [];
  const ctx = { waitUntil: (p) => jobs.push(p) };
  const env = { DB, MEDIA, ADMIN_TOKEN: "tok", ADMIN_PATH: "sec", ASSETS: { fetch: async () => new Response("asset") }, ...extra };
  return { env, sq, objects, jobs, ctx, flush: () => Promise.all(jobs.splice(0)) };
}

// Клиент: api("PUT", "/api/admin/config", {...}) → { status, json, text }
export function client(worker, h) {
  return async (method, p, body, o = {}) => {
    const bin = body instanceof Uint8Array;
    const headers = { ...(o.token === null ? {} : { "x-admin-token": o.token || "tok" }), ...(bin ? {} : { "content-type": "application/json" }), "CF-Connecting-IP": o.ip || "1.1.1.1", ...(o.headers || {}) };
    if (bin) headers["content-length"] = String(body.length);
    const r = await worker.default.fetch(new Request("http://x" + p, { method, headers, body: body === undefined ? undefined : bin ? body : JSON.stringify(body) }), o.env || h.env, h.ctx);
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
}

export async function setup(extra) {
  const worker = await loadWorker();
  const h = makeEnv(extra);
  return { worker, h, api: client(worker, h), PM };
}

export const cfg = () => JSON.parse(JSON.stringify(PM.DEFAULT_CONFIG));
// Страница с формой связи (поле email + кнопка «Отправить» формы contact)
export function contactDoc(opts = {}) {
  const doc = PM.newDoc();
  const em = PM.newControl("input", "en"); em.p.fmt = "email"; em.p.req = true; em.p.name = "email";
  const msg = PM.newControl("textarea", "en"); msg.p.name = "msg";
  const bt = PM.newControl("button", "en"); bt.p.btn.action = "submit"; bt.p.btn.form = "contact";
  doc.root.children.push(em, msg, bt);
  return doc;
}
