// Site Builder — фаза 1. Один Worker:
//  • отдаёт опубликованные страницы (готовый HTML из D1);
//  • скрытый редактор по адресу /s/<ADMIN_PATH>/ ;
//  • API редактора /api/admin/* (токен в заголовке x-admin-token);
//  • загрузка и раздача медиа через R2 (необязательно).
// HTML страниц собирает БРАУЗЕР при нажатии «Опубликовать» — воркер ничего не рендерит,
// поэтому укладываемся в 10 мс CPU бесплатного плана.

// Общий код: те же правила проверки полей, что исполняет браузер посетителя.
import PM from "../public/_editor/render.js";

const DEFAULT_CONFIG = PM.DEFAULT_CONFIG;
const BLOCK_TYPES = PM.BLOCK_TYPES;
const FIELD_TYPES = ["text", "longtext", "number", "select", "multiselect", "url"];
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const FIELD_KINDS = PM.KINDS.filter((k) => k !== "button" && k !== "menu");
const EMAIL_RE = /^[^\s@<>,;]{1,64}@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
const MAX_DOC = 400_000;      // байт JSON на страницу
const MAX_HTML = 1_500_000;   // байт опубликованного HTML
const MAX_MEDIA = 50 * 1024 * 1024;
const MEDIA_RE = /\/media\/[a-f0-9]{20}\.[a-z0-9]{3,4}/g;
// Какие файлы библиотеки встречаются в документе (для счётчика «используется в N страницах»)
const usedKeys = (text) => [...new Set(text.match(MEDIA_RE) || [])].map((k) => k.slice(7));
const useStmts = (db, pageId, text) => [
  db.prepare("DELETE FROM media_use WHERE page_id=?").bind(pageId),
  db.prepare("INSERT INTO media_use (page_id, key) SELECT ?1, value FROM json_each(?2)").bind(pageId, JSON.stringify(usedKeys(text))),
];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

// Заголовки безопасности страниц. Обязательная часть CSP не может сломать сайт (запрет встраивания, <base>, плагинов, чужих форм);
// строгая политика пока в режиме Report-Only: нарушения видны в консоли браузера, ничего не блокируется.
// Когда на живом сайте нарушений нет, перенесите её в content-security-policy.
const SEC_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "content-security-policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
  "content-security-policy-report-only": "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com",
};

// Сравнение секретов без утечки длины и времени: сравниваем SHA-256 от обеих строк
async function safeEq(a = "", b = "") {
  const h = async (t) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
// Хеш адреса с солью (секрет воркера): адреса нигде не хранятся в открытом виде
async function ipHash(env, ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + (env.ADMIN_TOKEN || "")));
  return [...new Uint8Array(buf)].slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Таблицы создаются один раз на «изолят» воркера: деплой без ручных миграций.
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'page', doc TEXT NOT NULL, updated INTEGER NOT NULL, published_at INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER NOT NULL, doc TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_versions_page ON versions(page_id, id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS published (slug TEXT PRIMARY KEY, html TEXT NOT NULL, updated INTEGER NOT NULL, meta TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, form TEXT NOT NULL, lang TEXT, data TEXT NOT NULL, ip_hash TEXT NOT NULL, created INTEGER NOT NULL, mail TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sub_ip ON submissions(ip_hash, created)"),
    db.prepare("CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE, orig TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, w INTEGER, h INTEGER, dur REAL, tags TEXT NOT NULL DEFAULT '[]', tip TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS media_use (page_id INTEGER NOT NULL, key TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_mu_key ON media_use(key)"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_fail (ip_hash TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_af ON auth_fail(ip_hash, created)"),
    db.prepare("CREATE TABLE IF NOT EXISTS product_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, label TEXT NOT NULL DEFAULT '{}', opts TEXT NOT NULL DEFAULT '[]', req INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL DEFAULT '{}', media TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', pos INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)"),
  ]);
  // База из фазы 1: добавляем колонку meta (на свежей базе она уже есть — ошибку игнорируем)
  try { await db.prepare("ALTER TABLE published ADD COLUMN meta TEXT").run(); } catch (e) { /* уже есть */ }
  try { await db.prepare("ALTER TABLE submissions ADD COLUMN mail TEXT").run(); } catch (e) { /* уже есть */ }
  schemaReady = true;
}

async function getConfig(db) {
  const r = await db.prepare("SELECT v FROM settings WHERE k='config'").first();
  if (!r) return DEFAULT_CONFIG;
  const cfg = JSON.parse(r.v);
  if (!cfg.ver) { // настройки из фазы 1: разрешаем новые блоки внутри сеток
    cfg.ver = 2;
    cfg.compat.grid = [...new Set([...(cfg.compat.grid || []), "control", "lang"])];
  }
  if (cfg.ver < 3) { // капча и письма
    cfg.ver = 3;
    cfg.notify = cfg.notify || { to: [], subject: "" };
    cfg.turnstileSiteKey = cfg.turnstileSiteKey || "";
  }
  if (cfg.ver < 4) { // витрина: разрешаем блок внутри сеток
    cfg.ver = 4;
    cfg.compat.grid = [...new Set([...(cfg.compat.grid || []), "showcase"])];
  }
  return cfg;
}

// ---------- Проверки ----------
function validateConfig(c) {
  if (!c || typeof c !== "object") return "config";
  if (typeof c.siteTitle !== "string" || c.siteTitle.length > 80) return "siteTitle";
  if (!Number.isInteger(c.maxDepth) || c.maxDepth < 1 || c.maxDepth > 8) return "maxDepth (1–8)";
  if (!c.compat || typeof c.compat !== "object") return "compat";
  for (const [k, v] of Object.entries(c.compat)) {
    if (!BLOCK_TYPES.includes(k) || !Array.isArray(v) || v.some((t) => !BLOCK_TYPES.includes(t))) return "compat";
  }
  if (!Array.isArray(c.langs) || c.langs.length < 1 || c.langs.length > 20) return "langs";
  for (const l of c.langs) {
    if (!l || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l.code) || typeof l.name !== "string" || l.name.length > 40 || !["ltr", "rtl"].includes(l.dir)) return "lang entry";
  }
  if (c.turnstileSiteKey !== undefined && !/^[0-9A-Za-z_-]{0,100}$/.test(c.turnstileSiteKey)) return "turnstileSiteKey";
  if (c.notify !== undefined) {
    const n = c.notify;
    if (!n || !Array.isArray(n.to) || n.to.length > 5 || n.to.some((a) => !EMAIL_RE.test(a)) || (n.subject !== undefined && (typeof n.subject !== "string" || n.subject.length > 120))) return "notify";
  }
  if (new Set(c.langs.map((l) => l.code)).size !== c.langs.length) return "duplicate lang";
  if (!c.langs.some((l) => l.code === c.defaultLang)) return "defaultLang";
  return null;
}

