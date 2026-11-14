import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, PM, cfg, contactDoc } from "./helpers.mjs";

async function published(api, extraCfg = {}) {
  const c = { ...cfg(), ...extraCfg };
  await api("PUT", "/api/admin/config", c);
  const doc = contactDoc();
  const id = (await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc })).json.id;
  const fm = PM.formsMeta(doc, []);
  await api("POST", `/api/admin/pages/${id}/publish`, { html: PM.page(doc, c, { slug: "index" }), meta: { forms: fm.forms } });
  return c;
}
const submit = (api, data, o) => api("POST", "/api/submit", { slug: "index", form: "contact", lang: "ru", data, ...(o && o.extra) }, o);

test("заявки: проверка формата на сервере, неизвестная форма, лишние поля отбрасываются", async () => {
  const { api } = await setup();
  await published(api);
  let r = await submit(api, { email: "nope" });
  assert.equal(r.status, 422); assert.equal(r.json.fields.email, "v.email");
  r = await submit(api, {});
  assert.equal(r.json.fields.email, "v.required");
  assert.equal((await api("POST", "/api/submit", { slug: "index", form: "nope", data: {} })).status, 404);
  r = await submit(api, { email: "a@b.co", msg: "Привет", evil: "<script>" });
  assert.equal(r.status, 200);
  const list = (await api("GET", "/api/admin/submissions")).json.submissions;
  assert.deepEqual(list[0].data, { email: "a@b.co", msg: "Привет" });
});

test("заявки: не больше 5 за 10 минут с адреса", async () => {
  const { api } = await setup();
  await published(api);
  let last;
  for (let i = 0; i < 6; i++) last = (await submit(api, { email: "a@b.co" }, { ip: "4.4.4.4" })).status;
  assert.equal(last, 429);
  assert.equal((await submit(api, { email: "a@b.co" }, { ip: "5.5.5.5" })).status, 200); // другой адрес
});

test("капча Turnstile: без токена и с плохим токеном отказ, с хорошим приём", async () => {
  const { api, h } = await setup({ TURNSTILE_SECRET: "sek" });
  await published(api);
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return new Response(JSON.stringify({ success: init.body.get("response") === "good" })); };
  try {
    assert.equal((await submit(api, { email: "a@b.co" })).status, 403);
    assert.equal((await submit(api, { email: "a@b.co" }, { extra: { ts: "wrong" }, ip: "2.2.2.2" })).status, 403);
    // extra передаётся через тело: проверим напрямую
    const r = await api("POST", "/api/submit", { slug: "index", form: "contact", data: { email: "a@b.co" }, ts: "good" }, { ip: "3.3.3.3" });
    assert.equal(r.status, 200);
    assert.ok(calls.every((u) => u.includes("siteverify")));
  } finally { globalThis.fetch = real; }
});

test("письма: Resend получает письмо с Reply-To, сбой почты не теряет заявку и виден в статусе", async () => {
  const { api, h } = await setup({ NOTIFY_FROM: "site@example.com", RESEND_API_KEY: "rk" });
  const c = await published(api);
  await api("PUT", "/api/admin/config", { ...c, notify: { to: ["owner@example.com"], subject: "Заявка" } });
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response("{}", { status: 200 }); };
  try {
    assert.equal((await submit(api, { email: "client@mail.com", msg: "Привет, мир" }, { ip: "7.7.7.7" })).status, 200);
    await h.flush();
    const p = JSON.parse(sent[0].init.body);
    assert.deepEqual(p.to, ["owner@example.com"]);
    assert.equal(p.reply_to, "client@mail.com");
    assert.match(p.text, /msg: Привет, мир/);
    assert.equal(sent[0].init.headers.authorization, "Bearer rk");
    assert.equal((await api("GET", "/api/admin/submissions")).json.submissions[0].mail, "ok");
    globalThis.fetch = async () => new Response("domain not verified", { status: 403 });
    assert.equal((await submit(api, { email: "client@mail.com" }, { ip: "6.6.6.6" })).status, 200);
    await h.flush();
    assert.match((await api("GET", "/api/admin/submissions")).json.submissions[0].mail, /^err: Resend 403/);
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    assert.equal((await api("POST", "/api/admin/notify-test")).json.ok, true);
  } finally { globalThis.fetch = real; }
});

test("письма: без настройки тест возвращает код ошибки; MIME кодирует тему и защищён от инъекции заголовков", async () => {
  const { api, worker } = await setup();
  assert.equal((await api("POST", "/api/admin/notify-test")).json.error, "mail_not_configured");
  const raw = worker.buildMime({ from: "site@example.com", to: "owner@example.com", subject: "Заявка\r\nBcc: evil@x.com", text: "msg: Привет", replyTo: "a@b.co" });
  const [head, body] = raw.split("\r\n\r\n");
  assert.match(head, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.doesNotMatch(head, /Bcc:/);
  assert.match(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), /Привет/);
  assert.equal(worker.mailProvider({ NOTIFY_FROM: "a@b.c", EMAIL: {} }), "cloudflare");
  assert.equal(worker.mailProvider({ EMAIL: {} }), null);
});
