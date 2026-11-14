// Фаза 3: каталог витрины — поля создаёт пользователь, товары, публичный каталог, заявка на товар
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, PM, cfg } from "./helpers.mjs";

const FIELDS = [
  { key: "name", type: "text", label: { en: "Name", ru: "Название" }, req: true },
  { key: "descr", type: "longtext", label: { en: "Description" } },
  { key: "price", type: "number", label: { en: "Price" } },
  { key: "category", type: "select", label: { en: "Category" }, opts: [{ v: "shoes", t: { en: "Shoes", ru: "Обувь" } }, { v: "bags", t: { en: "Bags" } }] },
  { key: "tags", type: "multiselect", label: { en: "Tags" }, opts: [{ v: "new", t: { en: "New" } }, { v: "sale", t: { en: "Sale" } }] },
  { key: "link", type: "url", label: { en: "Link" } },
];
const prod = (name, extra = {}, status = "published") => ({ status, data: { name: { en: name, ru: name + " (ru)" }, ...extra }, media: [] });

async function withFields(api) { return api("PUT", "/api/admin/catalog/fields", FIELDS); }

test("поля: проверка ключей, типов, вариантов; порядок сохраняется", async () => {
  const { api } = await setup();
  assert.equal((await withFields(api)).status, 200);
  const cat = (await api("GET", "/api/admin/catalog")).json;
  assert.deepEqual(cat.fields.map((f) => f.key), FIELDS.map((f) => f.key));
  assert.equal(cat.fields[3].opts[0].t.ru, "Обувь");
  const bad = (f) => api("PUT", "/api/admin/catalog/fields", f);
  assert.equal((await bad([{ key: "Bad Key", type: "text", label: { en: "x" } }])).status, 400);
  assert.equal((await bad([{ key: "a", type: "money", label: { en: "x" } }])).status, 400);
  assert.equal((await bad([{ key: "a", type: "text", label: { en: "x" } }, { key: "a", type: "text", label: { en: "y" } }])).status, 400);
  assert.equal((await bad([{ key: "a", type: "select", label: { en: "x" }, opts: [{ v: "1", t: { en: "1" } }, { v: "1", t: { en: "1" } }] }])).status, 400);
  assert.equal((await bad(Array.from({ length: 31 }, (_, i) => ({ key: "f" + i, type: "text", label: { en: "x" } })))).status, 400);
});

test("товары: значения проверяются по типу поля, обязательные только при публикации", async () => {
  const { api } = await setup();
  await withFields(api);
  assert.equal((await api("POST", "/api/admin/products", prod("Sneaker", { price: 99.5, category: "shoes", tags: ["new", "sale", "new"], link: "https://x.com/p" }))).status, 200);
  assert.equal((await api("POST", "/api/admin/products", { status: "published", data: {} })).json.error, "required");      // нет названия
  assert.equal((await api("POST", "/api/admin/products", { status: "draft", data: {} })).status, 200);                      // черновик можно
  const bad = async (extra) => (await api("POST", "/api/admin/products", prod("X", extra))).json;
  assert.equal((await bad({ price: "abc" })).field, "price");
  assert.equal((await bad({ category: "cars" })).field, "category");
  assert.equal((await bad({ tags: ["new", "nope"] })).field, "tags");
  assert.equal((await bad({ link: "javascript:alert(1)" })).field, "link");
  assert.equal((await api("POST", "/api/admin/products", { ...prod("X"), media: [{ src: "http://insecure.example/a.jpg", type: "image" }] })).json.error, "media item");
  const cat = (await api("GET", "/api/admin/catalog")).json;
  assert.deepEqual(cat.products[0].data.tags, ["new", "sale"]); // без повторов
});

