import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, PM } from "./helpers.mjs";

const up = (api, orig, type = "image/jpeg", extra = {}) =>
  api("POST", "/api/admin/media", new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": type, "x-orig": encodeURIComponent(orig), "x-width": "1600", "x-height": "1200", ...extra } });

test("библиотека: имена уникальны без учёта регистра, оригинал сохраняется", async () => {
  const { api } = await setup();
  let r = await up(api, "Red Sneakers Front.JPG");
  assert.equal(r.json.name, "Red Sneakers Front.jpg"); assert.equal(r.json.orig, "Red Sneakers Front.JPG");
  assert.equal(r.json.w, 1600);
  assert.equal((await up(api, "red sneakers front.jpg")).json.name, "red sneakers front (2).jpg");
  assert.equal((await up(api, "red sneakers front.jpg")).json.name, "red sneakers front (3).jpg");
  assert.equal((await up(api, "C:\\fakepath\\Кроссовки <новые>.png", "image/png")).json.name, "Кроссовки _новые_.png");
  assert.equal((await up(api, "movie.mov", "video/quicktime")).status, 415);
  assert.equal((await up(api, "clip.mp4", "video/mp4", { "x-dur": "12.4" })).json.dur, 12.4);
});

test("библиотека: правка тегов, подсказок и имени; занятое имя отклоняется", async () => {
  const { api } = await setup();
  const a = (await up(api, "a.jpg")).json, b = (await up(api, "b.jpg")).json;
  let r = await api("PATCH", `/api/admin/media/${a.id}`, { tags: [" Товар ", "обувь", "товар"], tip: { ru: "Красные кроссовки", en: "Red sneakers", xx1: "x", ru2: "" } });
  assert.deepEqual(r.json.tags, ["товар", "обувь"]);
  assert.deepEqual(r.json.tip, { ru: "Красные кроссовки", en: "Red sneakers" });
  r = await api("PATCH", `/api/admin/media/${a.id}`, { name: "B.JPG" });
  assert.equal(r.status, 409); assert.equal(r.json.error, "name_taken");
  r = await api("PATCH", `/api/admin/media/${a.id}`, { name: "hero" });
  assert.equal(r.json.name, "hero.jpg"); assert.equal(r.json.key, a.key); // адрес не меняется
  r = await api("PATCH", `/api/admin/media/${b.id}`, { tags: Array.from({ length: 20 }, (_, i) => "t" + i) });
  assert.equal(r.json.tags.length, 12);
});

test("библиотека: счётчик использования страницами, удаление используемого только с подтверждением", async () => {
  const { api, h } = await setup();
  const m = (await up(api, "a.jpg")).json;
  const doc = PM.newDoc(); const md = PM.newMedia();
  md.items.push(PM.newItem("/media/" + m.key), PM.newItem("/media/" + m.key), PM.newItem("https://x.com/a.jpg"));
  doc.root.children.push(md);
  const pid = (await api("POST", "/api/admin/pages", { slug: "index", title: "Home", doc })).json.id;
  const uses = async () => (await api("GET", "/api/admin/media")).json.media.find((x) => x.id === m.id).uses;
  assert.equal(await uses(), 1);
  const del = await api("DELETE", `/api/admin/media/${m.id}`);
  assert.equal(del.status, 409); assert.equal(del.json.error, "in_use");
  md.items = [];
  await api("PUT", `/api/admin/pages/${pid}`, { title: "Home", doc });
  assert.equal(await uses(), 0);
  assert.equal(h.objects.size, 1);
  assert.equal((await api("DELETE", `/api/admin/media/${m.id}`)).status, 200);
  assert.equal(h.objects.size, 0);
});

test("библиотека: без R2 загрузка недоступна, список отдаётся", async () => {
  const { api } = await setup({ MEDIA: undefined });
  assert.equal((await up(api, "a.jpg")).status, 501);
  assert.equal((await api("GET", "/api/admin/media")).json.r2, false);
});