// Дерево обязано соблюдать глубину и матрицу совместимости из настроек.
function validateNode(b, depth, parent, cfg, ctr) {
  if (!b || typeof b !== "object" || !/^[a-z0-9]{3,12}$/.test(b.id || "") || !BLOCK_TYPES.includes(b.type)) return "bad block";
  if (++ctr.n > 800) return "too many blocks";
  if (depth > cfg.maxDepth) return `nesting deeper than ${cfg.maxDepth}`;
  if (parent && !(cfg.compat[parent.type] || []).includes(b.type)) return `${parent.type} cannot contain ${b.type}`;
  if (parent && (!b.layout || !b.layout.d || !b.layout.m)) return "no layout";
  if (b.type === "grid") {
    if (!Array.isArray(b.children) || !b.p) return "grid";
    for (const c of b.children) {
      const e = validateNode(c, depth + 1, b, cfg, ctr);
      if (e) return e;
    }
  } else if (b.type === "text") {
    if (!Array.isArray(b.paras) || b.paras.length === 0) return "text";
  } else if (b.type === "media") {
    if (!Array.isArray(b.items) || !b.p || !b.p.frame || !b.p.belt || !b.p.click) return "media";
  } else if (b.type === "control") {
    if (!b.p || !PM.KINDS.includes(b.p.kind) || !b.p.btn || !Array.isArray(b.p.options)) return "control";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(b.p.name || "")) return "control name";
  } else if (b.type === "lang") {
    if (!b.p) return "lang";
  } else if (b.type === "showcase") {
    if (!b.p || !Array.isArray(b.p.fields) || !b.p.inq || !b.p.ui) return "showcase";
  }
  return null;
}
function validateDoc(doc, cfg) {
  if (!doc || doc.v !== 1 || !doc.root || doc.root.type !== "grid") return "doc";
  return validateNode(doc.root, 1, null, cfg, { n: 0 });
}

// Описание форм, пришедшее вместе с HTML: { forms: { имя: [spec,…] } } → строка JSON или null
function validateMeta(meta) {
  if (meta === undefined) return JSON.stringify({ forms: {} });
  if (!meta || typeof meta.forms !== "object" || Array.isArray(meta.forms)) return null;
  const out = {};
  for (const [name, specs] of Object.entries(meta.forms)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || !Array.isArray(specs) || specs.length > 60) return null;
    out[name] = [];
    for (const s of specs) {
      if (!s || !/^[A-Za-z0-9_-]{1,40}$/.test(s.name || "") || !FIELD_KINDS.includes(s.kind) || !PM.FMTS.includes(s.fmt || "text")) return null;
      if (!Array.isArray(s.opts) || s.opts.length > 100 || s.opts.some((o) => typeof o !== "string" || o.length > 200)) return null;
      out[name].push({ name: s.name, kind: s.kind, fmt: s.fmt || "text", req: !!s.req, min: Math.max(0, s.min | 0), max: Math.max(0, s.max | 0), opts: s.opts });
    }
  }
  const text = JSON.stringify({ forms: out });
  return text.length > 100_000 ? null : text;
}