test("товары: правка, порядок, удаление, импорт «всё или ничего»", async () => {
  const { api } = await setup();
  await withFields(api);
  const ids = [];
  for (const n of ["A", "B", "C"]) ids.push((await api("POST", "/api/admin/products", prod(n))).json.id);
  assert.equal((await api("PUT", `/api/admin/products/${ids[0]}`, prod("A2", { price: 5 }))).status, 200);
  assert.equal((await api("PUT", "/api/admin/products/999", prod("x"))).status, 404);
  assert.equal((await api("PUT", "/api/admin/products-order", { ids: [ids[2], ids[0], ids[1]] })).status, 200);
  let cat = (await api("GET", "/api/admin/catalog")).json;
  assert.deepEqual(cat.products.map((p) => p.id), [ids[2], ids[0], ids[1]]);
  assert.equal(cat.products[1].data.name.en, "A2");
  assert.equal((await api("DELETE", `/api/admin/products/${ids[1]}`)).status, 200);
  // импорт: одна плохая строка отменяет весь пакет
  const r = await api("POST", "/api/admin/products-import", { rows: [prod("I1"), prod("I2", { price: "bad" })] });
  assert.equal(r.status, 422); assert.equal(r.json.errors[0].row, 2);
  assert.equal((await api("GET", "/api/admin/catalog")).json.products.length, 2);
  const ok = await api("POST", "/api/admin/products-import", { rows: [prod("I1"), prod("I2", { price: 7 })] });
  assert.equal(ok.json.count, 2);
  cat = (await api("GET", "/api/admin/catalog")).json;
  assert.equal(cat.products.length, 4); assert.equal(cat.products[3].data.price, 7);
});

test("публичный каталог: только опубликованные товары, без служебных данных, кэш 60 секунд", async () => {
  const { api, worker, h } = await setup();
  await withFields(api);
  await api("POST", "/api/admin/products", prod("Shown"));
  await api("POST", "/api/admin/products", prod("Hidden", {}, "draft"));
  const r = await worker.default.fetch(new Request("http://x/api/catalog"), h.env, h.ctx); // без токена
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /max-age=60/);
  const j = await r.json();
  assert.equal(j.products.length, 1); assert.equal(j.products[0].data.name.en, "Shown");
  assert.equal(j.fields.length, FIELDS.length);
  assert.equal(j.products[0].status, undefined);
});

test("использование медиа товарами учитывается при удалении файла из библиотеки", async () => {
  const { api } = await setup();
  await withFields(api);
  const up = await api("POST", "/api/admin/media", new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg", "x-orig": "p.jpg" } });
  const m = up.json;
  const id = (await api("POST", "/api/admin/products", { ...prod("P"), media: [{ src: "/media/" + m.key, type: "image" }] })).json.id;
  assert.equal((await api("DELETE", `/api/admin/media/${m.id}`)).status, 409);
  await api("DELETE", `/api/admin/products/${id}`);
  assert.equal((await api("DELETE", `/api/admin/media/${m.id}`)).status, 200);
});

test("заявка на товар: товар проверяется по базе, название подставляет сервер", async () => {
  const { api } = await setup();
  const c = cfg();
  await api("PUT", "/api/admin/config", c);
  await withFields(api);
  const pid = (await api("POST", "/api/admin/products", prod("Red sneakers"))).json.id;
  const draft = (await api("POST", "/api/admin/products", prod("Draft one", {}, "draft"))).json.id;
  const doc = PM.newDoc(); doc.root.children.push(PM.newShowcase("en"));
  const idx = (await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc })).json.id;
  const fm = PM.formsMeta(doc, []);
  assert.ok(fm.forms.inquiry, "форма inquiry описана витриной");
  assert.deepEqual(fm.forms.inquiry.map((s) => s.name), ["name", "contact", "comment", "consent", "product"]);
  await api("POST", `/api/admin/pages/${idx}/publish`, { html: PM.page(doc, c, { slug: "index" }), meta: { forms: fm.forms } });
  const send = (data, ip) => api("POST", "/api/submit", { slug: "index", form: "inquiry", lang: "en", data }, { ip });
  const good = { name: "Ivan", contact: "+7 999 123-45-67", comment: "Size 42?", consent: true };
  let r = await send({ ...good, product: String(pid) }, "1.1.1.1");
  assert.equal(r.status, 200);
  const sub = (await api("GET", "/api/admin/submissions")).json.submissions[0];
  assert.equal(sub.data.product, String(pid)); assert.equal(sub.data.product_title, "Red sneakers");
  assert.equal((await send({ ...good, product: "9999" }, "2.2.2.2")).json.fields.product, "v.choice");      // нет такого товара
  assert.equal((await send({ ...good, product: String(draft) }, "3.3.3.3")).json.fields.product, "v.choice"); // черновик
  assert.equal((await send({ ...good, product: String(pid), contact: "abc" }, "4.4.4.4")).json.fields.contact, "v.phone");
  assert.equal((await send({ ...good, consent: false, product: String(pid) }, "5.5.5.5")).json.fields.consent, "v.consent");
});
