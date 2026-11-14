import { test } from "node:test";
import assert from "node:assert/strict";
import { PM } from "./helpers.mjs";

test("новая сетка использует точные адаптивные настройки по умолчанию", () => {
  const d = PM.newDoc(), p = d.root.p, css = PM.css(d);
  assert.deepEqual(
    { cols: p.cols, colsM: p.colsM, rowH: p.rowH, gapX: p.gapX, gapY: p.gapY, padX: p.padX, padY: p.padY, maxW: p.maxW },
    { cols: 80, colsM: 32, rowH: 8, gapX: 2, gapY: 2, padX: 0, padY: 0, maxW: 0 },
  );
  assert.ok(css.includes("repeat(80,minmax(0,1fr))"));
  assert.ok(css.includes("repeat(32,minmax(0,1fr))"));
  assert.ok(css.includes("column-gap:2px;row-gap:2px;padding:0px 0px"));
  assert.ok(!css.includes("max-width:0px"));
  p.gapY = 5; p.padX = 3; p.padY = 7;
  assert.ok(PM.css(d).includes("column-gap:2px;row-gap:5px;padding:7px 3px"));
});

test("старые сетки сохраняют общие gap и padding", () => {
  const d = PM.newDoc(), p = d.root.p;
  delete p.gapX; delete p.gapY; delete p.padX; delete p.padY;
  p.gap = 8; p.pad = 12;
  const css = PM.css(d);
  assert.ok(css.includes("column-gap:8px;row-gap:8px;padding:12px 12px"));
});

test("проверка полей: форматы, обязательность, варианты", () => {
  const V = PM.validateField;
  const cases = [
    [{ kind: "input", fmt: "email", req: true }, "a@b.co", ""], [{ kind: "input", fmt: "email", req: true }, "nope", "v.email"], [{ kind: "input", fmt: "email", req: true }, "", "v.required"],
    [{ kind: "input", fmt: "phone" }, "+1 (555) 123-4567", ""], [{ kind: "input", fmt: "phone" }, "12", "v.phone"],
    [{ kind: "input", fmt: "telegram" }, "@user_name", ""], [{ kind: "input", fmt: "telegram" }, "ab", "v.telegram"],
    [{ kind: "input", fmt: "url" }, "https://a.b", ""], [{ kind: "input", fmt: "url" }, "javascript:alert(1)", "v.url"],
    [{ kind: "radio", opts: ["a", "b"] }, "c", "v.choice"], [{ kind: "checklist", opts: ["a", "b"] }, ["a"], ""],
    [{ kind: "consent", req: true }, false, "v.consent"], [{ kind: "input", fmt: "text", max: 3 }, "abcd", "v.max"],
  ];
  for (const [s, v, want] of cases) assert.equal(V(s, v), want, JSON.stringify([s, v]));
});

test("страница: окна, формы, словарь переводов, скрипт разбирается", () => {
  const d = PM.newDoc();
  const em = PM.newControl("input", "en"); em.p.fmt = "email"; em.p.req = true; em.p.name = "email"; em.p.label.ru = "Почта";
  const bt = PM.newControl("button", "en"); bt.p.btn.action = "submit"; bt.p.btn.form = "contact";
  const open = PM.newControl("button", "en"); open.p.btn.action = "modal"; open.p.btn.modal = "thanks";
  d.root.children.push(em, bt, open, PM.newLang(), PM.newText("en", "Hi"));
  const md = PM.newDoc({ modal: true });
  assert.deepEqual(PM.modalRefs(d), ["thanks"]);
  const fm = PM.formsMeta(d, [{ slug: "thanks", doc: md }]);
  assert.deepEqual(Object.keys(fm.forms), ["contact"]);
  const html = PM.page(d, PM.DEFAULT_CONFIG, { slug: "index", modals: [{ slug: "thanks", doc: md }] });
  assert.ok(html.includes('id="md-thanks"') && html.includes("pm-i18n"));
  assert.ok(html.includes(`data-i="text:c.${em.id}.l"`));
  new Function(PM.RUNTIME); // скрипт страницы синтаксически верен
  const dict = PM.dict([d], PM.DEFAULT_CONFIG);
  assert.equal(dict.ru["c." + em.id + ".l"], "Почта");
  assert.equal(dict.ar["v.required"], "هذا الحقل مطلوب");
});

test("формы: повтор имени поля и конфликт имён форм дают ошибку", () => {
  const d = PM.newDoc();
  const a = PM.newControl("input", "en"), b = PM.newControl("input", "en"); a.p.name = b.p.name = "x";
  d.root.children.push(a, b);
  assert.match(PM.formsMeta(d, []).error || "", /Повторяется/);
});

test("медиа: выключенные ячейки, лимит «первые N», подсказки библиотеки", () => {
  const k1 = "a".repeat(20) + ".jpg", k2 = "b".repeat(20) + ".jpg";
  const lib = { [k1]: { name: "red.jpg", tags: ["товар"], tip: { en: "Red sneakers", ru: "Красные кроссовки" } }, [k2]: { name: "blue.jpg", tags: [], tip: {} } };
  const d = PM.newDoc(), m = PM.newMedia();
  m.items.push(PM.newItem("/media/" + k1), PM.newItem("/media/" + k2), PM.newItem("https://x/y.jpg"), PM.newItem("/media/" + k1));
  m.items[2].off = true;
  d.root.children.push(m);
  const count = (h) => (h.split("<script")[0].match(/class="m-slide/g) || []).length; // только разметка, без текста скрипта
  let h = PM.page(d, PM.DEFAULT_CONFIG, { lib });
  assert.equal(count(h), 3);
  assert.ok(/data-tip="Red sneakers"/.test(h));
  assert.ok(h.includes(`"mt.${m.items[0].id}":"Красные кроссовки"`));
  m.p.belt.limit = 1; assert.equal(count(PM.page(d, PM.DEFAULT_CONFIG, { lib })), 1);
  m.p.belt.limit = 0; m.p.showTip = false;
  assert.ok(!PM.page(d, PM.DEFAULT_CONFIG, { lib }).includes("data-tip="));
  const edit = PM.html(d.root, { lang: "ru", def: "en", edit: true, lib });
  assert.ok(edit.includes("red.jpg\nКрасные кроссовки\n#товар")); // в редакторе: имя, подсказка, теги
});