// ---------- Заявки с публичных форм ----------
// Поля проверяются теми же правилами, что в браузере (PM.validateField), по описанию из публикации.
async function submitForm(req, env, ctx) {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (parseInt(req.headers.get("content-length") || "0", 10) > 20_000) return json({ error: "too large" }, 413); // до чтения тела
  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: "too large" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "bad_request" }, 400); }
  if (!b || !/^[a-z0-9-]{1,40}$/.test(b.slug || "") || !/^[A-Za-z0-9_-]{1,40}$/.test(b.form || "") || !b.data || typeof b.data !== "object") return json({ error: "bad_request" }, 400);

  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT meta FROM published WHERE slug=?").bind(b.slug).first();
  const specs = row && row.meta ? JSON.parse(row.meta).forms[b.form] : null;
  if (!specs) return json({ error: "unknown form" }, 404);

  // Лимит: не больше 5 заявок за 10 минут с одного адреса (адрес хранится только в виде хеша)
  const ip = req.headers.get("CF-Connecting-IP") || "?";
  const hash = await ipHash(env, ip);
  const fields = {}, clean = {};
  for (const s of specs) {
    let v = b.data[s.name];
    if (s.kind === "checklist") v = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    else if (s.kind === "consent") v = v === true;
    else v = typeof v === "string" ? v.slice(0, 2000) : "";
    const key = PM.validateField(s, v);
    if (key) fields[s.name] = key;
    else if (!(Array.isArray(v) ? v.length === 0 : v === false || v === "")) clean[s.name] = typeof v === "string" ? v.trim() : v;
  }
  if (specs.some((s) => s.name === "product") && !fields.product) {
    const pid = parseInt(clean.product, 10);
    const pr = Number.isInteger(pid) ? await env.DB.prepare("SELECT data FROM products WHERE id=? AND status='published'").bind(pid).first() : null;
    if (!pr) fields.product = "v.choice";
    else { clean.product = String(pid); const title = await productTitle(env.DB, parseJson(pr.data, {})); if (title) clean.product_title = title; }
  }
  if (Object.keys(fields).length) return json({ error: "validation", fields }, 422);

  const since = Date.now() - 600_000;
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM submissions WHERE ip_hash=? AND created>?").bind(hash, since).first();
  if (cnt.c >= 5) return json({ error: "rate" }, 429);

  // Капча: если задан секрет TURNSTILE_SECRET, заявка без проверенного токена не принимается
  if (env.TURNSTILE_SECRET && !(await verifyTurnstile(env, b.ts, ip))) return json({ error: "captcha" }, 403);

  const r = await env.DB.prepare("INSERT INTO submissions (slug, form, lang, data, ip_hash, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(b.slug, b.form, String(b.lang || "").slice(0, 10), JSON.stringify(clean), hash, Date.now()).run();
  // Письмо уходит после ответа посетителю (waitUntil), результат записывается в заявку
  const job = notifySubmission(env, r.meta.last_row_id, { slug: b.slug, form: b.form, lang: String(b.lang || ""), data: clean, specs });
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  return json({ ok: true });
}

async function verifyTurnstile(env, token, ip) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const f = new FormData();
  f.set("secret", env.TURNSTILE_SECRET);
  f.set("response", token);
  if (ip && ip !== "?") f.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
    return !!(await r.json()).success;
  } catch { return false; }
}

