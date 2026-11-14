/* render.js — единый для редактора, публикации и сервера.
   Из JSON-документа строит HTML и CSS. Холст редактора рисуется этой же функцией,
   поэтому «что видишь, то и опубликуется». Проверка полей (validateField) тоже одна:
   её исполняют и браузер посетителя, и воркер — правила нельзя обойти.
   Мобильная раскладка включается по ширине КОНТЕЙНЕРА (@container), а не окна. */
const PM = (() => {
  const BP = 720;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const col = (v) => (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v || "") ? v : "");
  const url = (v) => (/^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(v || "") ? v : "");
  const uid = () => Math.random().toString(36).slice(2, 9);
  const has = (m) => Object.values(m || {}).some(Boolean);
  // Запись библиотеки медиа для ячейки: по адресу /media/<ключ>. lib = { ключ: { name, tags, tip:{язык:текст} } }
  const libOf = (it, lib) => { const k = (String(it.src || "").match(/^\/media\/([a-f0-9]{20}\.[a-z0-9]{3,4})$/) || [])[1]; return k && lib ? lib[k] || null : null; };

  const BLOCK_TYPES = ["grid", "text", "media", "control", "lang", "showcase"];
  const KINDS = ["button", "input", "textarea", "radio", "checklist", "select", "consent", "menu"];
  const CHOICE = ["radio", "checklist", "select"];
  const FMTS = ["text", "email", "phone", "telegram", "whatsapp", "url", "number"];

  const DEFAULT_CONFIG = {
    ver: 4,
    siteTitle: "My site",
    notify: { to: [], subject: "" },   // кому слать письма о заявках
    turnstileSiteKey: "",              // публичный ключ капчи Cloudflare Turnstile (пусто — без капчи)
    maxDepth: 4,
    compat: { grid: ["grid", "text", "media", "control", "lang", "showcase"] }, // кто кого может содержать
    defaultLang: "en",
    langs: [
      { code: "en", name: "English", dir: "ltr" },
      { code: "ru", name: "Русский", dir: "ltr" },
      { code: "ar", name: "العربية", dir: "rtl" },
      { code: "he", name: "עברית", dir: "rtl" },
    ],
  };

  // Стандартные тексты проверок и статусов формы (ключи v.*). Для языков, которых тут нет, берётся английский.
  const MSG = {
    en: { required: "This field is required", consent: "Please accept to continue", email: "Enter a valid email address", phone: "Enter a phone number with country code, e.g. +15551234567", telegram: "Enter a Telegram username, e.g. @username", url: "Enter a link starting with http:// or https://", number: "Enter a number", min: "Too short", max: "Too long", choice: "Choose one of the options", captcha: "Verification failed. Please try again.", sending: "Sending…", sent: "Sent. Thank you!", fail: "Could not send. Please try again.", rate: "Too many attempts. Please try later." },
    ru: { required: "Обязательное поле", consent: "Подтвердите согласие, чтобы продолжить", email: "Введите корректный email", phone: "Введите номер с кодом страны, например +79991234567", telegram: "Введите ник Telegram, например @username", url: "Введите ссылку, начинающуюся с http:// или https://", number: "Введите число", min: "Слишком коротко", max: "Слишком длинно", choice: "Выберите один из вариантов", captcha: "Проверка не пройдена. Попробуйте ещё раз.", sending: "Отправка…", sent: "Отправлено. Спасибо!", fail: "Не удалось отправить. Попробуйте ещё раз.", rate: "Слишком много попыток. Попробуйте позже." },
    ar: { required: "هذا الحقل مطلوب", consent: "يرجى الموافقة للمتابعة", email: "أدخل بريدًا إلكترونيًا صحيحًا", phone: "أدخل رقم هاتف مع رمز الدولة، مثل +201001234567", telegram: "أدخل اسم مستخدم تيليجرام، مثل @username", url: "أدخل رابطًا يبدأ بـ http:// أو https://", number: "أدخل رقمًا", min: "قصير جدًا", max: "طويل جدًا", choice: "اختر أحد الخيارات", captcha: "فشل التحقق. حاول مرة أخرى.", sending: "جارٍ الإرسال…", sent: "تم الإرسال. شكرًا لك!", fail: "تعذّر الإرسال. حاول مرة أخرى.", rate: "محاولات كثيرة. حاول لاحقًا." },
    he: { required: "שדה חובה", consent: "יש לאשר כדי להמשיך", email: "הזינו כתובת אימייל תקינה", phone: "הזינו מספר טלפון עם קידומת מדינה, למשל +972501234567", telegram: "הזינו שם משתמש בטלגרם, למשל @username", url: "הזינו קישור שמתחיל ב-http:// או https://", number: "הזינו מספר", min: "קצר מדי", max: "ארוך מדי", choice: "בחרו אחת מהאפשרויות", captcha: "האימות נכשל. נסו שוב.", sending: "שולח…", sent: "נשלח. תודה!", fail: "השליחה נכשלה. נסו שוב.", rate: "יותר מדי ניסיונות. נסו מאוחר יותר." },
  };

  // ---------- Проверка полей (клиент + сервер, один код) ----------
  // Самодостаточная функция: её текст вставляется в скрипт страницы.
  // spec: { kind, fmt, req, min, max, opts }; value: строка | массив | boolean. Возвращает ключ ошибки или "".
  function validateField(s, v) {
    const empty = Array.isArray(v) ? v.length === 0 : v === false || v == null || String(v).trim() === "";
    if (empty) return s.req ? (s.kind === "consent" ? "v.consent" : "v.required") : "";
    if (s.kind === "consent") return "";
    if (s.kind === "checklist") return Array.isArray(v) && v.every((x) => (s.opts || []).includes(x)) ? "" : "v.choice";
    if (s.kind === "radio" || s.kind === "select") return (s.opts || []).includes(v) ? "" : "v.choice";
    const t = String(v).trim();
    if (s.min && t.length < s.min) return "v.min";
    if (s.max && t.length > s.max) return "v.max";
    switch (s.fmt) {
      case "email": return t.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(t) ? "" : "v.email";
      case "phone":
      case "whatsapp": return /^\+?\d{7,15}$/.test(t.replace(/[\s().-]/g, "")) ? "" : "v.phone";
      case "telegram": return /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(t) ? "" : "v.telegram";
      case "url": try { return /^https?:$/.test(new URL(t).protocol) ? "" : "v.url"; } catch (e) { return "v.url"; }
      case "number": return /^-?\d+([.,]\d+)?$/.test(t) ? "" : "v.number";
    }
    return "";
  }

  // ---------- Витрина: отрисовка карточек (одна и та же в редакторе и на сайте) ----------
  // Самодостаточная функция: вставляется в скрипт страницы. Данные: cat = { fields, products } из /api/catalog.
  function scKit() {
    const E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const L = (m, lang, def) => (m && (m[lang] || m[def])) || "";
    const F = (cat, k) => cat.fields.find((f) => f.key === k);
    const optT = (f, v, lang, def) => { const o = (f.opts || []).find((x) => x.v === v); return o ? L(o.t, lang, def) || o.v : String(v); };
    const text = (f, p, lang, def) => {
      const v = p.data[f.key];
      if (v == null || v === "") return "";
      if (f.type === "text" || f.type === "longtext") return L(v, lang, def);
      if (f.type === "select") return optT(f, v, lang, def);
      if (f.type === "multiselect") return v.map((x) => optT(f, x, lang, def)).join(", ");
      return String(v);
    };
    const match = (f, p, v, lang, def) => {
      const x = p.data[f.key];
      if (x == null) return false;
      if (f.type === "multiselect") return x.includes(v);
      if (f.type === "select" || f.type === "number") return String(x) === String(v);
      return text(f, p, lang, def).toLowerCase().includes(String(v).toLowerCase());
    };
    const src = (u) => (/^(\/(?!\/)|https:\/\/)/.test(u || "") ? u : "");
    // Источник, фильтры, поиск, сортировка, лимит «первые N»
    const prep = (cfg, cat, o) => {
      const st = o.st || { q: "", f: {} }, q = (st.q || "").trim().toLowerCase();
      let list = cat.products.filter((p) => {
        if (cfg.where && cfg.where.k && cfg.where.v !== "") { const f = F(cat, cfg.where.k); if (f && !match(f, p, cfg.where.v, o.lang, o.def)) return false; }
        for (const k of Object.keys(st.f || {})) { const f = F(cat, k); if (f && st.f[k] !== "" && !match(f, p, st.f[k], o.lang, o.def)) return false; }
        return !q || cat.fields.some((f) => text(f, p, o.lang, o.def).toLowerCase().includes(q));
      });
      const s = cfg.sort && cfg.sort.k && F(cat, cfg.sort.k);
      if (s) {
        const dir = cfg.sort.dir === "desc" ? -1 : 1, key = (p) => (s.type === "number" ? p.data[s.key] ?? 0 : text(s, p, o.lang, o.def));
        list = list.slice().sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir; });
      }
      return cfg.limit > 0 ? list.slice(0, cfg.limit) : list;
    };
    const media = (cfg, p) => {
      const items = (p.media || []).filter((m) => src(m.src));
      const c = cfg.carousel || {};
      const data = E(JSON.stringify({ auto: !!c.auto, interval: c.interval || 4000, loop: true, pause: true, arrows: !!c.arrows && items.length > 1, dots: !!c.dots && items.length > 1, click: "none" }));
      const slides = items.map((m, i) => `<div class="m-slide${i === 0 ? " on" : ""}">${m.type === "video" ? `<video src="${E(m.src)}" controls preload="metadata"></video>` : `<img src="${E(m.src)}" alt="" loading="lazy">`}</div>`).join("");
      return `<div class="sc-media" style="aspect-ratio:${/^\d{1,2}\/\d{1,2}$/.test(cfg.ratio || "") ? cfg.ratio : "4/3"}">${items.length ? `<div class="m fx-slide" style="--v:1;--g:0px;--fit:${cfg.fit === "contain" ? "contain" : "cover"};--r:0px;--sp:500ms" data-cfg="${data}"><div class="m-track">${slides}</div></div>` : ""}</div>`;
    };
    const card = (cfg, cat, p, o) => {
      let body = "";
      for (const it of cfg.fields || []) {
        const f = F(cat, it.k), t = f ? text(f, p, o.lang, o.def) : "";
        if (!t) continue;
        const lab = L(f.label, o.lang, o.def);
        if (it.role === "title") body += `<h3 class="sc-t">${E(t)}</h3>`;
        else if (it.role === "badge") body += f.type === "multiselect" ? p.data[f.key].map((x) => `<span class="sc-b">${E(optT(f, x, o.lang, o.def))}</span>`).join("") : `<span class="sc-b">${E(t)}</span>`;
        else if (f.type === "url") body += /^https?:\/\//.test(t) ? `<div class="sc-f"><a href="${E(t)}" target="_blank" rel="noopener">${E(it.label ? lab : t)}</a></div>` : "";
        else body += `<div class="sc-f${f.type === "longtext" ? " sc-long" : ""}">${it.label ? `<span class="sc-l">${E(lab)}: </span>` : ""}${E(t)}</div>`;
      }
      const open = cfg.act === "details" || (cfg.inq && cfg.inq.on);
      return `<article class="sc-card" data-pid="${p.id}">${media(cfg, p)}<div class="sc-body">${body}${open ? `<button type="button" class="cb outline sc-more" data-act="sc-open" data-pid="${p.id}">${E(L(cfg.ui.more, o.lang, o.def))}</button>` : ""}</div></article>`;
    };
    const grid = (cfg, cat, o) => { const l = prep(cfg, cat, o); return l.length ? l.map((p) => card(cfg, cat, p, o)).join("") : `<p class="sc-empty">${E(L(cfg.ui.empty, o.lang, o.def))}</p>`; };
    const bar = (cfg, cat, o) => {
      const st = o.st || { q: "", f: {} }, ph = E(L(cfg.ui.search, o.lang, o.def)), all = E(L(cfg.ui.all, o.lang, o.def));
      let h = cfg.search ? `<input class="ci sc-q" type="search" placeholder="${ph}" aria-label="${ph}" value="${E(st.q || "")}">` : "";
      for (const k of cfg.filters || []) {
        const f = F(cat, k);
        if (!f || !f.opts || !f.opts.length) continue;
        const lab = E(L(f.label, o.lang, o.def));
        h += `<select class="ci sc-flt" data-k="${E(k)}" aria-label="${lab}"><option value="">${lab}: ${all}</option>${f.opts.map((x) => `<option value="${E(x.v)}"${st.f && st.f[k] === x.v ? " selected" : ""}>${E(L(x.t, o.lang, o.def) || x.v)}</option>`).join("")}</select>`;
      }
      return h ? `<div class="sc-bar">${h}</div>` : "";
    };
    // Поля заявки на товар (по ним сервер проверяет заявку); product — скрытое поле с номером товара
    const specs = (inq) => {
      const s = [{ name: "name", kind: "input", fmt: "text", req: true, min: 2, max: 80, opts: [] }, { name: "contact", kind: "input", fmt: inq.fmt || "phone", req: true, min: 0, max: 120, opts: [] }, { name: "comment", kind: "textarea", fmt: "text", req: false, min: 0, max: 1000, opts: [] }];
      if (inq.consent) s.push({ name: "consent", kind: "consent", fmt: "text", req: true, min: 0, max: 0, opts: [] });
      s.push({ name: "product", kind: "input", fmt: "text", req: true, min: 1, max: 12, opts: [] });
      return s;
    };
    // Окно товара: галерея, все поля, форма заявки (те же правила, что у обычных форм)
    const detail = (cfg, cat, p, o, bid) => {
      const ui = (n) => E(L(cfg.ui[n], o.lang, o.def));
      const tf = F(cat, ((cfg.fields || []).find((x) => x.role === "title") || {}).k) || cat.fields.find((f) => f.type === "text");
      let rows = "";
      for (const f of cat.fields) {
        const t = text(f, p, o.lang, o.def);
        if (!t || f === tf) continue;
        rows += f.type === "url" && /^https?:\/\//.test(t) ? `<div class="sc-f"><span class="sc-l">${E(L(f.label, o.lang, o.def))}: </span><a href="${E(t)}" target="_blank" rel="noopener">${E(t)}</a></div>` : `<div class="sc-f"><span class="sc-l">${E(L(f.label, o.lang, o.def))}: </span>${E(t)}</div>`;
      }
      let form = "";
      if (cfg.inq && cfg.inq.on) {
        const id = "s" + bid, sp = specs(cfg.inq), by = (n) => sp.find((x) => x.name === n);
        const wrap = (n, inner) => { const x = by(n); return `<div class="c" data-id="${id}-${n}" data-name="${n}" data-kind="${x.kind}" data-fmt="${x.fmt}" data-req="${x.req ? 1 : 0}" data-min="${x.min}" data-max="${x.max}">${inner}<small class="ce" role="alert" hidden></small></div>`; };
        const lab = (n, req) => `<label class="cl"><span>${ui(n)}</span>${req ? '<i class="rq" aria-hidden="true">*</i>' : ""}</label>`;
        const f = cfg.inq.fmt, type = f === "email" ? "email" : f === "phone" || f === "whatsapp" ? "tel" : "text";
        form += wrap("name", `${lab("lName", 1)}<input class="ci" type="text" autocomplete="name" maxlength="80">`);
        form += wrap("contact", `${lab("lContact", 1)}<input class="ci" type="${type}" autocomplete="${type === "tel" ? "tel" : type === "email" ? "email" : "off"}" maxlength="120">`);
        form += wrap("comment", `${lab("lComment", 0)}<textarea class="ci" rows="3" maxlength="1000"></textarea>`);
        if (cfg.inq.consent) form += wrap("consent", `<label class="co"><input type="checkbox"><span>${ui("consent")}${/^(https?:\/\/|\/(?!\/))/.test(cfg.inq.link || "") ? ` <a href="${E(cfg.inq.link)}" target="_blank" rel="noopener">${ui("linkText")}</a>` : ""}<i class="rq" aria-hidden="true">*</i></span></label>`);
        form += `<div class="c" hidden data-id="${id}-product" data-name="product" data-kind="input" data-fmt="text" data-req="1" data-min="1" data-max="12"><input type="hidden" value="${p.id}"></div>`;
        form += `<div class="c c-button" data-id="${id}"><button type="button" class="cb solid" data-act="submit" data-form="${E(cfg.inq.form || "inquiry")}" data-after="stay">${ui("send")}</button><small class="cs" role="status"></small></div>`;
        form = `<div class="sc-inq"><h4>${ui("inqTitle")}</h4>${form}</div>`;
      }
      return `<div class="sc-d"><div class="sc-dm">${media(cfg, p)}</div><div class="sc-dt"><h2>${E(tf ? text(tf, p, o.lang, o.def) : "")}</h2>${rows}</div>${form}</div>`;
    };
    return { prep, bar, grid, card, detail, specs, cards: (cfg, cat, o) => `${bar(cfg, cat, o)}<div class="sc-grid">${grid(cfg, cat, o)}</div>` };
  }
  const SC = scKit();

  // ---------- Фабрики блоков ----------
  const GRID_DEFAULTS = { cols: 80, colsM: 32, rows: 4, rowH: 8, gapX: 2, gapY: 2, padX: 0, padY: 0, radius: 0, bg: "", maxW: 0 };
  const GRID_BASE = { cols: 12, colsM: 4, rowH: 48 };
  const SIZES = { grid: [12, 4], text: [6, 2], media: [6, 5], lang: [3, 1], showcase: [12, 8], button: [3, 1], input: [6, 2], textarea: [6, 3], radio: [6, 3], checklist: [6, 3], select: [6, 2], consent: [8, 1], menu: [12, 1] };
  const layout = (key) => {
    const [cs, rs] = SIZES[key];
    return { d: { col: 1, row: 1, cs, rs }, m: { col: 1, row: 1, cs: GRID_BASE.colsM, rs } }; // d — десктоп, m — мобильный
  };

  const newGrid = (o = {}) => ({
    id: uid(), type: "grid", layout: layout("grid"),
    p: { ...GRID_DEFAULTS, ...o },
    children: [],
  });
  const newPara = (lang, text = "") => ({
    id: uid(), t: { [lang]: text }, tip: {},
    s: { size: 18, sizeM: 0, weight: 400, lh: 1.4, ls: 0, align: "start", dir: "", color: "#1e2b27",
         grad: false, g1: "#f4b63a", g2: "#d64a26", gAngle: 90, ov: false, ovColor: "#f4b63a", ovOp: 0.25 },
  });
  const newText = (lang, text) => ({ id: uid(), type: "text", layout: layout("text"), p: {}, paras: [newPara(lang, text)] });
  const newItem = (src, type = "image") => ({ id: uid(), type, src, alt: {}, autoplay: false, off: false }); // off — ячейка выключена (остаётся в блоке, но не показывается)
  const newMedia = () => ({
    id: uid(), type: "media", layout: layout("media"),
    p: {
      frame: { v: 1, vM: 1, orient: "h", orientM: "h", gap: 8, fit: "cover", radius: 0, bg: "" },   // «рамка»
      belt: { auto: false, interval: 4000, effect: "slide", speed: 500, loop: true, pauseHover: true, arrows: true, dots: true, limit: 0 }, // «лента»; limit — показывать первые N ячеек (0 — все)
      click: { action: "none", url: "" },
      showTip: true, // подсказка из библиотеки при наведении (для посетителей)
    },
    items: [],
  });
  const newOption = (lang, text, v) => ({ id: uid(), v: v ?? text, t: { [lang]: text }, action: "link", url: "", modal: "" });

  // Элемент управления: один тип блока, вид задаёт p.kind
  const newControl = (kind = "button", lang = "en") => {
    const id = uid();
    const p = {
      kind, name: "field_" + id.slice(0, 4), req: false, fmt: "text", min: 0, max: 0,
      label: {}, ph: {}, help: {}, err: {}, linkText: {}, link: "",
      options: [],
      btn: { style: "solid", action: "none", url: "", newTab: true, modal: "", form: "form1", ok: {}, after: "stay" },
      menu: "h",
      ac: "#f4b63a", fg: "#1e2b27", cr: 10, fs: 16,
    };
    const L = { button: "Button", input: "Label", textarea: "Message", radio: "Choose one", checklist: "Choose any", select: "Select", consent: "I agree to the", menu: "" }[kind];
    p.label[lang] = L;
    if (CHOICE.includes(kind) || kind === "menu") p.options = [1, 2, 3].map((i) => newOption(lang, (kind === "menu" ? "Item " : "Option ") + i, "opt" + i));
    if (kind === "consent") { p.linkText[lang] = "terms"; p.req = true; }
    if (kind === "select") p.ph[lang] = "Choose…";
    return { id, type: "control", layout: layout(kind), p };
  };
  // Витрина: карточки товаров из каталога (поля и товары живут в D1). Тексты интерфейса — по языкам.
  const newShowcase = (lang = "en") => ({
    id: uid(), type: "showcase", layout: layout("showcase"),
    p: {
      view: "grid", cols: 3, colsM: 1, gap: 12, radius: 12, bg: "#ffffff", ratio: "4/3", fit: "cover",
      carousel: { auto: false, interval: 4000, arrows: true, dots: true },   // медиа карточки
      fields: [],                                  // [{k, role: "title"|"text"|"badge", label: bool}] в порядке показа
      filters: [], search: true,                   // ключи полей для фильтров; строка поиска
      where: { k: "", v: "" }, sort: { k: "", dir: "asc" }, limit: 0,   // источник, сортировка, «первые N» (0 — все)
      act: "details",                              // details — окно товара; none — только карточка
      inq: { on: true, form: "inquiry", fmt: "phone", consent: true, link: "" }, // заявка на товар
      ui: { more: { [lang]: "Details" }, all: { [lang]: "All" }, empty: { [lang]: "Nothing found" }, search: { [lang]: "Search" },
            inqTitle: { [lang]: "Request this product" }, send: { [lang]: "Send request" }, lName: { [lang]: "Name" },
            lContact: { [lang]: "Contact" }, lComment: { [lang]: "Comment" }, consent: { [lang]: "I agree to the" }, linkText: { [lang]: "terms" }, ok: {} },
    },
  });
  const newLang = () => ({ id: uid(), type: "lang", layout: layout("lang"), p: { style: "select", ac: "#f4b63a", cr: 10, fs: 15 } });

  const newDoc = (o = {}) => (o.modal
    ? { v: 1, modal: { w: 560 }, root: newGrid({ rows: 6 }) }
    : { v: 1, root: newGrid({ rows: 10 }) });

  function clone(b) {
    const c = JSON.parse(JSON.stringify(b));
    (function re(x) {
      x.id = uid();
      (x.paras || []).forEach((p) => (p.id = uid()));
      (x.items || []).forEach((i) => (i.id = uid()));
      if (x.p && x.p.options) x.p.options.forEach((o) => (o.id = uid()));
      if (x.p && x.p.name) x.p.name = "field_" + x.id.slice(0, 4);
      (x.children || []).forEach(re);
    })(c);
    return c;
  }

  // ---------- Переводимые строки ----------
  // Ключи: p.<абзац> pt.<подсказка> a.<alt> c.<блок>.l/ph/h/e/lt/ok o.<вариант>
  // map — живой объект { язык: текст }, поэтому таблица переводов правит документ напрямую.
  function strings(doc) {
    const out = [];
    const add = (key, label, grp, map) => out.push({ key, label, grp, map });
    (function w(b) {
      if (b.type === "text") b.paras.forEach((p, i) => { add("p." + p.id, `¶${i + 1}`, "Текст", p.t); add("pt." + p.id, `¶${i + 1} · подсказка`, "Текст", (p.tip = p.tip || {})); });
      else if (b.type === "media") b.items.forEach((it, i) => { if (it.type !== "video") add("a." + it.id, `Фото ${i + 1} · alt`, "Медиа", (it.alt = it.alt || {})); });
      else if (b.type === "showcase") {
        const p = b.p, k = "s." + b.id + ".";
        for (const [n, lab] of [["more", "Кнопка «Подробнее»"], ["all", "Слово «Все» в фильтрах"], ["empty", "Пустой каталог"], ["search", "Плейсхолдер поиска"], ["inqTitle", "Заголовок заявки"], ["send", "Кнопка отправки заявки"], ["lName", "Подпись: имя"], ["lContact", "Подпись: контакт"], ["lComment", "Подпись: комментарий"], ["consent", "Текст согласия"], ["linkText", "Текст ссылки согласия"]]) add(k + n, lab, "Витрина", (p.ui[n] = p.ui[n] || {}));
        add("c.s" + b.id + ".ok", "Сообщение об успехе заявки", "Витрина", (p.ui.ok = p.ui.ok || {}));
      } else if (b.type === "control") {
        const p = b.p, g = "Элемент · " + p.kind, k = "c." + b.id + ".";
        const m = (n) => (p[n] = p[n] || {});
        if (p.kind !== "menu") add(k + "l", p.kind === "button" ? "Текст кнопки" : "Подпись", g, m("label"));
        if (["input", "textarea", "select"].includes(p.kind)) add(k + "ph", "Плейсхолдер", g, m("ph"));
        if (!["button", "menu"].includes(p.kind)) { add(k + "h", "Подсказка под полем", g, m("help")); add(k + "e", "Своя ошибка", g, m("err")); }
        if (p.kind === "consent") add(k + "lt", "Текст ссылки", g, m("linkText"));
        if (p.kind === "button" && p.btn.action === "submit") add(k + "ok", "Сообщение об успехе", g, (p.btn.ok = p.btn.ok || {}));
        (p.options || []).forEach((o, i) => add("o." + o.id, `Вариант ${i + 1}`, g, (o.t = o.t || {})));
      }
      (b.children || []).forEach(w);
    })(doc.root);
    return out;
  }

  // Словарь страницы: { язык: { ключ: текст } } + стандартные сообщения v.*
  function dict(docs, cfg, lib) {
    const D = {};
    cfg.langs.forEach((l) => (D[l.code] = {}));
    if (lib) docs.forEach((doc) => walk(doc.root, (b) => { // подсказки файлов (mt.<ячейка>) — из библиотеки
      if (b.type === "media" && b.p.showTip !== false) b.items.forEach((it) => { const e = libOf(it, lib); if (e) for (const [lc, v] of Object.entries(e.tip || {})) if (D[lc] && v) D[lc]["mt." + it.id] = v; });
    }));
    docs.forEach((doc) => strings(doc).forEach((s) => { for (const [lc, v] of Object.entries(s.map)) if (D[lc] && v) D[lc][s.key] = v; }));
    for (const l of cfg.langs) {
      const m = MSG[l.code] || MSG[cfg.defaultLang] || MSG.en;
      for (const k in m) D[l.code]["v." + k] = m[k];
    }
    return D;
  }

  // ---------- Обход: ссылки на окна и описание полей форм ----------
  function walk(b, fn) { fn(b); (b.children || []).forEach((c) => walk(c, fn)); }
  function modalRefs(doc) {
    const s = new Set();
    walk(doc.root, (b) => {
      if (b.type !== "control") return;
      if (b.p.kind === "button" && b.p.btn.action === "modal" && b.p.btn.modal) s.add(b.p.btn.modal);
      if (b.p.kind === "menu") b.p.options.forEach((o) => o.action === "modal" && o.modal && s.add(o.modal));
    });
    return [...s];
  }
  const specOf = (p) => ({ name: p.name, kind: p.kind, fmt: p.fmt, req: !!p.req, min: num(p.min), max: num(p.max), opts: CHOICE.includes(p.kind) ? p.options.map((o) => o.v) : [] });

  // Формы: каждая кнопка «Отправить» собирает поля своей области (страница или окно).
  // Метаданные уезжают на сервер вместе с HTML — по ним воркер проверяет заявки.
  function formsMeta(host, modals) {
    const forms = {};
    for (const doc of [host, ...modals.map((m) => m.doc)]) {
      const fields = [], names = new Set(), subs = new Set(), inq = [];
      let dup = "";
      walk(doc.root, (b) => {
        if (b.type === "showcase" && b.p.inq && b.p.inq.on) inq.push([b.p.inq.form || "inquiry", SC.specs(b.p.inq)]);
        if (b.type !== "control") return;
        if (!["button", "menu"].includes(b.p.kind)) { if (names.has(b.p.name)) dup = b.p.name; names.add(b.p.name); fields.push(specOf(b.p)); }
        if (b.p.kind === "button" && b.p.btn.action === "submit") subs.add(b.p.btn.form || "form1");
      });
      if (dup) return { error: `Повторяется имя поля «${dup}» в одной области (странице или окне)` };
      for (const f of subs) {
        if (forms[f] && JSON.stringify(forms[f]) !== JSON.stringify(fields)) return { error: `Имя формы «${f}» используется в разных окнах с разными полями` };
        forms[f] = fields;
      }
      for (const [f, sp] of inq) { // заявка на товар из витрины
        if (forms[f] && JSON.stringify(forms[f]) !== JSON.stringify(sp)) return { error: `Имя формы «${f}» используется с разными полями` };
        forms[f] = sp;
      }
    }
    return { forms };
  }

  // ---------- CSS ----------
  const mq = (s) => `@container pg (max-width:${BP}px){${s}}`;
  const axis = (o) => (o === "v"
    ? "flex-direction:column;--tx:0px;--ty:calc(var(--i)*-1*(100% + var(--g))/var(--v))"
    : "flex-direction:row;--tx:calc(var(--i)*-1*(100% + var(--g))/var(--v));--ty:0px");
  const rtlTx = "--tx:calc(var(--i)*(100% + var(--g))/var(--v))";

  function css(doc) {
    const out = [];
    const go = (b, parent) => {
      const s = ".b-" + b.id;
      if (parent) {
        const d = b.layout.d, m = b.layout.m;
        out.push(`${s}{grid-column:${num(d.col, 1)}/span ${num(d.cs, 1)};grid-row:${num(d.row, 1)}/span ${num(d.rs, 1)}}`);
        out.push(mq(`${s}{grid-column:${num(m.col, 1)}/span ${num(m.cs, 1)};grid-row:${num(m.row, 1)}/span ${num(m.rs, 1)}}`));
      }
      if (b.type === "grid") {
        const p = b.p, bg = col(p.bg);
        const gapX = num(p.gapX, num(p.gap)), gapY = num(p.gapY, num(p.gap));
        const padX = num(p.padX, num(p.pad)), padY = num(p.padY, num(p.pad));
        out.push(`${s}{display:grid;grid-template-columns:repeat(${num(p.cols, 12)},minmax(0,1fr));grid-template-rows:repeat(${num(p.rows, 1)},${num(p.rowH, 48)}px);grid-auto-rows:${num(p.rowH, 48)}px;column-gap:${gapX}px;row-gap:${gapY}px;padding:${padY}px ${padX}px;border-radius:${num(p.radius)}px;${bg ? `background:${bg};` : ""}${!parent && num(p.maxW) ? `max-width:${num(p.maxW)}px;margin:0 auto;` : ""}}`);
        out.push(mq(`${s}{grid-template-columns:repeat(${num(p.colsM, 4)},minmax(0,1fr))}`));
        b.children.forEach((c) => go(c, b));
      } else if (b.type === "text") {
        b.paras.forEach((pa) => {
          const t = pa.s, ps = ".p-" + pa.id;
          let r = `font-size:${num(t.size, 18)}px;font-weight:${num(t.weight, 400)};line-height:${num(t.lh, 1.4)};letter-spacing:${num(t.ls)}px;text-align:${["start", "center", "end", "justify"].includes(t.align) ? t.align : "start"};color:${col(t.color) || "inherit"};`;
          if (t.grad) r += `background:linear-gradient(${num(t.gAngle, 90)}deg,${col(t.g1) || "#000"},${col(t.g2) || "#000"});-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;`;
          if (t.ov) r += `--ovc:${col(t.ovColor) || "#000"};--ovo:${num(t.ovOp, 0.25)};`;
          out.push(`${ps}{${r}}`);
          if (num(t.sizeM) > 0) out.push(mq(`${ps}{font-size:${num(t.sizeM)}px}`));
        });
      } else if (b.type === "media") {
        const f = b.p.frame, bl = b.p.belt, bg = col(f.bg);
        const fit = ["cover", "contain", "fill"].includes(f.fit) ? f.fit : "cover";
        out.push(`${s}{--v:${num(f.v, 1)};--g:${num(f.gap)}px;--fit:${fit};--r:${num(f.radius)}px;--sp:${num(bl.speed, 500)}ms;${bg ? `background:${bg};` : ""}}`);
        out.push(`${s} .m-track{${axis(f.orient)}}`);
        if (f.orient !== "v") out.push(`[dir=rtl] ${s} .m-track{${rtlTx}}`);
        out.push(mq(`${s}{--v:${num(f.vM, 1)}}${s} .m-track{${axis(f.orientM)}}[dir=rtl] ${s} .m-track{${f.orientM === "v" ? "--tx:0px" : rtlTx}}`));
      } else if (b.type === "showcase") {
        const p = b.p;
        out.push(`${s}{--n:${num(p.cols, 3)};--g:${num(p.gap, 12)}px;--cr:${num(p.radius, 12)}px;--cbg:${col(p.bg) || "#fff"}}`);
        out.push(mq(`${s}{--n:${num(p.colsM, 1)}}`));
      } else if (b.type === "control" || b.type === "lang") {
        const p = b.p;
        out.push(`${s}{--ac:${col(p.ac) || "#f4b63a"};--fg:${col(p.fg) || "#1e2b27"};--cr:${num(p.cr, 10)}px;font-size:${num(p.fs, 16)}px}`);
      }
    };
    go(doc.root, null);
    return out.join("\n");
  }

  const BASE_CSS = `
.pg{container:pg/inline-size;width:100%}
.pg *{box-sizing:border-box}
.pg .b{min-width:0;min-height:0}
.p{margin:0 0 .4em;position:relative;white-space:pre-wrap;overflow-wrap:anywhere}
.p[data-tip]{cursor:help}
.p[data-tip]:hover::before,.p[data-tip]:focus::before{content:attr(data-tip);position:absolute;inset-inline-start:0;bottom:calc(100% + 6px);z-index:5;background:#1e2b27;color:#fff;-webkit-text-fill-color:#fff;font:400 13px/1.3 system-ui,sans-serif;letter-spacing:0;padding:6px 10px;border-radius:8px;white-space:normal;width:max-content;max-width:240px}
.p.ov::after{content:"";position:absolute;inset:0;pointer-events:none;background:var(--ovc);opacity:var(--ovo)}
.m{position:relative;overflow:hidden;border-radius:var(--r)}
.m-track{display:flex;width:100%;height:100%;gap:var(--g);transform:translate(var(--tx,0),var(--ty,0));transition:transform var(--sp) ease}
.m-slide{flex:0 0 calc((100% - var(--g)*(var(--v) - 1))/var(--v));min-width:0;min-height:0;position:relative;overflow:hidden}
.m-slide>img,.m-slide>video,.m-slide>a,.m-slide>a>img,.m-slide>a>video{width:100%;height:100%;display:block}
.m-slide img,.m-slide video{object-fit:var(--fit)}
.fx-fade .m-track{display:block;position:relative;transform:none}
.fx-fade .m-slide{position:absolute;inset:0;opacity:0;transition:opacity var(--sp) ease}
.fx-fade .m-slide.on{opacity:1}
.fx-fade .m-slide:not(.on){pointer-events:none}
.m-slide[data-tip]:hover::after{content:attr(data-tip);position:absolute;inset-inline:8px;bottom:8px;z-index:3;background:#1e2b27;color:#fff;font:400 13px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:8px;white-space:pre-line;pointer-events:none}
.fx-none .m-track,.fx-none .m-slide{transition:none}
.m-arrow{position:absolute;top:50%;translate:0 -50%;z-index:2;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.85);color:#1e2b27;font-size:22px;line-height:1;cursor:pointer}
.m-prev{inset-inline-start:8px}.m-next{inset-inline-end:8px}
.m-prev::before{content:"‹"}.m-next::before{content:"›"}
[dir=rtl] .m-prev::before{content:"›"}[dir=rtl] .m-next::before{content:"‹"}
.m-dots{position:absolute;bottom:8px;inset-inline:0;display:flex;justify-content:center;gap:6px;z-index:2}
.m-dots button{width:9px;height:9px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.55);cursor:pointer}
.m-dots button.on{background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.sc{overflow:auto}.sc-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.sc-bar .ci{width:auto;flex:1 1 160px}
.sc-grid{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:var(--g,12px)}.sc-list .sc-grid{grid-template-columns:1fr}.sc-list .sc-card{flex-direction:row}.sc-list .sc-media{width:36%;flex:none}
.sc-card{display:flex;flex-direction:column;background:var(--cbg,#fff);border:1px solid #cfd8d2;border-radius:var(--cr,12px);overflow:hidden;color:#1e2b27;cursor:pointer}
.sc-media{position:relative;background:#e9eeeb;overflow:hidden}.sc-media .m{position:absolute;inset:0}
.sc-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;flex:1}.sc-t{margin:0;font-size:1.05em}.sc-f{font-size:.92em}.sc-l{opacity:.7}.sc-long{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sc-b{display:inline-block;background:#e9eeeb;border-radius:999px;padding:1px 9px;font-size:.8em;margin-inline-end:4px}.sc-more{margin-top:auto;min-height:2.2em}.sc-empty{opacity:.7;grid-column:1/-1}
.sc .m-track{flex-direction:row;--tx:calc(var(--i)*-1*(100% + var(--g))/var(--v));--ty:0px}[dir=rtl] .sc .m-track{--tx:calc(var(--i)*(100% + var(--g))/var(--v))}
.c[hidden]{display:none}.sc-dlg{--mw:780px}.sc-d{padding:16px;display:grid;gap:14px}.sc-dm{max-width:100%}.sc-dt h2{margin:0 0 6px}.sc-inq{border-top:1px solid #cfd8d2;padding-top:12px;display:grid;gap:8px}.sc-inq h4{margin:0}
.lb{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.85);display:grid;place-items:center;cursor:zoom-out}
.lb img,.lb video{max-width:94vw;max-height:94vh}
.c{display:flex;flex-direction:column;gap:4px;color:#1e2b27;font-family:inherit}
.c fieldset{border:0;margin:0;padding:0;min-width:0}
.cl{font-weight:600;display:block}.rq{color:#d64a26;font-style:normal;margin-inline-start:3px}
.ci{width:100%;padding:.55em .8em;border:2px solid #1e2b27;border-radius:var(--cr,10px);font:inherit;color:#1e2b27;background:#fff}
textarea.ci{flex:1;resize:none}
.ci:focus-visible,.cb:focus-visible,.co input:focus-visible{outline:3px solid #d64a26;outline-offset:2px}
.co{display:flex;align-items:center;gap:.5em;margin:.2em 0}
.co input{width:1.1em;height:1.1em;accent-color:#1e2b27;flex:none}
.co a{color:inherit}
.ch{opacity:.7;font-size:.85em}
.ce{color:#d64a26;font-size:.85em}.c.bad .ci{border-color:#d64a26}
.cs{font-size:.9em;min-height:1.2em}
.c-button{gap:2px}
.cb{display:inline-flex;align-items:center;justify-content:center;flex:1;width:100%;min-height:2.4em;padding:.4em 1em;font:inherit;font-weight:700;text-decoration:none;color:var(--fg,#1e2b27);background:var(--ac,#f4b63a);border:2px solid #1e2b27;border-radius:var(--cr,10px);cursor:pointer}
.cb.outline{background:transparent;color:#1e2b27}
.cb.link{background:none;border-color:transparent;text-decoration:underline;color:#1e2b27}
.cb:disabled{opacity:.6;cursor:wait}
.cm{display:flex;gap:.4em;flex-wrap:wrap;align-items:center}.cm.v{flex-direction:column;align-items:stretch}
.cm a,.cm button{font:inherit;font-weight:600;color:#1e2b27;text-decoration:none;background:none;border:0;padding:.4em .8em;border-radius:var(--cr);cursor:pointer;text-align:start}
.cm a:hover,.cm button:hover{background:var(--ac)}
.ls select{font:inherit;padding:.4em .8em;border:2px solid #1e2b27;border-radius:var(--cr);background:#fff;color:#1e2b27}
.ls .lsb{display:flex;gap:.4em;flex-wrap:wrap}
.ls .lsb button{font:inherit;font-weight:600;padding:.35em .8em;border:2px solid #1e2b27;border-radius:var(--cr);background:#fff;color:#1e2b27;cursor:pointer}
.ls .lsb button.on{background:var(--ac)}
.md{border:0;border-radius:16px;padding:0;width:min(var(--mw,560px),94vw);max-height:92vh;overflow:auto;color:#1e2b27;background:#fff}
.md::backdrop{background:rgba(0,0,0,.5)}
.md-x{position:absolute;top:8px;inset-inline-end:8px;z-index:3;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 1px #1e2b27;font-size:16px;cursor:pointer}
`;

  // ---------- HTML ----------
  const T = (m, o) => esc(m?.[o.lang] ?? m?.[o.def] ?? "");
  const I = (o, pairs) => (o.pub ? ` data-i="${pairs}"` : ""); // пометка переводимого элемента для публикации

  function ctl(b, o) {
    const p = b.p, id = b.id, k = p.kind, ed = o.edit ? ` data-bid="${id}"` : "";
    const field = !["button", "menu"].includes(k);
    const attrs = ` data-id="${id}"` + (field
      ? ` data-name="${esc(p.name)}" data-kind="${k}" data-fmt="${esc(p.fmt)}" data-req="${p.req ? 1 : 0}" data-min="${num(p.min)}" data-max="${num(p.max)}"${CHOICE.includes(k) ? ` data-opts="${esc(JSON.stringify(p.options.map((x) => x.v)))}"` : ""}` : "");
    const root = (inner) => `<div class="b b-control b-${id} c c-${k}"${ed}${attrs}>${inner}</div>`;
    const rq = p.req ? '<i class="rq" aria-hidden="true">*</i>' : "";
    const lab = (tag = "label", f = "") => `<${tag} class="cl"${f}><span${I(o, "text:c." + id + ".l")}>${T(p.label, o)}</span>${rq}</${tag}>`;
    const help = has(p.help) ? `<small class="ch"${I(o, "text:c." + id + ".h")}>${T(p.help, o)}</small>` : "";
    const err = '<small class="ce" role="alert" hidden></small>';
    const opts = (type) => p.options.map((x) => `<label class="co"><input type="${type}" name="r-${id}" value="${esc(x.v)}"><span${I(o, "text:o." + x.id)}>${T(x.t, o)}</span></label>`).join("");

    if (k === "button") {
      const bt = p.btn, st = ["solid", "outline", "link"].includes(bt.style) ? bt.style : "solid";
      const txt = `<span${I(o, "text:c." + id + ".l")}>${T(p.label, o)}</span>`;
      if (bt.action === "link" && url(bt.url)) return root(`<a class="cb ${st}" href="${esc(url(bt.url))}"${bt.newTab ? ' target="_blank" rel="noopener"' : ""}>${txt}</a>`);
      return root(`<button type="button" class="cb ${st}" data-act="${esc(bt.action)}" data-modal="${esc(bt.modal)}" data-form="${esc(bt.form)}" data-after="${esc(bt.after)}">${txt}</button>${bt.action === "submit" ? '<small class="cs" role="status"></small>' : ""}`);
    }
    if (k === "menu") {
      const items = p.options.map((x) => {
        const t = `<span${I(o, "text:o." + x.id)}>${T(x.t, o)}</span>`;
        return x.action === "modal" ? `<button type="button" data-act="modal" data-modal="${esc(x.modal)}">${t}</button>` : `<a href="${esc(url(x.url) || "#")}">${t}</a>`;
      }).join("");
      return root(`<nav class="cm ${p.menu === "v" ? "v" : "h"}">${items}</nav>`);
    }
    const ph = ` placeholder="${T(p.ph, o)}"${I(o, "placeholder:c." + id + ".ph")}`;
    const mx = num(p.max) ? ` maxlength="${num(p.max)}"` : "";
    if (k === "input") {
      const f = p.fmt, type = f === "email" ? "email" : f === "phone" || f === "whatsapp" ? "tel" : f === "url" ? "url" : "text";
      const ac = { email: "email", phone: "tel", whatsapp: "tel", url: "url" }[f] || "off";
      const im = f === "number" ? ' inputmode="decimal"' : f === "phone" || f === "whatsapp" ? ' inputmode="tel"' : "";
      return root(`${lab("label", ` for="f-${id}"`)}<input class="ci" id="f-${id}" type="${type}"${im} autocomplete="${ac}"${ph}${mx}>${help}${err}`);
    }
    if (k === "textarea") return root(`${lab("label", ` for="f-${id}"`)}<textarea class="ci" id="f-${id}"${ph}${mx}></textarea>${help}${err}`);
    if (k === "select") {
      return root(`${lab("label", ` for="f-${id}"`)}<select class="ci" id="f-${id}"><option value=""${I(o, "text:c." + id + ".ph")}>${T(p.ph, o)}</option>${p.options.map((x) => `<option value="${esc(x.v)}"${I(o, "text:o." + x.id)}>${T(x.t, o)}</option>`).join("")}</select>${help}${err}`);
    }
    if (k === "radio" || k === "checklist") return root(`<fieldset>${lab("legend")}${opts(k === "radio" ? "radio" : "checkbox")}</fieldset>${help}${err}`);
    // consent
    const link = url(p.link) ? ` <a href="${esc(url(p.link))}" target="_blank" rel="noopener"${I(o, "text:c." + id + ".lt")}>${T(p.linkText, o)}</a>` : "";
    return root(`<label class="co"><input type="checkbox"><span><span${I(o, "text:c." + id + ".l")}>${T(p.label, o)}</span>${link}${rq}</span></label>${help}${err}`);
  }

  function html(b, o) {
    const ed = o.edit ? ` data-bid="${b.id}"` : "";
    const cls = `b b-${b.type} b-${b.id}`;
    if (b.type === "grid") return `<div class="${cls}"${ed}>${b.children.map((c) => html(c, o)).join("")}</div>`;
    if (b.type === "control") return ctl(b, o);
    if (b.type === "showcase") { // на сайте карточки рисует скрипт из /api/catalog; в редакторе — тот же код по каталогу редактора
      const so = { lang: o.lang, def: o.def, st: { q: "", f: {} } };
      const inner = o.edit ? (o.cat && o.cat.fields ? SC.cards(b.p, o.cat, so) : `<p class="sc-empty">…</p>`) : "";
      return `<div class="${cls} sc sc-${b.p.view === "list" ? "list" : "grid"}"${ed}${o.edit ? "" : ` data-sc="${esc(JSON.stringify({ ...b.p, id: b.id }))}"`}>${inner}</div>`;
    }
    if (b.type === "lang") {
      const prev = o.edit ? `<select disabled>${(o.langs || []).map((l) => `<option>${esc(l.name)}</option>`).join("")}</select>` : "";
      return `<div class="${cls} ls" data-ls="${b.p.style === "buttons" ? "buttons" : "select"}"${ed}>${prev}</div>`;
    }
    if (b.type === "text") {
      const ps = b.paras.map((p) => {
        const s = p.s, tip = p.tip?.[o.lang] ?? p.tip?.[o.def] ?? "";
        const dir = ["ltr", "rtl", "auto"].includes(s.dir) ? ` dir="${s.dir}"` : "";
        return `<p class="p p-${p.id}${s.ov ? " ov" : ""}"${dir}${tip ? ` data-tip="${esc(tip)}" tabindex="0"` : ""}${o.edit ? ` data-pid="${p.id}"` : ""}${I(o, `text:p.${p.id};data-tip:pt.${p.id}`)}>${T(p.t, o)}</p>`;
      });
      return `<div class="${cls}"${ed}>${ps.join("")}</div>`;
    }
    // media
    const f = b.p.frame, bl = b.p.belt, c = b.p.click;
    const eff = bl.effect === "none" ? "none" : bl.effect === "fade" && num(f.v, 1) === 1 && num(f.vM, 1) === 1 ? "fade" : "slide";
    let act = b.items.filter((it) => !it.off); // выключенные ячейки не показываются
    if (num(bl.limit) > 0) act = act.slice(0, num(bl.limit));
    const slides = act.map((it, i) => {
      const src = esc(url(it.src));
      let m = it.type === "video"
        ? `<video src="${src}" ${it.autoplay ? "autoplay muted loop playsinline" : "controls"} preload="metadata"></video>`
        : `<img src="${src}" alt="${T(it.alt, o)}"${I(o, "alt:a." + it.id)} loading="lazy" draggable="false">`;
      if (c.action === "link" && url(c.url)) m = `<a href="${esc(url(c.url))}" target="_blank" rel="noopener">${m}</a>`;
      // Подсказка файла: в редакторе — имя, текст и теги; на сайте — только текст подсказки
      const ent = libOf(it, o.lib);
      let tip = "";
      if (ent && o.edit) tip = ` data-tip="${esc([ent.name, ent.tip?.[o.lang] ?? ent.tip?.[o.def] ?? "", (ent.tags || []).map((x) => "#" + x).join(" ")].filter(Boolean).join("\n"))}"`;
      else if (ent && b.p.showTip !== false && has(ent.tip)) tip = ` data-tip="${esc(T(ent.tip, o))}"${I(o, "data-tip:mt." + it.id)}`;
      return `<div class="m-slide${i === 0 ? " on" : ""}"${tip}>${m}</div>`;
    });
    const cfg = { auto: !!bl.auto, interval: num(bl.interval, 4000), loop: bl.loop !== false, pause: bl.pauseHover !== false, arrows: !!bl.arrows, dots: !!bl.dots, click: c.action };
    return `<div class="b b-media b-${b.id} m fx-${eff}"${ed} data-cfg="${esc(JSON.stringify(cfg))}"><div class="m-track">${slides.join("")}</div></div>`;
  }

  // ---------- Скрипт страницы ----------
  // Карусель, окна, переводы, переключатель языков, проверка и отправка форм.
  function runtime() {
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];

    /* карусели */
    const initCarousel = (el) => {
      if (el._pm) return;
      el._pm = 1;
      const c = JSON.parse(el.dataset.cfg), track = el.querySelector(".m-track"), slides = [...track.children], n = slides.length;
      if (!n) return;
      let i = 0, t = null, dots = null;
      const vis = () => Math.max(1, parseInt(getComputedStyle(el).getPropertyValue("--v")) || 1);
      const max = () => Math.max(0, n - vis());
      const go = (k) => {
        const m = max();
        i = k > m ? (c.loop ? 0 : m) : k < 0 ? (c.loop ? m : 0) : k;
        track.style.setProperty("--i", i);
        slides.forEach((s, j) => s.classList.toggle("on", j === i));
        if (dots) [...dots.children].forEach((d, j) => d.classList.toggle("on", j === i));
      };
      const restart = () => { clearInterval(t); if (c.auto && n > vis()) t = setInterval(() => go(i + 1), c.interval); };
      const btn = (cls, label, fn) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = cls; b.setAttribute("aria-label", label);
        b.onclick = (e) => { e.stopPropagation(); fn(); restart(); };
        el.appendChild(b); return b;
      };
      if (c.arrows && n > 1) { btn("m-arrow m-prev", "prev", () => go(i - 1)); btn("m-arrow m-next", "next", () => go(i + 1)); }
      const build = () => {
        go(Math.min(i, max()));
        if (!c.dots) return;
        if (!dots) { dots = document.createElement("div"); dots.className = "m-dots"; el.appendChild(dots); }
        const k = max() + 1;
        dots.textContent = "";
        for (let j = 0; j < k; j++) {
          const d = document.createElement("button");
          d.type = "button"; d.setAttribute("aria-label", String(j + 1));
          d.onclick = (e) => { e.stopPropagation(); go(j); restart(); };
          dots.appendChild(d);
        }
        dots.style.display = k > 1 ? "" : "none";
        go(i);
      };
      if (c.click === "next" || c.click === "lightbox") {
        el.style.cursor = c.click === "next" ? "pointer" : "zoom-in";
        slides.forEach((s) => s.addEventListener("click", () => {
          if (c.click === "next") { go(i + 1); restart(); return; }
          const m = s.querySelector("img,video"); if (!m) return;
          const o = document.createElement("div"); o.className = "lb";
          const x = m.cloneNode(); x.removeAttribute("loading"); if (x.tagName === "VIDEO") x.controls = true;
          o.appendChild(x); o.onclick = () => o.remove(); document.body.appendChild(o);
        }));
      }
      if (c.pause) { el.addEventListener("mouseenter", () => clearInterval(t)); el.addEventListener("mouseleave", restart); }
      new ResizeObserver(() => { build(); restart(); }).observe(el);
      build(); restart();
    };
    $$(".m[data-cfg]").forEach(initCarousel);
    addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".lb").forEach((o) => o.remove()); });

    /* переводы */
    const J = document.getElementById("pm-i18n");
    const I18N = J ? JSON.parse(J.textContent) : { def: "en", langs: [], D: { en: {} } };
    let cur = I18N.def;
    const tr = (k) => (I18N.D[cur] && I18N.D[cur][k]) || (I18N.D[I18N.def] && I18N.D[I18N.def][k]) || "";
    const refreshErrors = () => $$("[data-name].bad").forEach((c) => showErr(c, c.dataset.ek));
    const apply = (code) => {
      cur = code;
      const L = I18N.langs.find((l) => l.code === code) || { dir: "ltr" };
      document.documentElement.lang = code;
      document.documentElement.dir = L.dir;
      $$("[data-i]").forEach((e) => e.dataset.i.split(";").forEach((pair) => {
        const x = pair.indexOf(":"), a = pair.slice(0, x), v = tr(pair.slice(x + 1));
        if (a === "text") e.textContent = v;
        else if (v) e.setAttribute(a, v);
        else e.removeAttribute(a);
      }));
      $$(".sc[data-sc]").forEach((b) => b._draw && b._draw()); // витрина перерисовывается на новом языке
      $$(".ls [data-code]").forEach((b) => b.classList.toggle("on", b.dataset.code === code));
      $$(".ls select").forEach((s) => (s.value = code));
      refreshErrors();
    };

    /* переключатель языков */
    const selectors = $$(".ls[data-ls]");
    selectors.forEach((box) => {
      if (box.dataset.ls === "buttons") {
        const w = document.createElement("div"); w.className = "lsb";
        I18N.langs.forEach((l) => {
          const b = document.createElement("button");
          b.type = "button"; b.dataset.code = l.code; b.textContent = l.name; b.lang = l.code;
          b.onclick = () => choose(l.code);
          w.appendChild(b);
        });
        box.appendChild(w);
      } else {
        const s = document.createElement("select"); s.setAttribute("aria-label", "Language");
        I18N.langs.forEach((l) => { const o = document.createElement("option"); o.value = l.code; o.textContent = l.name; s.appendChild(o); });
        s.onchange = () => choose(s.value);
        box.appendChild(s);
      }
    });
    const choose = (code) => { apply(code); try { localStorage.setItem("pm-lang", code); } catch (e) {} };
    if (selectors.length) { // на страницах без переключателя язык не меняется сам
      let want = new URLSearchParams(location.search).get("lang");
      try { want = want || localStorage.getItem("pm-lang"); } catch (e) {}
      if (!want) want = (navigator.languages || []).map((x) => x.slice(0, 2)).find((x) => I18N.langs.some((l) => l.code === x));
      apply(I18N.langs.some((l) => l.code === want) ? want : I18N.def);
    }

    /* окна */
    $$("dialog.md").forEach((d) => {
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
      d.querySelector(".md-x").onclick = () => d.close();
    });

    /* формы */
    const specOf = (c) => ({ kind: c.dataset.kind, fmt: c.dataset.fmt, req: c.dataset.req === "1", min: +c.dataset.min || 0, max: +c.dataset.max || 0, opts: c.dataset.opts ? JSON.parse(c.dataset.opts) : [] });
    const valOf = (c) => {
      const k = c.dataset.kind;
      if (k === "checklist") return $$("input:checked", c).map((x) => x.value);
      if (k === "radio") { const x = c.querySelector("input:checked"); return x ? x.value : ""; }
      if (k === "consent") return c.querySelector("input").checked;
      return c.querySelector("input,textarea,select").value;
    };
    function showErr(c, key) {
      const e = c.querySelector(".ce");
      c.classList.toggle("bad", !!key); c.dataset.ek = key || "";
      if (!e) return;
      if (!key) { e.hidden = true; e.textContent = ""; return; }
      e.textContent = tr("c." + c.dataset.id + ".e") || tr(key); e.hidden = false;
    }
    const check = (e) => {
      const c = e.target.closest && e.target.closest("[data-name]");
      if (!c) return;
      if (e.type === "focusout" && valOf(c) === "" && !c.classList.contains("bad")) return;
      showErr(c, validateField(specOf(c), valOf(c)));
    };
    document.addEventListener("focusout", check);
    document.addEventListener("change", check);

    /* капча Turnstile: невидимая, виджет появляется только если Cloudflare сомневается */
    const TS = { ids: new Map(), wait: new Map(), lib: null };
    const loadTs = () => window.turnstile ? Promise.resolve(window.turnstile) : TS.lib || (TS.lib = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
      s.onload = () => ok(window.turnstile); s.onerror = () => no(new Error("turnstile"));
      document.head.appendChild(s);
    }));
    const tsToken = (btn) => loadTs().then((t) => new Promise((resolve, reject) => {
      let id = TS.ids.get(btn);
      if (id === undefined) {
        const host = document.createElement("div"); host.className = "ts"; btn.closest(".c").appendChild(host);
        const done = (tok, err) => { const w = TS.wait.get(btn); if (!w) return; TS.wait.delete(btn); err ? w.no(new Error("captcha")) : w.ok(tok); };
        id = t.render(host, { sitekey: I18N.ts, appearance: "interaction-only", execution: "execute",
          callback: (tok) => done(tok), "error-callback": () => done("", true), "timeout-callback": () => done("", true) });
        TS.ids.set(btn, id);
      }
      TS.wait.set(btn, { ok: resolve, no: reject });
      t.reset(id); t.execute(id); // токен одноразовый: каждый раз новый
      setTimeout(() => { const w = TS.wait.get(btn); if (w) { TS.wait.delete(btn); w.no(new Error("timeout")); } }, 30000);
    }));

    async function submit(btn) {
      const dlg = btn.closest("dialog"), box = btn.closest(".c"), st = box.querySelector(".cs");
      const say = (k, custom) => { if (st) st.textContent = custom || tr(k); };
      const fields = $$("[data-name]").filter((c) => c.closest("dialog") === dlg);
      const data = {};
      let bad = null;
      fields.forEach((c) => { const v = valOf(c), er = validateField(specOf(c), v); showErr(c, er); if (er && !bad) bad = c; data[c.dataset.name] = v; });
      if (bad) { const f = bad.querySelector("input,textarea,select"); if (f) f.focus(); say("v.required", ""); return; }
      say("v.sending"); btn.disabled = true;
      let ts = "";
      if (I18N.ts) { try { ts = await tsToken(btn); } catch (e) { say("v.captcha"); btn.disabled = false; return; } }
      try {
        const r = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: document.querySelector("meta[name=pm-slug]").content, form: btn.dataset.form, lang: cur, data, ts }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          say("v.sent", tr("c." + box.dataset.id + ".ok"));
          fields.forEach((c) => { $$("input,textarea,select", c).forEach((x) => { if (x.type === "checkbox" || x.type === "radio") x.checked = false; else x.value = ""; }); showErr(c, ""); });
          if (btn.dataset.after === "close" && dlg) setTimeout(() => dlg.close(), 1500);
        } else if (r.status === 422 && j.fields) {
          fields.forEach((c) => j.fields[c.dataset.name] && showErr(c, j.fields[c.dataset.name]));
          say("v.required", "");
        } else say(r.status === 429 ? "v.rate" : r.status === 403 ? "v.captcha" : "v.fail");
      } catch (e) { say("v.fail"); }
      btn.disabled = false;
    }
    /* витрина: каталог берётся из /api/catalog при открытии страницы, правки видны без повторной публикации */
    const SC = scKit();
    let CAT = null, CATP = null;
    const loadCat = () => CATP || (CATP = fetch("/api/catalog").then((r) => r.json()).then((c) => (CAT = c)).catch(() => (CAT = { fields: [], products: [] })));
    $$(".sc[data-sc]").forEach((box) => {
      const cfg = JSON.parse(box.dataset.sc), st = { q: "", f: {} };
      const o = () => ({ lang: cur, def: I18N.def, st });
      const grid = () => { box.querySelector(".sc-grid").innerHTML = SC.grid(cfg, CAT, o()); $$(".m[data-cfg]", box).forEach(initCarousel); };
      const draw = () => { if (!CAT) return; box.innerHTML = SC.bar(cfg, CAT, o()) + '<div class="sc-grid"></div>'; grid(); };
      box._draw = draw;
      loadCat().then(draw);
      box.addEventListener("input", (e) => { if (e.target.classList.contains("sc-q")) { st.q = e.target.value; grid(); } });
      box.addEventListener("change", (e) => { if (e.target.classList.contains("sc-flt")) { st.f[e.target.dataset.k] = e.target.value; grid(); } });
      box.addEventListener("click", (e) => {
        if (!CAT || e.target.closest(".m-arrow,.m-dots,video,a")) return;
        const card = e.target.closest(".sc-card");
        if (!card || (cfg.act !== "details" && !(cfg.inq && cfg.inq.on))) return;
        const p = CAT.products.find((x) => x.id === +card.dataset.pid);
        if (!p) return;
        let d = document.getElementById("sc-" + cfg.id);
        if (!d) { d = document.createElement("dialog"); d.className = "md sc-dlg"; d.id = "sc-" + cfg.id; d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }); document.body.appendChild(d); }
        d.innerHTML = '<button type="button" class="md-x" aria-label="Close">✕</button>' + SC.detail(cfg, CAT, p, o(), cfg.id);
        d.querySelector(".md-x").onclick = () => d.close();
        $$(".m[data-cfg]", d).forEach(initCarousel);
        d.showModal();
      });
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "modal") { const d = document.getElementById("md-" + b.dataset.modal); if (d && d.showModal) d.showModal(); }
      else if (a === "close") { const d = b.closest("dialog"); if (d) d.close(); }
      else if (a === "submit") submit(b);
    });
  }
  const RUNTIME = "(function(){const validateField=" + validateField.toString() + ";const scKit=" + scKit.toString() + ";(" + runtime.toString() + ")();})()";

  // Готовая страница. modals — окна, которые вызываются со страницы: [{ slug, doc }]
  function page(doc, cfg, o = {}) {
    const lang = o.lang || cfg.defaultLang, def = cfg.defaultLang;
    const L = (cfg.langs || []).find((l) => l.code === lang) || { dir: "ltr" };
    const modals = o.modals || [];
    const op = { lang, def, pub: true, lib: o.lib };
    const docs = [doc, ...modals.map((m) => m.doc)];
    const i18n = JSON.stringify({ def, langs: cfg.langs, D: dict(docs, cfg, o.lib), ts: cfg.turnstileSiteKey || "" }).replace(/</g, "\\u003c");
    const dlgs = modals.map((m) => `<dialog class="md" id="md-${esc(m.slug)}" style="--mw:${num(m.doc.modal && m.doc.modal.w, 560)}px"><button type="button" class="md-x" aria-label="Close">✕</button><div class="pg">${html(m.doc.root, op)}</div></dialog>`).join("");
    return `<!doctype html><html lang="${esc(lang)}" dir="${L.dir === "rtl" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="pm-slug" content="${esc(o.slug || "")}"><title>${esc(o.title || cfg.siteTitle)}</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic","Noto Sans Hebrew",Arial,sans-serif;-webkit-text-size-adjust:100%}${BASE_CSS}${docs.map(css).join("\n")}</style></head><body><div class="pg">${html(doc.root, op)}</div>${dlgs}<script type="application/json" id="pm-i18n">${i18n}</script><script>${RUNTIME}</script></body></html>`;
  }

  return { BP, BLOCK_TYPES, KINDS, CHOICE, FMTS, DEFAULT_CONFIG, GRID_DEFAULTS, GRID_BASE, MSG, BASE_CSS, RUNTIME, esc, uid, has,
    validateField, specOf, SC, strings, dict, modalRefs, formsMeta, libOf,
    newDoc, newGrid, newText, newPara, newMedia, newItem, newOption, newControl, newLang, newShowcase, clone, css, html, page };
})();
if (typeof module !== "undefined") module.exports = PM;