// ---------- Письма о заявках ----------
// Воркер не умеет SMTP, поэтому два пути: Cloudflare Email Routing (привязка EMAIL) или Resend по HTTP.
// Нужен NOTIFY_FROM (адрес отправителя на вашем домене) и получатели в настройках редактора.
function mailProvider(env) {
  if (!env.NOTIFY_FROM) return null;
  if (env.RESEND_API_KEY) return "resend";
  if (env.EMAIL) return "cloudflare";
  return null;
}

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const oneLine = (t, n) => String(t ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

// Письмо вручную в формате MIME: тема и тело в UTF-8 (base64), чтобы работали любые языки
function buildMime({ from, to, subject, text, replyTo }) {
  const domain = (from.split("@")[1] || "localhost").replace(/[^A-Za-z0-9.-]/g, "");
  const body = b64(text).replace(/.{1,76}/g, "$&\r\n").trimEnd();
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(oneLine(subject, 200))}?=`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].filter((x) => x !== null).join("\r\n");
}

async function sendMail(env, { to, subject, text, replyTo }) {
  const from = env.NOTIFY_FROM, provider = mailProvider(env);
  if (!provider) throw new Error("mail not configured");
  if (provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject: oneLine(subject, 200), text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 150));
    return;
  }
  const { EmailMessage } = await import("cloudflare:email"); // доступно только в Workers
  for (const addr of to) await env.EMAIL.send(new EmailMessage(from, addr, buildMime({ from, to: addr, subject, text, replyTo })));
}

function mailText(n) {
  const val = (v) => (Array.isArray(v) ? v.join(", ") : v === true ? "yes" : String(v));
  const lines = Object.entries(n.data).map(([k, v]) => `${k}: ${val(v)}`);
  return [`Page: /${n.slug === "index" ? "" : n.slug}`, `Form: ${n.form}`, `Language: ${n.lang || "-"}`, `Time: ${new Date().toISOString()}`, "", ...lines, ""].join("\n");
}

async function notifySubmission(env, id, n) {
  let status = null;
  try {
    if (!mailProvider(env)) return;
    const cfg = await getConfig(env.DB);
    if (!cfg.notify.to.length) return;
    // Reply-To: первое email-поле формы, чтобы можно было ответить кнопкой «Ответить»
    const em = n.specs.find((s) => s.fmt === "email" && n.data[s.name]);
    await sendMail(env, {
      to: cfg.notify.to,
      subject: `${cfg.notify.subject || "New submission"} · ${n.form} (/${n.slug === "index" ? "" : n.slug})`,
      text: mailText(n),
      replyTo: em ? n.data[em.name] : undefined,
    });
    status = "ok";
  } catch (e) {
    status = "err: " + oneLine(e && e.message, 150);
    console.error("mail failed", status);
  }
  if (status) await env.DB.prepare("UPDATE submissions SET mail=? WHERE id=?").bind(status, id).run().catch(() => {});
}

// ---------- Каталог (фаза 3) ----------
// Поля создаёт пользователь: text и longtext переводимые ({язык: текст}), number, select, multiselect, url.
function cleanMap(m, max) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (!LANG_RE.test(k) || typeof v !== "string") return null;
    if (v.trim()) out[k] = v.trim().slice(0, max);
  }
  return out;
}
function parseFields(arr) {
  if (!Array.isArray(arr) || arr.length > 30) return { error: "up to 30 fields" };
  const keys = new Set(), fields = [];
  for (const f of arr) {
    if (!f || !KEY_RE.test(f.key || "") || keys.has(f.key) || !FIELD_TYPES.includes(f.type)) return { error: "key or type" };
    keys.add(f.key);
    const label = cleanMap(f.label, 80);
    if (!label) return { error: "label" };
    const opts = [];
    if (f.type === "select" || f.type === "multiselect") {
      if (!Array.isArray(f.opts) || f.opts.length > 50) return { error: "options" };
      const seen = new Set();
      for (const o of f.opts) {
        const t = o && cleanMap(o.t || {}, 80);
        if (!o || typeof o.v !== "string" || !o.v.trim() || o.v.length > 60 || seen.has(o.v) || !t) return { error: "option" };
        seen.add(o.v); opts.push({ v: o.v, t });
      }
    }
    fields.push({ key: f.key, type: f.type, label, opts, req: !!f.req });
  }
  return { fields };
}
async function loadFields(db) {
  const { results } = await db.prepare("SELECT key, type, label, opts, req FROM product_fields ORDER BY pos, id").all();
  return results.map((r) => ({ key: r.key, type: r.type, label: parseJson(r.label, {}), opts: parseJson(r.opts, []), req: !!r.req }));
}
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some((x) => String(x).trim()));
const MEDIA_SRC = /^(\/media\/[a-f0-9]{20}\.[a-z0-9]{3,4}|https:\/\/[^\s"'<>]{1,490})$/;
function parseProduct(p, fields) {
  if (!p || typeof p !== "object") return { error: "product" };
  const status = p.status === "published" ? "published" : "draft", data = {};
  for (const f of fields) {
    const v = (p.data || {})[f.key];
    if (isEmpty(v)) { if (status === "published" && f.req) return { error: "required", field: f.key }; continue; }
    const bad = { error: "bad value", field: f.key };
    if (f.type === "text" || f.type === "longtext") {
      const m = cleanMap(v, f.type === "text" ? 200 : 5000);
      if (!m) return bad;
      if (!Object.keys(m).length) { if (status === "published" && f.req) return { error: "required", field: f.key }; continue; }
      data[f.key] = m;
    } else if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return bad;
      data[f.key] = n;
    } else if (f.type === "select") {
      if (!f.opts.some((o) => o.v === v)) return bad;
      data[f.key] = v;
    } else if (f.type === "multiselect") {
      if (!Array.isArray(v) || !v.every((x) => f.opts.some((o) => o.v === x))) return bad;
      data[f.key] = [...new Set(v)];
    } else {
      if (typeof v !== "string" || !/^https?:\/\/\S{1,490}$/.test(v)) return bad;
      data[f.key] = v;
    }
  }
  const media = [];
  if (p.media !== undefined) {
    if (!Array.isArray(p.media) || p.media.length > 20) return { error: "media" };
    for (const it of p.media) {
      if (!it || !MEDIA_SRC.test(it.src || "") || !["image", "video"].includes(it.type)) return { error: "media item" };
      media.push({ src: it.src, type: it.type });
    }
  }
  return { status, data, media };
}
const productRow = (r) => ({ id: r.id, status: r.status, data: parseJson(r.data, {}), media: parseJson(r.media, []) });
// Использование медиа товарами: в media_use товар хранится как отрицательный page_id
const productUse = (db) => [
  db.prepare("DELETE FROM media_use WHERE page_id < 0"),
  db.prepare("INSERT INTO media_use (page_id, key) SELECT -p.id, m.key FROM products p JOIN media m ON instr(p.media, '/media/' || m.key) > 0"),
];

async function catalogPublic(req, env, ctx) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL("/api/catalog", req.url).href); // ?x=… не обходит кэш и не нагружает базу
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  await ensureSchema(env.DB);
  const fields = await loadFields(env.DB);
  const { results } = await env.DB.prepare("SELECT id, data, media FROM products WHERE status='published' ORDER BY pos, id LIMIT 500").all();
  const res = new Response(JSON.stringify({ v: 1, fields, products: results.map((r) => ({ id: r.id, data: parseJson(r.data, {}), media: parseJson(r.media, []) })) }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" } }); // правки видны на сайте в течение минуты, без повторной публикации
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
// Название товара для письма и заявки: первое текстовое поле на языке сайта по умолчанию
async function productTitle(db, data) {
  const f = (await loadFields(db)).find((x) => x.type === "text" && data[x.key]);
  if (!f) return "";
  const def = (await getConfig(db)).defaultLang;
  return data[f.key][def] || Object.values(data[f.key])[0] || "";
}

// ---------- Точка входа ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/_editor")) return new Response("Not found", { status: 404 });
      if (path.startsWith("/media/")) return mediaGet(req, env, path);
      if (path === "/api/submit") return await submitForm(req, env, ctx);
      if (path === "/api/catalog") return await catalogPublic(req, env, ctx);
      if (path.startsWith("/api/admin/")) {
        await ensureSchema(env.DB);
        return await adminApi(req, env, url);
      }
      if (path.startsWith("/s/")) return editorAssets(env, url);
      return await servePublished(env, path);
    } catch (e) {
      console.error("worker error", (e && e.stack) || e); // подробности только в журнале воркера
      return json({ error: "server" }, 500);
    }
  },
};

// ---------- Опубликованные страницы ----------
async function servePublished(env, path) {
  await ensureSchema(env.DB);
  const slug = path === "/" ? "index" : path.replace(/^\/|\/$/g, "");
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare("SELECT html FROM published WHERE slug=?").bind(slug).first();
  if (!row) return new Response(slug === "index" ? "This site is not published yet." : "Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(row.html, {
    headers: { ...SEC_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}

// ---------- Редактор: файлы только по секретному пути ----------
async function editorAssets(env, url) {
  const parts = url.pathname.split("/"); // ["", "s", secret, file]
  if (!env.ADMIN_PATH || !(await safeEq(parts[2] || "", env.ADMIN_PATH))) return new Response("Not found", { status: 404 });
  if (parts.length === 3) return Response.redirect(url.origin + url.pathname + "/", 301);
  const files = { "": "/_editor/", "editor.js": "/_editor/editor.js", "editor.css": "/_editor/editor.css", "render.js": "/_editor/render.js", "ui.js": "/_editor/ui.js" };
  const asset = files[parts[3]];
  if (parts.length > 4 || asset === undefined) return new Response("Not found", { status: 404 });
  const r = await env.ASSETS.fetch(new URL(asset, url));
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  h.set("referrer-policy", "no-referrer"); // секретный путь редактора не уходит в Referer
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("cache-control", "no-store");
  return new Response(r.body, { status: r.status, headers: h });
}

// ---------- API редактора ----------
async function adminApi(req, env, url) {
  const token = req.headers.get("x-admin-token") || "";
  const db = env.DB;
  // Перебор пароля: после 8 неудачных попыток за 10 минут адрес блокируется
  const who = await ipHash(env, req.headers.get("CF-Connecting-IP") || "?");
  const fails = await db.prepare("SELECT COUNT(*) AS c FROM auth_fail WHERE ip_hash=? AND created>?").bind(who, Date.now() - 600_000).first();
  if (fails.c >= 8) return json({ error: "too_many_attempts" }, 429, { "retry-after": "600" });
  if (!env.ADMIN_TOKEN || !(await safeEq(token, env.ADMIN_TOKEN))) {
    await db.batch([db.prepare("DELETE FROM auth_fail WHERE created < ?").bind(Date.now() - 86_400_000), db.prepare("INSERT INTO auth_fail (ip_hash, created) VALUES (?, ?)").bind(who, Date.now())]);
    return json({ error: "unauthorized" }, 401);
  }
  const sub = url.pathname.slice("/api/admin/".length).split("/"); // например ["pages","3","publish"]
  const m = req.method;

  if (sub[0] === "media") return mediaApi(req, env, sub);

  const readJson = async () => {
    try { return await req.json(); } catch { return null; }
  };

  // Всё для старта редактора одним запросом
  if (sub[0] === "bootstrap" && m === "GET") {
    const config = await getConfig(db);
    const { results } = await db.prepare("SELECT id, slug, title, type, updated, published_at FROM pages ORDER BY id").all();
    return json({ config, pages: results, r2: !!env.MEDIA, mail: mailProvider(env), captcha: !!env.TURNSTILE_SECRET });
  }

  if (sub[0] === "config" && m === "PUT") {
    const cfg = await readJson();
    const err = validateConfig(cfg);
    if (err) return json({ error: "invalid config: " + err }, 400);
    await db.prepare("INSERT INTO settings (k, v) VALUES ('config', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(cfg)).run();
    return json({ ok: true });
  }

  if (sub[0] === "pages") {
    if (sub.length === 1 && m === "POST") {
      const b = await readJson();
      const cfg = await getConfig(db);
      if (!b || !/^[a-z0-9-]{1,40}$/.test(b.slug || "") || typeof b.title !== "string" || !b.title || b.title.length > 120) return json({ error: "bad slug or title" }, 400);
      const err = validateDoc(b.doc, cfg);
      if (err) return json({ error: "invalid doc: " + err }, 400);
      const type = b.type === "modal" ? "modal" : "page";
      try {
        const text = JSON.stringify(b.doc);
        const r = await db.prepare("INSERT INTO pages (slug, title, type, doc, updated) VALUES (?, ?, ?, ?, ?)").bind(b.slug, b.title, type, text, Date.now()).run();
        await db.batch(useStmts(db, r.meta.last_row_id, text));
        return json({ id: r.meta.last_row_id, slug: b.slug, title: b.title, type });
      } catch {
        return json({ error: "slug already exists" }, 409);
      }
    }

    const id = parseInt(sub[1], 10);
    if (!Number.isInteger(id)) return json({ error: "bad id" }, 400);

    if (sub.length === 2 && m === "GET") {
      const r = await db.prepare("SELECT id, slug, title, type, doc FROM pages WHERE id=?").bind(id).first();
      if (!r) return json({ error: "not found" }, 404);
      return json({ ...r, doc: JSON.parse(r.doc) });
    }

    if (sub.length === 2 && m === "PUT") {
      const b = await readJson();
      const cfg = await getConfig(db);
      if (!b || typeof b.title !== "string" || !b.title || b.title.length > 120) return json({ error: "bad title" }, 400);
      const err = validateDoc(b.doc, cfg);
      if (err) return json({ error: "invalid doc: " + err }, 400);
      const text = JSON.stringify(b.doc);
      if (text.length > MAX_DOC) return json({ error: "page too large" }, 413);
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE pages SET title=?, doc=?, updated=? WHERE id=?").bind(b.title, text, now, id),
        // Версия — не чаще раза в 5 минут, хранится последние 30
        db.prepare("INSERT INTO versions (page_id, doc, created) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM versions WHERE page_id=?1 AND created > ?4)").bind(id, text, now, now - 300_000),
        db.prepare("DELETE FROM versions WHERE page_id=?1 AND id NOT IN (SELECT id FROM versions WHERE page_id=?1 ORDER BY id DESC LIMIT 30)").bind(id),
        ...useStmts(db, id, text),
      ]);
      return json({ ok: true, updated: now });
    }

    if (sub.length === 2 && m === "DELETE") {
      const r = await db.prepare("SELECT slug FROM pages WHERE id=?").bind(id).first();
      if (!r) return json({ error: "not found" }, 404);
      if (r.slug === "index") return json({ error: "cannot delete the home page" }, 400);
      await db.batch([
        db.prepare("DELETE FROM pages WHERE id=?").bind(id),
        db.prepare("DELETE FROM versions WHERE page_id=?").bind(id),
        db.prepare("DELETE FROM published WHERE slug=?").bind(r.slug),
        db.prepare("DELETE FROM media_use WHERE page_id=?").bind(id),
      ]);
      return json({ ok: true });
    }

    if (sub[2] === "versions" && m === "GET") {
      const { results } = await db.prepare("SELECT id, created FROM versions WHERE page_id=? ORDER BY id DESC").bind(id).all();
      return json({ versions: results });
    }

    if (sub[2] === "publish" && m === "POST") {
      const b = await readJson();
      const r = await db.prepare("SELECT slug, type FROM pages WHERE id=?").bind(id).first();
      if (!r) return json({ error: "not found" }, 404);
      if (r.type === "modal") return json({ error: "modal pages are published with the page that opens them" }, 400);
      if (!b || typeof b.html !== "string" || b.html.length > MAX_HTML || !b.html.startsWith("<!doctype html>")) return json({ error: "bad html" }, 400);
      const meta = validateMeta(b.meta);
      if (meta === null) return json({ error: "bad meta" }, 400);
      const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO published (slug, html, updated, meta) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET html=excluded.html, updated=excluded.updated, meta=excluded.meta").bind(r.slug, b.html, now, meta),
        db.prepare("UPDATE pages SET published_at=? WHERE id=?").bind(now, id),
      ]);
      return json({ ok: true, slug: r.slug });
    }
  }

  // Проверка почты: отправляет тестовое письмо получателям из настроек и возвращает причину, если не вышло
  if (sub[0] === "notify-test" && m === "POST") {
    const cfg = await getConfig(db);
    if (!mailProvider(env)) return json({ error: "mail_not_configured" }, 400);
    if (!cfg.notify.to.length) return json({ error: "no_recipients" }, 400);
    try {
      await sendMail(env, { to: cfg.notify.to, subject: "Site Builder: test email", text: "If you can read this, notifications about submissions are working." });
      return json({ ok: true, provider: mailProvider(env) });
    } catch (e) {
      return json({ error: String((e && e.message) || e).slice(0, 300) }, 502);
    }
  }

  if (sub[0] === "submissions") {
    if (m === "GET") {
      const { results } = await db.prepare("SELECT id, slug, form, lang, data, created, mail FROM submissions ORDER BY id DESC LIMIT 300").all();
      return json({ submissions: results.map((r) => ({ ...r, data: JSON.parse(r.data) })) });
    }
    if (m === "DELETE" && !sub[1]) { // персональные данные: удалить заявки старше N дней
      const n = parseInt(url.searchParams.get("olderThanDays") || "0", 10);
      if (!(n >= 1 && n <= 3650)) return json({ error: "olderThanDays 1–3650" }, 400);
      await db.prepare("DELETE FROM submissions WHERE created < ?").bind(Date.now() - n * 86_400_000).run();
      return json({ ok: true });
    }
    if (m === "DELETE" && sub[1]) {
      await db.prepare("DELETE FROM submissions WHERE id=?").bind(parseInt(sub[1], 10)).run();
      return json({ ok: true });
    }
  }

  // ----- Каталог: поля и товары -----
  if (sub[0] === "catalog" && m === "GET" && sub.length === 1) {
    const { results } = await db.prepare("SELECT id, data, media, status, pos FROM products ORDER BY pos, id LIMIT 1000").all();
    return json({ fields: await loadFields(db), products: results.map(productRow) });
  }
  if (sub[0] === "catalog" && sub[1] === "fields" && m === "PUT") {
    const r = parseFields(await readJson());
    if (r.error) return json({ error: "invalid fields: " + r.error }, 400);
    await db.batch([db.prepare("DELETE FROM product_fields"),
      ...r.fields.map((f, i) => db.prepare("INSERT INTO product_fields (key, type, label, opts, req, pos) VALUES (?, ?, ?, ?, ?, ?)").bind(f.key, f.type, JSON.stringify(f.label), JSON.stringify(f.opts), f.req ? 1 : 0, i))]);
    return json({ ok: true, fields: r.fields });
  }
  if (sub[0] === "products" && m === "POST" && sub.length === 1) {
    const pr = parseProduct(await readJson(), await loadFields(db));
    if (pr.error) return json({ error: pr.error, field: pr.field }, 422);
    const now = Date.now();
    const r = await db.prepare("INSERT INTO products (data, media, status, pos, created, updated) VALUES (?, ?, ?, (SELECT COALESCE(MAX(pos), 0) + 1 FROM products), ?, ?)").bind(JSON.stringify(pr.data), JSON.stringify(pr.media), pr.status, now, now).run();
    await db.batch(productUse(db));
    return json({ id: r.meta.last_row_id });
  }
  if (sub[0] === "products" && sub.length === 2 && (m === "PUT" || m === "DELETE")) {
    const id = parseInt(sub[1], 10);
    if (!(await db.prepare("SELECT id FROM products WHERE id=?").bind(id).first())) return json({ error: "not found" }, 404);
    if (m === "DELETE") { await db.batch([db.prepare("DELETE FROM products WHERE id=?").bind(id), ...productUse(db)]); return json({ ok: true }); }
    const pr = parseProduct(await readJson(), await loadFields(db));
    if (pr.error) return json({ error: pr.error, field: pr.field }, 422);
    await db.batch([db.prepare("UPDATE products SET data=?, media=?, status=?, updated=? WHERE id=?").bind(JSON.stringify(pr.data), JSON.stringify(pr.media), pr.status, Date.now(), id), ...productUse(db)]);
    return json({ ok: true });
  }
  if (sub[0] === "products-order" && m === "PUT") { // порядок товаров одним запросом
    const b = await readJson();
    if (!b || !Array.isArray(b.ids) || b.ids.length > 1000 || b.ids.some((x) => !Number.isInteger(x))) return json({ error: "bad ids" }, 400);
    await db.prepare("UPDATE products SET pos = (SELECT key FROM json_each(?1) WHERE value = products.id) WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(b.ids)).run();
    return json({ ok: true });
  }
  if (sub[0] === "products-import" && m === "POST") { // до 200 товаров за раз; всё или ничего
    const b = await readJson(), fields = await loadFields(db);
    if (!b || !Array.isArray(b.rows) || !b.rows.length || b.rows.length > 200) return json({ error: "rows: 1–200" }, 400);
    const rows = [], errors = [];
    b.rows.forEach((r, i) => { const pr = parseProduct(r, fields); if (pr.error) errors.push({ row: i + 1, error: pr.error, field: pr.field }); else rows.push({ data: pr.data, media: pr.media, status: pr.status }); });
    if (errors.length) return json({ error: "validation", errors: errors.slice(0, 20) }, 422);
    const now = Date.now();
    await db.batch([db.prepare("INSERT INTO products (data, media, status, pos, created, updated) SELECT json_extract(value, '$.data'), json_extract(value, '$.media'), json_extract(value, '$.status'), (SELECT COALESCE(MAX(pos), 0) FROM products) + CAST(key AS INTEGER) + 1, ?2, ?2 FROM json_each(?1)").bind(JSON.stringify(rows), now), ...productUse(db)]);
    return json({ ok: true, count: rows.length });
  }

  if (sub[0] === "versions" && m === "GET") {
    const vid = parseInt(sub[1], 10);
    const r = await db.prepare("SELECT doc FROM versions WHERE id=?").bind(vid).first();
    if (!r) return json({ error: "not found" }, 404);
    return json({ doc: JSON.parse(r.doc) });
  }

  return json({ error: "not_found" }, 404);
}

// ---------- Медиа (R2, необязательно) ----------
const MEDIA_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };

// Имя для показа: берём исходное имя файла, чистим, подбираем расширение по реальному типу
function cleanBase(orig) {
  let n = String(orig || "").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return n || "file";
}
const parseJson = (t, d) => { try { return JSON.parse(t); } catch { return d; } };
const mediaRow = (r) => ({ ...r, tags: parseJson(r.tags, []), tip: parseJson(r.tip, {}), name_lc: undefined });
const cleanTags = (a) => (Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12) : null);
function cleanTip(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const out = {};
  for (const [k, v] of Object.entries(t)) if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(k) && typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  return out;
}

async function mediaApi(req, env, sub) {
  const db = env.DB, m = req.method;
  if (m === "GET" && sub.length === 1) {
    const { results } = await db.prepare("SELECT m.*, (SELECT COUNT(DISTINCT page_id) FROM media_use u WHERE u.key = m.key) AS uses FROM media m ORDER BY m.id DESC LIMIT 1000").all();
    const total = results.reduce((a, r) => a + r.size, 0);
    return json({ media: results.map(mediaRow), stats: { count: results.length, bytes: total }, r2: !!env.MEDIA });
  }
  if (!env.MEDIA) return json({ error: "r2_not_configured" }, 501);

  // Загрузка: тело запроса — сам файл; исходное имя и размеры приходят в заголовках
  if (m === "POST" && sub.length === 1) {
    const type = (req.headers.get("content-type") || "").split(";")[0];
    const ext = MEDIA_EXT[type];
    if (!ext) return json({ error: "unsupported type" }, 415);
    const len = parseInt(req.headers.get("content-length") || "0", 10);
    if (!len || len > MAX_MEDIA) return json({ error: "file too large (max 50 MB)" }, 413);
    let orig = "";
    try { orig = decodeURIComponent(req.headers.get("x-orig") || ""); } catch { /* оставим пусто */ }
    const base = cleanBase(orig);
    const key = crypto.randomUUID().replaceAll("-", "").slice(0, 20) + "." + ext;
    await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: type } }); // потоком, без чтения в память
    const num = (h) => Math.max(0, Math.min(100000, parseFloat(req.headers.get(h) || "0") || 0));
    // Уникальное имя без учёта регистра: при совпадении добавляем « (2)», « (3)»… (уникальность гарантирует индекс базы)
    for (let n = 1; n <= 99; n++) {
      const name = n === 1 ? `${base}.${ext}` : `${base} (${n}).${ext}`;
      try {
        const r = await db.prepare("INSERT INTO media (key, name, name_lc, orig, mime, size, w, h, dur, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(key, name, name.toLowerCase(), orig.slice(0, 200) || name, type, len, num("x-width") | 0, num("x-height") | 0, num("x-dur"), Date.now()).run();
        const row = await db.prepare("SELECT *, 0 AS uses FROM media WHERE id=?").bind(r.meta.last_row_id).first();
        return json(mediaRow(row));
      } catch (e) {
        if (!/UNIQUE/i.test(String(e && e.message))) { await env.MEDIA.delete(key); throw e; }
      }
    }
    await env.MEDIA.delete(key);
    return json({ error: "could not find a free file name" }, 409);
  }

  const id = parseInt(sub[1], 10);
  if (!Number.isInteger(id)) return json({ error: "bad id" }, 400);
  const row = await db.prepare("SELECT m.*, (SELECT COUNT(DISTINCT page_id) FROM media_use u WHERE u.key = m.key) AS uses FROM media m WHERE id=?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);

  // Правка: имя (с проверкой уникальности), теги, подсказки по языкам. Адрес файла не меняется.
  if (m === "PATCH") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const tags = b.tags === undefined ? undefined : cleanTags(b.tags);
    const tip = b.tip === undefined ? undefined : cleanTip(b.tip);
    if (tags === null || tip === null) return json({ error: "bad tags or tip" }, 400);
    let name = row.name;
    if (b.name !== undefined) {
      const ext = row.name.split(".").pop();
      name = `${cleanBase(b.name)}.${ext}`;
    }
    try {
      await db.prepare("UPDATE media SET name=?, name_lc=?, tags=?, tip=? WHERE id=?")
        .bind(name, name.toLowerCase(), JSON.stringify(tags ?? parseJson(row.tags, [])), JSON.stringify(tip ?? parseJson(row.tip, {})), id).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "name_taken", name }, 409);
      throw e;
    }
    const out = await db.prepare("SELECT m.*, (SELECT COUNT(DISTINCT page_id) FROM media_use u WHERE u.key = m.key) AS uses FROM media m WHERE id=?").bind(id).first();
    return json(mediaRow(out));
  }

  // Удаление: файл, который где-то используется, без явного подтверждения не удаляется
  if (m === "DELETE") {
    if (row.uses > 0 && new URL(req.url).searchParams.get("force") !== "1") return json({ error: "in_use", uses: row.uses }, 409);
    await env.MEDIA.delete(row.key);
    await db.batch([db.prepare("DELETE FROM media WHERE id=?").bind(id), db.prepare("DELETE FROM media_use WHERE key=?").bind(row.key)]);
    return json({ ok: true });
  }
  return json({ error: "not_found" }, 404);
}

async function mediaGet(req, env, path) {
  if (!env.MEDIA) return new Response("Not found", { status: 404 });
  const key = path.slice("/media/".length);
  if (!/^[a-f0-9]{20}\.[a-z0-9]{3,4}$/.test(key)) return new Response("Not found", { status: 404 });
  const o = await env.MEDIA.get(key, { range: req.headers }); // поддержка Range для видео
  if (!o) return new Response("Not found", { status: 404 });
  const h = new Headers();
  o.writeHttpMetadata(h);
  h.set("etag", o.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=31536000, immutable");
  h.set("x-content-type-options", "nosniff");
  h.set("content-security-policy", "default-src 'none'; sandbox");
  let status = 200;
  if (o.range) {
    const off = o.range.offset ?? Math.max(0, o.size - o.range.suffix);
    const len = o.range.length ?? o.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${o.size}`);
    h.set("content-length", String(len));
    status = 206;
  }
  return new Response(o.body, { status, headers: h });
}
