/* Редактор сайтов — фаза 1: дерево блоков, сетка, текст, медиа, публикация.
   Модель: S.page.doc = { v:1, root: <grid> }; блоки: grid | text | media.
   Все правки меняют doc, затем: touch() — перерисовать холст, commit() — история + автосохранение. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  };

  const ICON = { grid: "▦", text: "¶", media: "🖼", control: "⌨", lang: "🌐", showcase: "🛍" };
  const LABEL = { grid: _t("Сетка"), text: _t("Текст"), media: _t("Медиа"), control: _t("Элемент"), lang: _t("Языки"), showcase: _t("Витрина") };
  const KIND_LABEL = { button: _t("Кнопка"), input: _t("Поле ввода"), textarea: _t("Текстовая область"), radio: _t("Радио-кнопки"), checklist: _t("Чек-лист"), select: _t("Выпадающий список"), consent: _t("Согласие (галочка)"), menu: _t("Меню") };
  const KIND_ICON = { button: "🔘", input: "▭", textarea: "▤", radio: "◉", checklist: "☑", select: "▾", consent: "✔", menu: "☰" };
  const FMT_LABEL = { text: _t("Текст"), email: "Email", phone: _t("Телефон"), telegram: _t("Telegram-ник"), whatsapp: _t("WhatsApp (номер)"), url: _t("Ссылка"), number: _t("Число") };

  const S = {
    token: sessionStorage.getItem("pm-token") || "",
    cfg: null, pages: [], page: null, r2: false,
    dev: "d",            // d — десктоп, m — мобильный
    lang: "en",          // язык редактирования/превью
    sel: null,           // { bid, pid }
    hist: [], hi: -1,
    timer: null, dirty: false, saving: false, err: false,
    lib: {}, libList: [], libStats: null, q: "", tag: "", queue: [], upTarget: null,
    libHasMedia: false, libForceVisible: false, libPinned: false, libHover: false,
    ctx: null,           // контекст палитры: { bid, cell } — где сделан правый клик
    back: [],            // стек страниц: из кнопки можно перейти править окно и вернуться
  };

  // ---------- Язык интерфейса ----------
  // Коды ошибок сервера, понятные человеку, на языке интерфейса
  const apiErr = (m) => ({
    mail_not_configured: _t("Почта не настроена: нужны NOTIFY_FROM и RESEND_API_KEY либо привязка EMAIL (см. README)."),
    no_recipients: _t("В настройках не указаны получатели"),
  }[m] || m);
  // Подписи таблицы переводов приходят из render.js на русском: переводим их здесь.
  const trLabel = (s) => { const m = String(s).match(/^(.*?)(\d+)(.*)$/); return m ? _t(m[1] + "{0}" + m[3], m[2]) : _t(s); };
  const trGrp = (g) => { const [a, ...r] = String(g).split(" · "); return [_t(a), ...r].join(" · "); };
  // Статические подписи из index.html (заголовки, подсказки, кнопки) переводятся при старте
  function translateStatic() {
    const CY = /[А-Яа-яЁё]/;
    document.querySelectorAll("[title],[placeholder]").forEach((e) => ["title", "placeholder"].forEach((a) => { const v = e.getAttribute(a); if (v && CY.test(v)) e.setAttribute(a, _t(v)); }));
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t && CY.test(t)) n.nodeValue = n.nodeValue.replace(t, _t(t)); }
    document.documentElement.lang = UI.lang;
    document.documentElement.dir = UI.dirs[UI.lang] || "ltr";
    const u = $("#uilang");
    UI.langs().forEach((c) => u.append(el("option", { value: c }, UI.names[c])));
    u.value = UI.lang;
  }

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch("/api/admin/" + path, {
      method,
      headers: { "x-admin-token": S.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }
  function status(text, bad) { const s = $("#status"); s.textContent = text; s.className = bad ? "bad" : ""; }

  // ---------- Дерево ----------
  const root = () => S.page.doc.root;
  function find(b, id, parent = null, depth = 1) {
    if (b.id === id) return { b, parent, depth };
    for (const c of b.children || []) { const r = find(c, id, b, depth + 1); if (r) return r; }
    return null;
  }
  // Что можно добавить в контейнер: по матрице совместимости и лимиту глубины из настроек
  function allowed(f) {
    if (f.b.type !== "grid" || f.depth + 1 > S.cfg.maxDepth) return [];
    return S.cfg.compat[f.b.type] || [];
  }
  const nextRow = (parent, dev) => Math.max(1, ...parent.children.map((c) => c.layout[dev].row + c.layout[dev].rs));

  // ---------- Рендер ----------
  function langDir() { return (S.cfg.langs.find((l) => l.code === S.lang) || { dir: "ltr" }).dir; }

  function renderCanvas() {
    const c = $("#canvas");
    c.dir = langDir();
    c.lang = S.lang;
    const modalPg = S.page.type === "modal";
    c.className = "pg ed dev-" + S.dev + (modalPg ? " modal-page" : "");
    c.style.width = modalPg && S.dev === "d" ? ((S.page.doc.modal && S.page.doc.modal.w) || 560) + "px" : "";
    c.innerHTML = PM.html(root(), { lang: S.lang, def: S.cfg.defaultLang, edit: true, langs: S.cfg.langs, lib: S.lib });
    updateStyle();
    decorate();
  }
  function updateStyle() { $("#docstyle").textContent = PM.css(S.page.doc); }

  // Рамка выделения, ручка изменения размера, линии сетки («тетрадь в клеточку»)
  function decorate() {
    if (!S.sel) return;
    const c = $("#canvas");
    const node = c.querySelector(`[data-bid="${S.sel.bid}"]`);
    const f = node && find(root(), S.sel.bid);
    if (!f) { S.sel = null; return; }
    node.classList.add("sel");
    const pid = S.sel.pid || (f.b.type === "text" ? f.b.paras[0].id : null);
    if (pid) node.querySelector(`[data-pid="${pid}"]`)?.classList.add("psel");
    if (f.parent) node.append(el("div", { class: "h-res" }));
    const gridBlock = f.b.type === "grid" ? f.b : f.parent;
    const g = gridBlock && c.querySelector(`[data-bid="${gridBlock.id}"]`);
    if (g) {
      const cs = getComputedStyle(g);
      const cols = cs.gridTemplateColumns.split(" ").length, rows = cs.gridTemplateRows.split(" ").length;
      const gl = el("div", { class: "gl" });
      gl.style.cssText = `grid-template-columns:${cs.gridTemplateColumns};grid-template-rows:${cs.gridTemplateRows};column-gap:${cs.columnGap};row-gap:${cs.rowGap};padding:${cs.padding}`;
      const hl = S.ctx && S.ctx.cell && S.ctx.bid === gridBlock.id ? (S.ctx.cell.row - 1) * cols + (S.ctx.cell.col - 1) : -1;
      for (let i = 0; i < cols * rows; i++) gl.append(el("i", i === hl ? { class: "hl" } : {}));
      g.prepend(gl);
    }
  }

  function renderAll() { renderCanvas(); renderInspector(); updateUndo(); refreshPal(); }
  function select(bid, pid) { S.sel = bid ? { bid, pid } : null; S.ctx = { bid: bid || null, cell: null }; renderCanvas(); renderInspector(); refreshPal(); }
  const touch = () => renderCanvas(); // живое обновление при перетаскивании ползунков

  // ---------- История и сохранение ----------
  function commit() {
    const s = JSON.stringify(S.page.doc);
    if (s !== S.hist[S.hi]) {
      S.hist = S.hist.slice(0, S.hi + 1);
      S.hist.push(s);
      if (S.hist.length > 100) S.hist.shift();
      S.hi = S.hist.length - 1;
    }
    markDirty();
    updateUndo();
  }
  function markDirty() {
    S.dirty = true; S.err = false;
    status(_t("Изменено…"));
    clearTimeout(S.timer);
    S.timer = setTimeout(save, 1500);
  }
  async function save() {
    clearTimeout(S.timer);
    if (!S.dirty || S.saving || !S.page) return;
    S.saving = true; S.dirty = false;
    try {
      await api("PUT", "pages/" + S.page.id, { title: S.page.title, doc: S.page.doc });
      status(_t("Сохранено ✓"));
    } catch (e) {
      S.dirty = true; S.err = true;
      status(_t("Не сохранено: ") + e.message, true);
    } finally {
      S.saving = false;
      if (S.dirty && !S.err) S.timer = setTimeout(save, 1500);
    }
  }
  function undo(d) {
    const n = S.hi + d;
    if (n < 0 || n >= S.hist.length) return;
    S.hi = n;
    S.page.doc = JSON.parse(S.hist[n]);
    S.sel = null;
    markDirty();
    renderAll();
  }
  function updateUndo() { $("#undo").disabled = S.hi <= 0; $("#redo").disabled = S.hi >= S.hist.length - 1; }

  // ---------- Действия над блоками ----------
  // Положение нового блока: на текущем устройстве — в выбранной клетке, на другом — «в конец»
  function place(b, parent, cell) {
    for (const dev of ["d", "m"]) {
      const L = b.layout[dev], baseCols = dev === "d" ? PM.GRID_BASE.cols : PM.GRID_BASE.colsM;
      const cols = Number(dev === "d" ? parent.p.cols : parent.p.colsM) || baseCols;
      const rowH = Number(parent.p.rowH) || PM.GRID_BASE.rowH;
      L.cs = clamp(Math.round(L.cs * cols / baseCols), 1, cols);
      L.rs = Math.max(1, Math.round(L.rs * PM.GRID_BASE.rowH / rowH));
      if (dev === S.dev && cell) { L.col = clamp(cell.col, 1, cols - L.cs + 1); L.row = cell.row; }
      else { L.col = 1; L.row = nextRow(parent, dev); if (dev === "m") L.cs = cols; }
    }
  }
  function addBlock(parent, type, cell, opt) {
    const b = type === "grid" ? PM.newGrid()
      : type === "text" ? PM.newText(S.lang, "Double-click to edit")
      : type === "media" ? PM.newMedia()
      : type === "lang" ? PM.newLang()
      : PM.newControl((opt && opt.kind) || "button", S.lang);
    place(b, parent, cell || { col: 1, row: nextRow(parent, S.dev) });
    parent.children.push(b);
    S.sel = { bid: b.id };
    commit(); renderAll();
  }
  function removeBlock(bid) {
    const f = find(root(), bid);
    if (!f || !f.parent) return;
    f.parent.children = f.parent.children.filter((c) => c.id !== bid);
    S.sel = null; commit(); renderAll();
  }
  function dupBlock(bid) {
    const f = find(root(), bid);
    if (!f || !f.parent) return;
    const c = PM.clone(f.b);
    for (const dev of ["d", "m"]) c.layout[dev].row += c.layout[dev].rs;
    f.parent.children.push(c);
    S.sel = { bid: c.id }; commit(); renderAll();
  }
  function addPara(b) {
    const p = PM.newPara(S.lang, "New paragraph");
    b.paras.push(p);
    S.sel = { bid: b.id, pid: p.id }; commit(); renderAll();
  }

  // ---------- Геометрия сетки ----------
  function metrics(node, g) {
    const r = node.getBoundingClientRect(), cs = getComputedStyle(node);
    const cols = S.dev === "d" ? g.p.cols : g.p.colsM;
    const gapX = Number(g.p.gapX ?? g.p.gap) || 0, gapY = Number(g.p.gapY ?? g.p.gap) || 0;
    const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
    const cw = (r.width - padL - (parseFloat(cs.paddingRight) || 0) - gapX * (cols - 1)) / cols;
    return { r, cols, gapX, gapY, cw, rh: Number(g.p.rowH) || PM.GRID_BASE.rowH, padL, padT, rtl: cs.direction === "rtl" };
  }
  function cellAt(m, x, y) {
    const dx = m.rtl ? m.r.right - m.padL - x : x - m.r.left - m.padL;
    return {
      col: clamp(Math.floor(dx / (m.cw + m.gapX)) + 1, 1, m.cols),
      row: Math.max(1, Math.floor((y - m.r.top - m.padT) / (m.rh + m.gapY)) + 1),
    };
  }

  // Перетаскивание и изменение размера с привязкой к узлам клеток
  function startDrag(e, bid, mode) {
    const f = find(root(), bid);
    const node = f && $("#canvas").querySelector(`[data-bid="${f.parent.id}"]`);
    if (!node) return;
    const L = f.b.layout[S.dev], g = f.parent;
    const c0 = cellAt(metrics(node, g), e.clientX, e.clientY);
    const grab = { dc: c0.col - L.col, dr: c0.row - L.row };
    const before = JSON.stringify(L), x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const m = metrics(node, g), c = cellAt(m, ev.clientX, ev.clientY);
      if (mode === "move") { L.col = clamp(c.col - grab.dc, 1, m.cols - L.cs + 1); L.row = Math.max(1, c.row - grab.dr); }
      else { L.cs = clamp(c.col - L.col + 1, 1, m.cols - L.col + 1); L.rs = Math.max(1, c.row - L.row + 1); }
      updateStyle();
    };
    const up = () => {
      removeEventListener("pointermove", mv);
      if (moved && JSON.stringify(L) !== before) { commit(); renderAll(); }
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up, { once: true });
  }

  // ---------- События холста ----------
  const canvas = $("#canvas");
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.isContentEditable) return;
    const node = e.target.closest("[data-bid]");
    if (!node) return;
    e.preventDefault();
    const bid = node.dataset.bid, pid = e.target.closest("[data-pid]")?.dataset.pid;
    const resize = !!e.target.closest(".h-res");
    if (!S.sel || S.sel.bid !== bid || (pid && S.sel.pid !== pid)) select(bid, pid);
    const f = find(root(), bid);
    if (f && f.parent) startDrag(e, bid, resize ? "res" : "move");
  });

  // Двойной клик по абзацу — правка текста прямо на странице (для текущего языка)
  canvas.addEventListener("dblclick", (e) => {
    const p = e.target.closest("[data-pid]");
    if (!p) return;
    const f = find(root(), p.closest("[data-bid]").dataset.bid);
    const para = f.b.paras.find((x) => x.id === p.dataset.pid);
    try { p.contentEditable = "plaintext-only"; } catch { /* старые браузеры */ }
    if (p.contentEditable !== "plaintext-only") p.contentEditable = "true";
    p.focus();
    getSelection().selectAllChildren(p);
    const done = () => {
      p.removeEventListener("blur", done);
      para.t[S.lang] = p.innerText.replace(/\n+$/, "");
      commit(); renderAll();
    };
    p.addEventListener("blur", done);
    p.addEventListener("keydown", (ev) => { if (ev.key === "Escape") p.blur(); });
  });

  // Перетаскивание файла из библиотеки на блок «Медиа» добавляет ячейку в ленту
  canvas.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/pm-media") && e.target.closest(".b-media")) e.preventDefault(); });
  canvas.addEventListener("drop", (e) => {
    const id = e.dataTransfer.getData("text/pm-media"), node = e.target.closest(".b-media");
    if (!id || !node) return;
    e.preventDefault();
    const f = find(root(), node.dataset.bid), m = S.libList.find((x) => String(x.id) === id);
    if (f && m) { S.sel = { bid: f.b.id }; addToBlock(f.b, [m]); }
  });

  // Правый клик: меню блоков, допустимых в этом контейнере
  // Правый клик: открывается плавающая палитра команд. Она показывает ВСЕ команды сразу,
  // а недоступные в этом месте холста — серыми (как мини-карта в играх).
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const node = e.target.closest("[data-bid]");
    if (!node) return;
    const bid = node.dataset.bid, pid = e.target.closest("[data-pid]")?.dataset.pid;
    select(bid, pid);
    const f = find(root(), bid);
    const cell = f.b.type === "grid" ? cellAt(metrics(canvas.querySelector(`[data-bid="${bid}"]`), f.b), e.clientX, e.clientY) : null;
    S.ctx = { bid, cell };
    renderCanvas();
    openPal(e.clientX, e.clientY);
  });

  // ---------- Плавающая палитра команд ----------
  const SVG = (p) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    media: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 3 3-3 4 4"/>',
    showcase: '<path d="M4 9l1.5-5h13L20 9"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/>',
    lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    button: '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 12h8"/>',
    input: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 10v4"/>',
    textarea: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
    radio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    checklist: '<path d="M4 7l2 2 3-4M4 16l2 2 3-4M13 7h7M13 16h7"/>',
    select: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 11l4 4 4-4"/>',
    consent: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    para: '<path d="M13 4v16M9 4h8M9 4a4 4 0 000 8h4"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    parent: '<path d="M12 19V6M6 11l6-6 6 6"/>',
    del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  };
  // Порядок в списке — порядок по умолчанию; потом команды сортируются по частоте использования
  const CMD = [
    { id: "text", add: "text", c: "#3b6fd4", n: _t("Текст"), h: _t("Абзацы: кегль, цвет, градиент, подсказки") },
    { id: "media", add: "media", c: "#d9480f", n: _t("Медиа"), h: _t("Фото, видео, ряд или карусель") },
    { id: "grid", add: "grid", c: "#1f8a7d", n: _t("Сетка"), h: _t("Контейнер для других блоков, клетки с привязкой") },
    { id: "button", add: "control", kind: "button", c: "#e8590c", n: KIND_LABEL.button, h: _t("Ссылка, окно или отправка формы") },
    { id: "input", add: "control", kind: "input", c: "#1c7ed6", n: KIND_LABEL.input, h: _t("Email, телефон, Telegram, ссылка, число") },
    { id: "textarea", add: "control", kind: "textarea", c: "#3b5bdb", n: KIND_LABEL.textarea, h: _t("Многострочное поле") },
    { id: "select", add: "control", kind: "select", c: "#0b7285", n: KIND_LABEL.select, h: _t("Выбор из списка") },
    { id: "radio", add: "control", kind: "radio", c: "#7048e8", n: KIND_LABEL.radio, h: _t("Выбор одного варианта") },
    { id: "checklist", add: "control", kind: "checklist", c: "#2f9e44", n: KIND_LABEL.checklist, h: _t("Выбор нескольких вариантов") },
    { id: "consent", add: "control", kind: "consent", c: "#5c940d", n: KIND_LABEL.consent, h: _t("Галочка согласия со ссылкой") },
    { id: "menu", add: "control", kind: "menu", c: "#862e9c", n: KIND_LABEL.menu, h: _t("Меню из ссылок и окон") },
    { id: "lang", add: "lang", c: "#1098ad", n: _t("Языки"), h: _t("Переключатель языков сайта") },
    { id: "showcase", add: "showcase", soon: 3, c: "#a61e4d", n: _t("Витрина"), h: _t("Карточки товаров из базы") },
    { id: "code", add: "code", soon: 4, c: "#495057", n: _t("Сторонний код"), h: _t("Свой HTML: оплата, трекеры, iframe") },
    { id: "para", c: "#364fc7", n: _t("Добавить абзац"), h: _t("Ещё один абзац в текстовом блоке") },
    { id: "dup", c: "#5f6b66", n: _t("Дублировать"), h: _t("Копия блока (Ctrl+D)") },
    { id: "parent", c: "#1971a1", n: _t("Выбрать родителя"), h: _t("Перейти к блоку-контейнеру") },
    { id: "del", c: "#c92a2a", n: _t("Удалить"), h: _t("Удалить блок (Del)") },
  ];
  const useCount = () => { try { return JSON.parse(localStorage.getItem("pm-pal-use") || "{}"); } catch { return {}; } };
  const sortedCmds = () => { const u = useCount(); return CMD.map((c, i) => [c, i]).sort((a, b) => (u[b[0].id] || 0) - (u[a[0].id] || 0) || a[1] - b[1]).map((x) => x[0]); };
  const bumpUse = (id) => { const u = useCount(); u[id] = (u[id] || 0) + 1; try { localStorage.setItem("pm-pal-use", JSON.stringify(u)); } catch { /* без хранилища */ } };

  // Цель команд: блок, по которому кликнули правой кнопкой (или выбранный, или страница)
  function ctxTarget() {
    const id = (S.ctx && S.ctx.bid) || (S.sel && S.sel.bid) || root().id;
    return find(root(), id) || find(root(), root().id);
  }
  // Применима ли команда здесь; если нет — почему (показывается в подсказке)
  function palState(cmd) {
    const x = ctxTarget();
    if (cmd.soon) return { ok: false, why: _t("Появится в фазе {0}", cmd.soon) };
    if (cmd.add) {
      if (x.b.type !== "grid") return { ok: false, why: _t("Вкладывать блоки можно только в сетку: правый клик по сетке") };
      if (x.depth + 1 > S.cfg.maxDepth) return { ok: false, why: _t("Достигнута макс. глубина ({0})", S.cfg.maxDepth) };
      if (!(S.cfg.compat.grid || []).includes(cmd.add)) return { ok: false, why: _t("Запрещено матрицей совместимости (⚙)") };
      return { ok: true };
    }
    if (cmd.id === "para") return x.b.type === "text" ? { ok: true } : { ok: false, why: _t("Нужен текстовый блок") };
    return x.parent ? { ok: true } : { ok: false, why: _t("У страницы нет родителя: выберите блок") };
  }
  function palRun(cmd) {
    const x = ctxTarget();
    if (!palState(cmd).ok) return;
    bumpUse(cmd.id);
    if (cmd.add) addBlock(x.b, cmd.add, S.ctx && S.ctx.bid === x.b.id ? S.ctx.cell : null, { kind: cmd.kind });
    else if (cmd.id === "para") addPara(x.b);
    else if (cmd.id === "dup") dupBlock(x.b.id);
    else if (cmd.id === "parent") select(x.parent.id);
    else if (cmd.id === "del") removeBlock(x.b.id);
    refreshPal();
  }

  function posPal(x, y) {
    const p = $("#pal");
    p.style.left = clamp(x, 4, Math.max(4, innerWidth - p.offsetWidth - 4)) + "px";
    p.style.top = clamp(y, 4, Math.max(4, innerHeight - p.offsetHeight - 4)) + "px";
  }
  function buildPal() {
    const p = el("div", { id: "pal", role: "dialog", "aria-label": _t("Команды"), hidden: true },
      el("div", { class: "ph" }, el("strong", {}, _t("Команды")), el("span", { id: "pctx", class: "hint" }),
        el("button", { class: "px", "aria-label": _t("Закрыть"), onclick: closePal }, "✕")),
      el("div", { id: "pgrid" }),
      el("div", { class: "hint pf" }, _t("Серые команды здесь недоступны. Окно можно перетащить за заголовок.")));
    document.body.append(p);
    try { const sv = JSON.parse(localStorage.getItem("pm-pal") || "null"); if (sv) { S.palMoved = true; p.style.left = sv.x + "px"; p.style.top = sv.y + "px"; } } catch { /* нет позиции */ }
    // Перетаскивание окна за заголовок; положение запоминается
    const ph = $(".ph", p);
    ph.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      ph.setPointerCapture(e.pointerId);
      const mv = (ev) => posPal(ev.clientX - dx, ev.clientY - dy);
      ph.addEventListener("pointermove", mv);
      ph.addEventListener("pointerup", () => {
        ph.removeEventListener("pointermove", mv);
        S.palMoved = true;
        try { localStorage.setItem("pm-pal", JSON.stringify({ x: parseFloat(p.style.left), y: parseFloat(p.style.top) })); } catch { /* ничего */ }
      }, { once: true });
    });
    addEventListener("resize", () => { if (!p.hidden) posPal(parseFloat(p.style.left) || 0, parseFloat(p.style.top) || 0); });
  }
  function openPal(x, y) {
    const p = $("#pal"), was = !p.hidden;
    p.hidden = false;
    refreshPal();
    if (!was && !S.palMoved) posPal(x + 14, y + 10); // первый раз — рядом с курсором, потом там, где поставил пользователь
    else posPal(parseFloat(p.style.left) || x, parseFloat(p.style.top) || y);
  }
  const closePal = () => { $("#pal").hidden = true; hidePalTip(); };
  const togglePal = (a) => { if ($("#pal").hidden) { const r = a.getBoundingClientRect(); openPal(r.left, r.bottom); } else closePal(); };

  function refreshPal() {
    const p = $("#pal");
    if (!p || p.hidden || !S.page) return;
    const x = ctxTarget();
    $("#pctx").textContent = [!x.parent ? _t("Страница") : x.b.type === "control" ? KIND_LABEL[x.b.p.kind] : LABEL[x.b.type],
      S.ctx && S.ctx.cell && S.ctx.bid === x.b.id ? _t("ячейка {0}·{1}", S.ctx.cell.col, S.ctx.cell.row) : ""].filter(Boolean).join(" · ");
    const g = $("#pgrid");
    g.textContent = "";
    for (const cmd of sortedCmds()) {
      const st = palState(cmd);
      const b = el("button", { class: "pt" + (st.ok ? "" : " off"), style: `--c:${cmd.c}`, "aria-label": cmd.n, "aria-disabled": st.ok ? "false" : "true", "data-id": cmd.id });
      b.innerHTML = SVG(IC[cmd.id]);
      let t1 = null, t2 = null, lp = false;
      b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") t1 = setTimeout(() => showPalTip(b, cmd, st), 180); });
      b.addEventListener("pointerleave", () => { clearTimeout(t1); hidePalTip(); });
      b.addEventListener("focus", () => showPalTip(b, cmd, st));
      b.addEventListener("blur", hidePalTip);
      b.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { lp = false; t2 = setTimeout(() => { lp = true; showPalTip(b, cmd, st); }, 450); } }); // долгое нажатие на сенсорном экране
      b.addEventListener("pointerup", () => clearTimeout(t2));
      b.addEventListener("pointercancel", () => clearTimeout(t2));
      b.addEventListener("click", () => { if (lp) { lp = false; return; } hidePalTip(); palRun(cmd); });
      g.append(b);
    }
  }
  function showPalTip(node, cmd, st) {
    let t = $("#paltip");
    if (!t) { t = el("div", { id: "paltip", role: "tooltip" }); document.body.append(t); }
    t.textContent = "";
    t.append(el("strong", {}, cmd.n), el("div", {}, cmd.h), st.ok ? "" : el("div", { class: "why" }, st.why));
    t.hidden = false;
    const r = node.getBoundingClientRect();
    t.style.left = clamp(r.left + r.width / 2 - t.offsetWidth / 2, 4, innerWidth - t.offsetWidth - 4) + "px";
    t.style.top = (r.bottom + t.offsetHeight + 12 < innerHeight ? r.bottom + 8 : r.top - t.offsetHeight - 8) + "px";
  }
  const hidePalTip = () => { const t = $("#paltip"); if (t) t.hidden = true; };

  function showMenu(x, y, items) {
    const m = $("#ctx");
    m.textContent = "";
    for (const it of items) {
      if (it.cap) m.append(el("div", { class: "cap" }, it.cap));
      else m.append(el("button", { disabled: !!it.off, onclick: () => { hideMenu(); it.fn && it.fn(); } }, it.label));
    }
    m.hidden = false;
    m.style.left = clamp(x, 4, innerWidth - m.offsetWidth - 4) + "px";
    m.style.top = clamp(y, 4, innerHeight - m.offsetHeight - 4) + "px";
  }
  const hideMenu = () => { $("#ctx").hidden = true; };
  addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctx")) hideMenu(); });
  addEventListener("scroll", hideMenu, true);

  // ---------- Инспектор: компактные виджеты ----------
  const W = (label, ...c) => el("div", { class: "w" }, el("span", { class: "wl" }, label), el("div", { class: "wc" }, ...c));
  const H = (t) => el("h3", {}, t);

  function range(obj, key, min, max, step = 1) {
    const r = el("input", { type: "range", min, max, step, value: obj[key] ?? 0 });
    const n = el("input", { type: "number", min, max, step, value: obj[key] ?? 0 });
    const set = (v, final) => { obj[key] = Number(v); r.value = n.value = v; touch(); if (final) commit(); };
    r.addEventListener("input", () => set(r.value, false));
    r.addEventListener("change", () => set(r.value, true));
    n.addEventListener("change", () => set(n.value, true));
    return [r, n];
  }
  function numIn(obj, key, min, max, after) {
    const n = el("input", { type: "number", min, max, value: obj[key] ?? 0 });
    n.addEventListener("change", () => { obj[key] = clamp(parseInt(n.value, 10) || min, min, max); n.value = obj[key]; if (after) after(); touch(); commit(); });
    return n;
  }
  // После уменьшения числа колонок возвращаем блоки внутрь сетки
  function fitChildren(g, dev) {
    const cols = dev === "d" ? g.p.cols : g.p.colsM;
    for (const c of g.children) { const L = c.layout[dev]; L.cs = Math.min(L.cs, cols); L.col = Math.min(L.col, cols - L.cs + 1); }
  }
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#000000");
  function colorIn(obj, key, clearable) {
    const i = el("input", { type: "color", value: hex(obj[key]) });
    i.addEventListener("input", () => { obj[key] = i.value; touch(); });
    i.addEventListener("change", commit);
    return clearable ? [i, el("button", { title: _t("Сбросить"), onclick: () => { obj[key] = ""; touch(); commit(); renderInspector(); } }, "✕")] : [i];
  }
  function seg(obj, key, opts) {
    return el("div", { class: "seg" }, opts.map(([v, label, title]) =>
      el("button", { title: title || "", class: obj[key] === v ? "on" : "", onclick: () => { obj[key] = v; touch(); commit(); renderInspector(); } }, label)));
  }
  function tog(obj, key) {
    const c = el("input", { type: "checkbox" });
    c.checked = !!obj[key];
    c.addEventListener("change", () => { obj[key] = c.checked; touch(); commit(); renderInspector(); });
    return c;
  }
  function textIn(get, set, ph) {
    const i = el("input", { type: "text", placeholder: ph || "", value: get() });
    i.addEventListener("input", () => { set(i.value); touch(); });
    i.addEventListener("change", commit);
    return i;
  }

  function renderInspector() {
    const box = $("#insp");
    box.textContent = "";
    box.dir = "ltr";
    const f = S.sel && find(root(), S.sel.bid);
    if (!f) {
      box.append(el("p", { class: "hint" }, _t("Правый клик по сетке — добавить блок. Клик по блоку — выбрать, перетащить или растянуть за жёлтый угол. Двойной клик по тексту — правка.")));
      const modalPg = S.page.type === "modal";
      box.append(H(modalPg ? _t("Модальное окно") : _t("Страница")));
      if (modalPg) box.append(W(_t("Ширина окна"), ...range(S.page.doc.modal, "w", 280, 1000, 10)));
      box.append(...gridProps(root(), !modalPg));
      return;
    }
    const b = f.b;
    box.append(el("div", { class: "crumb" },
      el("strong", {}, b.type === "control" ? `${KIND_ICON[b.p.kind]} ${KIND_LABEL[b.p.kind]}` : `${ICON[b.type]} ${LABEL[b.type]}`),
      f.parent ? el("button", { title: _t("Выбрать родителя"), onclick: () => select(f.parent.id) }, "↑") : "",
      f.parent ? el("button", { title: _t("Дублировать"), onclick: () => dupBlock(b.id) }, "⧉") : "",
      f.parent ? el("button", { title: _t("Удалить"), onclick: () => removeBlock(b.id) }, "🗑") : "",
      el("span", { class: "hint" }, _t("уровень {0}/{1}", f.depth, S.cfg.maxDepth))));

    if (f.parent) {
      const L = b.layout[S.dev], cols = S.dev === "d" ? f.parent.p.cols : f.parent.p.colsM;
      box.append(H(S.dev === "d" ? _t("Положение · десктоп") : _t("Положение · мобильный")),
        W(_t("Колонка"), numIn(L, "col", 1, cols), el("span", { class: "hint" }, _t("ширина")), numIn(L, "cs", 1, cols)),
        W(_t("Строка"), numIn(L, "row", 1, 200), el("span", { class: "hint" }, _t("высота")), numIn(L, "rs", 1, 100)));
    }
    if (b.type === "grid") box.append(H(_t("Сетка")), ...gridProps(b, !f.parent));
    if (b.type === "text") box.append(...textProps(b));
    if (b.type === "media") box.append(...mediaProps(b));
    if (b.type === "control") box.append(...controlProps(b).flat());
    if (b.type === "lang") box.append(...langProps(b));
  }

  // ----- Элементы управления -----
  function sel(obj, key, opts, after) {
    const s = el("select", {}, opts.map(([v, l]) => el("option", { value: v }, l)));
    s.value = obj[key] ?? "";
    s.addEventListener("change", () => { obj[key] = s.value; if (after) after(); touch(); commit(); renderInspector(); });
    return s;
  }
  const mapIn = (map, ph) => textIn(() => map[S.lang] || "", (v) => { map[S.lang] = v; }, ph);
  const cleanName = (v) => (v.replace(/[^A-Za-z0-9_-]/g, "_") || "field").slice(0, 40);

  function modalPick(obj, key) {
    const mods = S.pages.filter((p) => p.type === "modal");
    const cur = mods.find((m) => m.slug === obj[key]);
    return [
      sel(obj, key, [["", _t("— выберите окно —")], ...mods.map((m) => [m.slug, `🗔 ${m.title} (${m.slug})`])]),
      el("button", { title: _t("Создать новое окно"), onclick: async () => { const m = await createPage("modal"); if (m) { obj[key] = m.slug; commit(); await openPage(m, true); } } }, "＋"),
      cur ? el("button", { title: _t("Править это окно (вернуться — кнопка «Назад»)"), onclick: () => openPage(cur, true) }, "✎") : "",
    ];
  }

  function seedOptions(p) {
    if ((PM.CHOICE.includes(p.kind) || p.kind === "menu") && p.options.length === 0) {
      p.options = [1, 2, 3].map((i) => PM.newOption(S.lang, (p.kind === "menu" ? "Item " : "Option ") + i, "opt" + i));
    }
  }

  function optionsEditor(b) {
    const p = b.p, menu = p.kind === "menu", out = [H(menu ? _t("Пункты меню") : _t("Варианты"))];
    const move = (i, d) => { const o = p.options; [o[i], o[i + d]] = [o[i + d], o[i]]; commit(); renderAll(); };
    p.options.forEach((o, i) => out.push(el("div", { class: "item" },
      el("div", { class: "row" }, mapIn(o.t, _t("текст · ") + S.lang),
        el("button", { title: _t("Выше"), disabled: i === 0, onclick: () => move(i, -1) }, "▲"),
        el("button", { title: _t("Ниже"), disabled: i === p.options.length - 1, onclick: () => move(i, 1) }, "▼"),
        el("button", { title: _t("Убрать"), onclick: () => { p.options.splice(i, 1); commit(); renderAll(); } }, "✕")),
      menu
        ? [W(_t("Действие"), sel(o, "action", [["link", _t("Ссылка")], ["modal", _t("Окно")]])),
           o.action === "modal" ? W(_t("Окно"), ...modalPick(o, "modal")) : W("URL", textIn(() => o.url, (v) => { o.url = v; }, _t("https://… или /about")))]
        : W(_t("Значение"), textIn(() => o.v, (v) => { o.v = v; }, _t("попадёт в заявку"))))));
    out.push(el("div", { class: "row" }, el("button", { onclick: () => { p.options.push(PM.newOption(S.lang, (menu ? "Item " : "Option ") + (p.options.length + 1))); commit(); renderAll(); } }, menu ? _t("＋ Пункт") : _t("＋ Вариант"))));
    return out;
  }

  function buttonProps(b) {
    const bt = b.p.btn;
    return [
      W(_t("Стиль"), seg(bt, "style", [["solid", _t("■ залитая")], ["outline", _t("□ контур")], ["link", _t("— ссылка")]])),
      W(_t("Действие"), sel(bt, "action", [["none", _t("Ничего")], ["link", _t("Открыть ссылку")], ["modal", _t("Открыть окно")], ["close", _t("Закрыть окно")], ["submit", _t("Отправить форму")]])),
      bt.action === "link" ? [W("URL", textIn(() => bt.url, (v) => { bt.url = v; }, "https://…")), W(_t("Новая вкладка"), tog(bt, "newTab"))] : "",
      bt.action === "modal" ? W(_t("Окно"), ...modalPick(bt, "modal")) : "",
      bt.action === "submit" ? [
        W(_t("Имя формы"), textIn(() => bt.form, (v) => { bt.form = cleanName(v); }, "contact")),
        W(_t("Сообщение"), mapIn(bt.ok, "Sent. Thank you!")),
        W(_t("После отправки"), seg(bt, "after", [["stay", _t("остаться")], ["close", _t("закрыть окно")]])),
        el("p", { class: "hint" }, _t("Кнопка собирает все поля этой страницы (или этого окна), проверяет формат и отправляет заявку. Заявки: кнопка 📥 сверху.")),
      ] : "",
    ];
  }

  function controlProps(b) {
    const p = b.p, k = p.kind, field = !["button", "menu"].includes(k), out = [];
    out.push(H(_t("Элемент")), W(_t("Тип"), sel(p, "kind", PM.KINDS.map((x) => [x, KIND_LABEL[x]]), () => seedOptions(p))));
    if (field) out.push(W(_t("Имя поля"), (() => {
      const i = el("input", { type: "text", value: p.name });
      i.addEventListener("change", () => { p.name = cleanName(i.value); i.value = p.name; commit(); });
      return i;
    })()));
    if (k !== "menu") out.push(W(k === "button" ? _t("Текст") : _t("Подпись"), mapIn(p.label)));
    if (["input", "textarea", "select"].includes(k)) out.push(W(_t("Плейсхолдер"), mapIn(p.ph)));
    if (field) {
      out.push(W(_t("Подсказка"), mapIn(p.help)), W(_t("Обязательное"), tog(p, "req")));
      if (k === "input") out.push(W(_t("Формат"), sel(p, "fmt", PM.FMTS.map((x) => [x, FMT_LABEL[x]]))));
      if (k === "input" || k === "textarea") out.push(W(_t("Длина"), numIn(p, "min", 0, 2000), el("span", { class: "hint" }, _t("до")), numIn(p, "max", 0, 2000)));
      out.push(W(_t("Своя ошибка"), mapIn(p.err, _t("вместо стандартной"))));
    }
    if (k === "consent") out.push(W(_t("Ссылка: текст"), mapIn(p.linkText)), W(_t("Ссылка: URL"), textIn(() => p.link, (v) => { p.link = v; }, "https://…")));
    if (PM.CHOICE.includes(k) || k === "menu") out.push(...optionsEditor(b));
    if (k === "button") out.push(H(_t("Кнопка")), ...buttonProps(b));
    if (k === "menu") out.push(W(_t("Расположение"), seg(p, "menu", [["h", _t("⇄ в ряд")], ["v", _t("⇅ столбцом")]])));
    out.push(H(_t("Оформление")), W(_t("Акцент"), ...colorIn(p, "ac")));
    if (k === "button") out.push(W(_t("Цвет текста"), ...colorIn(p, "fg")));
    out.push(W(_t("Скругление"), ...range(p, "cr", 0, 32)), W(_t("Шрифт"), ...range(p, "fs", 10, 40)),
      el("p", { class: "hint" }, _t("Тексты правятся для языка «{0}»; все языки сразу — в таблице «🌐 Переводы». Формат и обязательность проверяются в браузере и повторно на сервере.", S.lang)));
    return out;
  }

  function langProps(b) {
    const p = b.p;
    return [
      H(_t("Переключатель языков")),
      W(_t("Вид"), seg(p, "style", [["select", _t("▾ список")], ["buttons", _t("▭▭ кнопки")]])),
      W(_t("Акцент"), ...colorIn(p, "ac")),
      W(_t("Скругление"), ...range(p, "cr", 0, 32)),
      W(_t("Шрифт"), ...range(p, "fs", 10, 32)),
      el("p", { class: "hint" }, _t("Языки и направление (LTR/RTL) задаются в ⚙. При выборе языка вся страница — тексты, подсказки, плейсхолдеры, ошибки, окна — перерисовывается без перезагрузки, а страница зеркалится для RTL. Переводы — в таблице «🌐 Переводы».")),
    ];
  }

  function maxWidthFields(p) {
    const auto = el("input", { type: "checkbox", checked: !p.maxW });
    const fields = range(p, "maxW", 0, 2400);
    const setDisabled = () => fields.forEach((f) => (f.disabled = auto.checked));
    auto.addEventListener("change", () => {
      p.maxW = auto.checked ? 0 : 1200;
      fields.forEach((f) => (f.value = p.maxW));
      setDisabled(); touch(); commit();
    });
    fields.forEach((f) => f.addEventListener("change", () => {
      auto.checked = !p.maxW;
      setDisabled();
    }));
    setDisabled();
    return [el("label", { class: "grid-auto" }, auto, _t("Авто")), ...fields, el("span", { class: "unit" }, "px")];
  }
  function gridProps(b, isRoot) {
    const p = b.p;
    if (p.gapX == null) p.gapX = p.gap ?? 0;
    if (p.gapY == null) p.gapY = p.gap ?? 0;
    if (p.padX == null) p.padX = p.pad ?? 0;
    if (p.padY == null) p.padY = p.pad ?? 0;
    const columns = el("div", { class: "grid-cols" },
      el("label", { class: "grid-count" }, el("span", {}, _t("Десктоп")), numIn(p, "cols", 1, 80, () => fitChildren(b, "d"))),
      el("label", { class: "grid-count" }, el("span", {}, _t("Мобильный")), numIn(p, "colsM", 1, 32, () => fitChildren(b, "m"))));
    const px = () => el("span", { class: "unit" }, "px");
    return [
      W(_t("Колонки"), columns),
      W(_t("Мин. строк"), numIn(p, "rows", 1, 200)),
      W(_t("Высота строки"), ...range(p, "rowH", 1, 160), px()),
      W(_t("Зазор X"), ...range(p, "gapX", 0, 64), px()),
      W(_t("Зазор Y"), ...range(p, "gapY", 0, 64), px()),
      W(_t("Отступ X"), ...range(p, "padX", 0, 256), px()),
      W(_t("Отступ Y"), ...range(p, "padY", 0, 256), px()),
      W(_t("Скругление"), ...range(p, "radius", 0, 48), px()),
      W(_t("Фон"), ...colorIn(p, "bg", true)),
      isRoot ? W(_t("Макс. ширина"), ...maxWidthFields(p)) : "",
    ];
  }

  function textProps(b) {
    const pid = (S.sel.pid && b.paras.some((x) => x.id === S.sel.pid)) ? S.sel.pid : b.paras[0].id;
    const p = b.paras.find((x) => x.id === pid), s = p.s;
    p.tip = p.tip || {};
    return [
      H(_t("Абзацы")),
      el("div", { class: "chips" },
        b.paras.map((x, i) => el("button", { class: x.id === pid ? "on" : "", onclick: () => select(b.id, x.id) }, "¶" + (i + 1))),
        el("button", { title: _t("Добавить абзац"), onclick: () => addPara(b) }, "＋"),
        b.paras.length > 1 ? el("button", { title: _t("Удалить абзац"), onclick: () => { b.paras = b.paras.filter((x) => x.id !== pid); S.sel = { bid: b.id }; commit(); renderAll(); } }, "🗑") : ""),
      H(_t("Шрифт")),
      W(_t("Кегль"), ...range(s, "size", 8, 120)),
      W(_t("Кегль 📱"), ...range(s, "sizeM", 0, 120)),
      W(_t("Начертание"), seg(s, "weight", [[400, "Aa"], [600, "𝗔𝗮"], [800, "𝗔𝗮𝗮"]])),
      W(_t("Интервал"), ...range(s, "ls", -3, 24, 0.5)),
      W(_t("Межстрочный"), ...range(s, "lh", 0.8, 3, 0.05)),
      H(_t("Выравнивание и направление")),
      W(_t("Выравнивание"), seg(s, "align", [["start", "⇤", _t("К началу")], ["center", "↔", _t("По центру")], ["end", "⇥", _t("К концу")], ["justify", "☰", _t("По ширине")]])),
      W(_t("Направление"), seg(s, "dir", [["", "⟲", _t("Как у страницы")], ["ltr", "LTR →"], ["rtl", "← RTL"], ["auto", _t("Авто")]])),
      H(_t("Цвет и эффекты")),
      W(_t("Цвет"), ...colorIn(s, "color")),
      W(_t("Градиент"), tog(s, "grad")),
      ...(s.grad ? [W(_t("От / до"), ...colorIn(s, "g1"), ...colorIn(s, "g2")), W(_t("Угол"), ...range(s, "gAngle", 0, 360, 5))] : []),
      W(_t("Оверлей"), tog(s, "ov")),
      ...(s.ov ? [W(_t("Цвет / сила"), ...colorIn(s, "ovColor"), ...range(s, "ovOp", 0, 1, 0.05))] : []),
      W(_t("Подсказка"), textIn(() => p.tip[S.lang] || "", (v) => { p.tip[S.lang] = v; }, _t("Всплывает при наведении"))),
      el("p", { class: "hint" }, _t("Текст и подсказка правятся для языка «{0}» (переключатель в верхней панели).", S.lang)),
    ];
  }

  const guessType = (u) => (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) ? "video" : "image");
  const safeSrc = (u) => (/^(\/(?!\/)|https?:\/\/)/i.test(u || "") ? u : "");

  function mediaProps(b) {
    const { frame: f, belt: bl, click: c } = b.p;
    const active = b.items.filter((i) => !i.off).length;
    const items = b.items.map((it, i) => {
      const ent = PM.libOf(it, S.lib);
      const cb = el("input", { type: "checkbox", title: _t("Показывать в ленте") });
      cb.checked = !it.off;
      cb.addEventListener("change", () => { it.off = !cb.checked; touch(); commit(); renderInspector(); });
      const th = it.type === "video" ? el("span", { class: "th" }, "🎞") : el("img", { class: "th", src: safeSrc(it.src), alt: "" });
      return el("div", { class: "item" + (it.off ? " off" : "") },
        el("div", { class: "row" }, cb, th,
          ent ? el("span", { class: "nm", title: ent.name }, ent.name) : textIn(() => it.src, (v) => { it.src = v; it.type = guessType(v); }, _t("URL или /media/…")),
          el("button", { title: _t("Выше"), disabled: i === 0, onclick: () => { [b.items[i - 1], b.items[i]] = [b.items[i], b.items[i - 1]]; commit(); renderAll(); } }, "▲"),
          el("button", { title: _t("Ниже"), disabled: i === b.items.length - 1, onclick: () => { [b.items[i + 1], b.items[i]] = [b.items[i], b.items[i + 1]]; commit(); renderAll(); } }, "▼"),
          el("button", { title: _t("Убрать из ленты (файл останется в библиотеке)"), onclick: () => { b.items.splice(i, 1); commit(); renderAll(); } }, "✕")),
        ent ? el("div", { class: "row" }, el("button", { onclick: () => openMedia(ent) }, _t("Править: имя, подсказка, теги")), ...ent.tags.map((t) => el("span", { class: "c" }, t))) : "",
        it.type === "video"
          ? W(_t("Автозапуск"), tog(it, "autoplay"))
          : W(_t("Alt-текст"), textIn(() => it.alt[S.lang] || "", (v) => { it.alt[S.lang] = v; }, S.lang)));
    });
    return [
      H(_t("Лента · {0} из {1}", active, b.items.length)),
      ...items,
      el("div", { class: "row" },
        el("button", { class: "main", onclick: showLib }, _t("Из библиотеки")),
        el("button", { onclick: () => { const u = prompt(_t("URL картинки или видео (https://… или /media/…):")); if (u) { b.items.push(PM.newItem(u.trim(), guessType(u))); commit(); renderAll(); } } }, "＋ URL"),
        el("button", { onclick: () => pickFiles(b.id), title: S.r2 ? "" : _t("Нужен R2") }, _t("⬆ Загрузить"))),
      H(_t("Ячейки ленты")),
      W(_t("Показывать первые"), numIn(bl, "limit", 0, 200), el("span", { class: "hint" }, _t("0 — все"))),
      W(_t("Подсказки файлов"), tog(b.p, "showTip")),
      el("p", { class: "hint" }, _t("Галочка слева выключает ячейку, не удаляя её из блока. «Показывать первые N» оставляет в ленте только N ячеек. Подсказка и теги правятся в библиотеке.")),
      H(_t("Рамка · что видит посетитель")),
      W(_t("Окошек ▭"), numIn(f, "v", 1, 8), el("span", { class: "hint" }, "📱"), numIn(f, "vM", 1, 8)),
      W(_t("Движение ▭"), seg(f, "orient", [["h", "⇄", _t("Горизонтально")], ["v", "⇅", _t("Вертикально")]])),
      W(_t("Движение 📱"), seg(f, "orientM", [["h", "⇄", _t("Горизонтально")], ["v", "⇅", _t("Вертикально")]])),
      W(_t("Вписывание"), seg(f, "fit", [["cover", "▣", _t("Заполнить")], ["contain", "▢", _t("Вместить")], ["fill", "⤢", _t("Растянуть")]])),
      W(_t("Зазор"), ...range(f, "gap", 0, 40)),
      W(_t("Скругление"), ...range(f, "radius", 0, 48)),
      W(_t("Фон"), ...colorIn(f, "bg", true)),
      H(_t("Лента · как движется")),
      W(_t("Автосмена"), tog(bl, "auto")),
      ...(bl.auto ? [W(_t("Интервал, с"), ...range({ get v() { return bl.interval / 1000; }, set v(x) { bl.interval = x * 1000; } }, "v", 1, 20, 0.5))] : []),
      W(_t("Эффект"), seg(bl, "effect", [["slide", "⇢", _t("Сдвиг")], ["fade", "◐", _t("Затухание (при 1 окошке)")], ["none", "⏹", _t("Без анимации")]])),
      W(_t("Скорость, мс"), ...range(bl, "speed", 0, 2000, 50)),
      W(_t("По кругу"), tog(bl, "loop")),
      W(_t("Пауза на hover"), tog(bl, "pauseHover")),
      W(_t("Стрелки"), tog(bl, "arrows")),
      W(_t("Точки"), tog(bl, "dots")),
      H(_t("Клик по медиа")),
      W(_t("Действие"), seg(c, "action", [["none", "∅", _t("Ничего")], ["link", "🔗", _t("Ссылка")], ["lightbox", "🔍", _t("Увеличить")], ["next", "▶", _t("Следующее")]])),
      c.action === "link" ? W(_t("Ссылка"), textIn(() => c.url, (v) => { c.url = v; }, "https://…")) : "",
      el("p", { class: "hint" }, _t("Анимация карусели видна в «Просмотр» и на опубликованной странице.")),
    ];
  }

  // ---------- Библиотека медиа (левая панель) ----------
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + _t(" МБ") : Math.max(1, Math.round(n / 1024)) + _t(" КБ"));
  const fmtDur = (d) => Math.floor(d / 60) + ":" + String(Math.floor(d % 60)).padStart(2, "0");
  const mediaUrl = (m) => "/media/" + m.key;
  const isVideo = (m) => m.mime.startsWith("video/");
  const tipOf = (m) => m.tip[S.lang] || m.tip[S.cfg.defaultLang] || Object.values(m.tip)[0] || "";

  async function loadLib() {
    try { const d = await api("GET", "media"); S.libList = d.media; S.libStats = d.stats; }
    catch (e) { if (e.message === "unauthorized") throw e; status(_t("Библиотека: ") + e.message, true); }
    reindex();
    const hasMedia = S.libList.length > 0;
    if (!S.libHasMedia && hasMedia) { S.libPinned = false; S.libForceVisible = false; }
    S.libHasMedia = hasMedia;
    updateLibDrawer();
    renderLib();
  }
  function updateLibDrawer() {
    const box = $("#lib"), toggle = $("#libtoggle"), visible = S.libHasMedia || S.libForceVisible;
    if (!visible) S.libHover = false;
    const expanded = S.libPinned || S.libHover;
    box.hidden = !visible;
    box.classList.toggle("expanded", expanded);
    toggle.classList.toggle("on", S.libPinned);
    toggle.setAttribute("aria-expanded", String(expanded));
  }
  function reindex() {
    S.lib = {};
    S.libList.forEach((m) => (S.lib[m.key] = m));
    S.libStats = { count: S.libList.length, bytes: S.libList.reduce((a, m) => a + m.size, 0) };
  }

  function renderLib() {
    const box = $("#lib-content");
    box.textContent = "";
    box.append(el("div", { class: "lib-head" }, el("strong", {}, _t("Медиа")), el("span", { class: "hint", id: "libstat" })));
    const dz = el("div", { class: "dz" + (S.r2 ? "" : " off") },
      el("strong", {}, _t("Перетащите файлы сюда")),
      S.r2 ? el("span", { class: "hint" }, _t("или "), el("button", { onclick: () => pickFiles(null) }, _t("выберите на компьютере")))
           : el("span", { class: "hint" }, _t("R2 не подключён: загрузка недоступна, вставляйте медиа по URL (см. README)")));
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { if (S.r2 && e.dataTransfer.types.includes("Files")) { e.preventDefault(); dz.classList.add("over"); } }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("over")));
    dz.addEventListener("drop", (e) => { if (!S.r2) return; e.preventDefault(); uploadFiles([...e.dataTransfer.files], null); });
    const q = el("input", { type: "text", placeholder: _t("Поиск по имени, подсказке и тегам"), value: S.q });
    q.addEventListener("input", () => { S.q = q.value; renderLibList(); });
    box.append(dz, el("div", { id: "libq" }), q, el("div", { id: "liblist" }));
    renderQueue(); renderLibList();
  }

  function renderQueue() {
    const box = $("#libq");
    if (!box) return;
    box.textContent = "";
    for (const q of S.queue) {
      const renamed = q.final && /\(\d+\)\.\w+$/.test(q.final);
      box.append(el("div", { class: "q" + (q.state === "err" ? " bad" : "") },
        el("div", { class: "row" }, el("span", { class: "nm" }, q.name + (q.final && q.final !== q.name ? " → " + q.final : "")), el("span", { class: "hint" }, q.state === "err" ? _t("ошибка") : q.state === "ok" ? _t("готово") : Math.round(q.p * 100) + "%")),
        q.state === "up" || q.state === "prep" ? el("div", { class: "bar" }, el("i", { style: `width:${Math.round(q.p * 100)}%` })) : "",
        (renamed || q.note) ? el("span", { class: "hint" }, [renamed ? _t("Имя занято, добавлен номер. ") : "", q.note].join("")) : ""));
    }
  }

  function renderLibList() {
    const st = $("#libstat");
    if (st) st.textContent = S.libStats ? _t("{0} файлов · {1}", S.libStats.count, fmtSize(S.libStats.bytes)) : "";
    const box = $("#liblist");
    if (!box) return;
    box.textContent = "";
    const tags = [...new Set(S.libList.flatMap((m) => m.tags))].sort();
    const q = S.q.trim().toLowerCase();
    const list = S.libList.filter((m) => (!S.tag || m.tags.includes(S.tag)) &&
      (!q || m.name.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q)) || Object.values(m.tip).join(" ").toLowerCase().includes(q)));
    box.append(el("div", { class: "chips" }, ["", ...tags].map((t) => el("button", { class: "c" + (S.tag === t ? " on" : ""), onclick: () => { S.tag = t; renderLibList(); } }, t || _t("Все")))),
      list.length ? el("div", { class: "lgrid" }, list.map(tile)) : el("p", { class: "hint" }, S.libList.length ? _t("Ничего не найдено") : _t("Файлов пока нет")));
  }

  function tile(m) {
    const media = isVideo(m) ? el("video", { src: mediaUrl(m) + "#t=0.1", preload: "metadata", muted: true, playsinline: true }) : el("img", { src: mediaUrl(m), loading: "lazy", decoding: "async", alt: "" });
    const t = el("div", { class: "tl", draggable: "true", tabindex: "0" },
      media, el("span", { class: "tn" }, m.name),
      isVideo(m) && m.dur ? el("span", { class: "dur" }, fmtDur(m.dur)) : "",
      m.uses ? el("span", { class: "use", title: _t("Используется на страницах: ") + m.uses }, m.uses) : "");
    t.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/pm-media", String(m.id)); e.dataTransfer.effectAllowed = "copy"; hideTip(); });
    t.addEventListener("mouseenter", () => showTip(t, m));
    t.addEventListener("focus", () => showTip(t, m));
    t.addEventListener("mouseleave", hideTip);
    t.addEventListener("blur", hideTip);
    t.addEventListener("click", () => useMedia(m));
    t.addEventListener("dblclick", () => openMedia(m));
    t.addEventListener("keydown", (e) => { if (e.key === "Enter") useMedia(m); });
    t.addEventListener("contextmenu", (e) => {
      e.preventDefault(); hideTip();
      showMenu(e.clientX, e.clientY, [
        { label: _t("✎  Править: имя, подсказка, теги"), fn: () => openMedia(m) },
        { label: _t("＋  Добавить в выбранный блок"), fn: () => useMedia(m) },
        { label: _t("⧉  Копировать адрес"), fn: () => navigator.clipboard && navigator.clipboard.writeText(location.origin + mediaUrl(m)) },
        { label: _t("🗑  Удалить"), fn: () => delMedia(m) },
      ]);
    });
    return t;
  }

  // Подсказка при наведении на миниатюру: имя, текст, теги, размеры, использование
  function showTip(node, m) {
    const c = $("#tipcard");
    c.textContent = "";
    c.append(el("strong", {}, m.name), tipOf(m) ? el("div", {}, tipOf(m)) : "",
      m.tags.length ? el("div", { class: "tags" }, m.tags.map((t) => el("span", {}, t))) : "",
      el("small", {}, [m.w && m.h ? `${m.w}×${m.h}` : "", fmtSize(m.size), isVideo(m) && m.dur ? fmtDur(m.dur) : "", m.uses ? _t("на страницах: {0}", m.uses) : _t("не используется")].filter(Boolean).join(" · ")));
    c.hidden = false;
    const r = node.getBoundingClientRect();
    c.style.left = Math.min(r.right + 8, innerWidth - c.offsetWidth - 8) + "px";
    c.style.top = clamp(r.top, 8, innerHeight - c.offsetHeight - 8) + "px";
  }
  const hideTip = () => { $("#tipcard").hidden = true; };

  const selectedMedia = () => { const f = S.sel && find(root(), S.sel.bid); return f && f.b.type === "media" ? f.b : null; };
  function addToBlock(b, ms) {
    ms.forEach((m) => b.items.push(PM.newItem(mediaUrl(m), isVideo(m) ? "video" : "image")));
    commit(); renderAll();
    status(_t("Добавлено в ленту: {0}", ms.length));
  }
  function useMedia(m) {
    const b = selectedMedia();
    if (b) addToBlock(b, [m]); else openMedia(m);
  }
  function showLib() {
    S.libForceVisible = true;
    S.libPinned = true;
    updateLibDrawer();
    $("#lib").classList.add("flash");
    setTimeout(() => $("#lib").classList.remove("flash"), 900);
    status(_t("Нажмите на файл в библиотеке, чтобы добавить его в ленту"));
  }

  // Правка файла: имя (уникальное), подсказка по языкам, теги
  function openMedia(m) {
    const d = { name: m.name.replace(/\.[^.]+$/, ""), tags: m.tags.join(", "), tip: { ...m.tip } };
    const ext = m.name.split(".").pop();
    const name = el("input", { type: "text", value: d.name });
    name.addEventListener("input", () => (d.name = name.value));
    const err = el("p", { class: "hint", style: "color:#d64a26;min-height:1.2em" });
    const tags = el("input", { type: "text", value: d.tags, list: "taglist", placeholder: _t("товар, обувь") });
    tags.addEventListener("input", () => (d.tags = tags.value));
    const dl = el("datalist", { id: "taglist" }, [...new Set(S.libList.flatMap((x) => x.tags))].map((t) => el("option", { value: t })));
    const tips = S.cfg.langs.map((l) => {
      const i = el("input", { type: "text", dir: l.dir, value: d.tip[l.code] || "", maxlength: "200" });
      i.addEventListener("input", () => { d.tip[l.code] = i.value; });
      return W(`${l.code} ${l.dir === "rtl" ? "←" : "→"}`, i);
    });
    const preview = isVideo(m) ? el("video", { src: mediaUrl(m), controls: true, style: "max-width:100%;max-height:200px" }) : el("img", { src: mediaUrl(m), alt: "", style: "max-width:100%;max-height:200px;border-radius:8px" });
    const body = el("div", {}, preview,
      W(_t("Имя файла"), name, el("span", { class: "hint" }, "." + ext)), err,
      W(_t("Теги"), tags), dl,
      el("div", { class: "h3" }, _t("Подсказка при наведении")), ...tips,
      el("p", { class: "hint" }, _t("Оригинал: {0} · {1}{2} · на страницах: {3}. Правка действует во всех блоках, где файл используется; адрес файла не меняется.", m.orig, m.w && m.h ? m.w + "×" + m.h + " · " : "", fmtSize(m.size), m.uses || 0)));
    modal(_t("Файл библиотеки"), body, [
      el("button", { onclick: () => { closeModal(); delMedia(m); } }, _t("Удалить")),
      el("button", { onclick: closeModal }, _t("Отмена")),
      el("button", { class: "main", onclick: async () => {
        try {
          const r = await api("PATCH", "media/" + m.id, { name: d.name, tags: d.tags.split(/[,;]+/).map((x) => x.trim()).filter(Boolean), tip: d.tip });
          S.libList = S.libList.map((x) => (x.id === m.id ? r : x));
          reindex(); renderLibList(); renderCanvas(); renderInspector(); closeModal(); status(_t("Файл обновлён ✓"));
        } catch (e) { err.textContent = e.message === "name_taken" ? _t("Такое имя уже есть в библиотеке. Выберите другое.") : _t("Ошибка: ") + e.message; }
      } }, _t("Сохранить")),
    ]);
  }

  async function delMedia(m) {
    if (!confirm(_t("Удалить файл «{0}» из библиотеки?", m.name))) return;
    try {
      try { await api("DELETE", "media/" + m.id); }
      catch (e) {
        if (e.message !== "in_use" || !confirm(_t("Файл используется на страницах. Удалить всё равно? Ячейки с ним останутся пустыми."))) throw e;
        await api("DELETE", `media/${m.id}?force=1`);
      }
      S.libList = S.libList.filter((x) => x.id !== m.id);
      S.libHasMedia = S.libList.length > 0;
      updateLibDrawer();
      reindex(); renderLibList(); renderCanvas();
      status(_t("Файл удалён"));
    } catch (e) { if (e.message !== "in_use") status(_t("Не удалось удалить: ") + e.message, true); }
  }

  // ----- Загрузка: имя сохраняется, имена уникальны; картинки сжимаются в браузере -----
  const pickFiles = (target) => { S.upTarget = target; $("#upfile").click(); };
  $("#upfile").addEventListener("change", (e) => { uploadFiles([...e.target.files], S.upTarget); e.target.value = ""; });

  const videoMeta = (file) => new Promise((ok) => {
    const v = document.createElement("video"), u = URL.createObjectURL(file);
    const done = (r) => { URL.revokeObjectURL(u); ok(r); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration * 10) / 10 });
    v.onerror = () => done({});
    setTimeout(() => done({}), 6000);
    v.src = u;
  });

  // Фото больше 2000 px или тяжелее 350 КБ перекодируются в WebP, если от этого файл становится меньше
  async function prepare(file) {
    if (file.type.startsWith("video/")) return { blob: file, type: file.type, ...(await videoMeta(file)) };
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, type: file.type };
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    if (k === 1 && file.size < 350000) return { blob: file, type: file.type, w, h };
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
    if (out && out.type === "image/webp" && out.size < file.size) return { blob: out, type: "image/webp", w, h, note: _t("Сжато: {0} → {1}", fmtSize(file.size), fmtSize(out.size)) };
    return { blob: file, type: file.type, w, h };
  }

  function sendFile(pr, orig, onp) {
    return new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/admin/media");
      x.setRequestHeader("x-admin-token", S.token);
      x.setRequestHeader("content-type", pr.type);
      x.setRequestHeader("x-orig", encodeURIComponent(orig));
      if (pr.w) { x.setRequestHeader("x-width", String(pr.w)); x.setRequestHeader("x-height", String(pr.h)); }
      if (pr.dur) x.setRequestHeader("x-dur", String(pr.dur));
      x.upload.onprogress = (e) => { if (e.lengthComputable) onp(e.loaded / e.total); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* пусто */ }
        if (x.status === 200) ok(d); else no(new Error(d.error === "r2_not_configured" ? _t("R2 не подключён") : d.error || x.status));
      };
      x.onerror = () => no(new Error(_t("нет связи")));
      x.send(pr.blob);
    });
  }

  async function uploadFiles(files, target) {
    if (!S.r2) return alert(_t("R2 не подключён: загрузка файлов недоступна. Вставляйте медиа по URL (см. README)."));
    const added = [];
    for (const file of files) {
      const q = { name: file.name, p: 0, note: "", state: "prep" };
      S.queue.push(q); renderQueue();
      try {
        const pr = await prepare(file);
        q.note = pr.note || ""; q.state = "up"; renderQueue();
        const m = await sendFile(pr, file.name, (p) => { q.p = p; renderQueue(); });
        q.state = "ok"; q.p = 1; q.final = m.name;
        S.libList.unshift(m); added.push(m);
      } catch (e) { q.state = "err"; q.note = e.message; }
      renderQueue();
    }
    const hadMedia = S.libHasMedia;
    reindex();
    S.libHasMedia = S.libList.length > 0;
    if (!hadMedia && S.libHasMedia) { S.libPinned = false; S.libForceVisible = false; }
    updateLibDrawer();
    renderLibList();
    if (target && added.length) { const f = find(root(), target); if (f) addToBlock(f.b, added); }
    setTimeout(() => { S.queue = S.queue.filter((q) => q.state === "err"); renderQueue(); }, 5000);
  }

  // ---------- Модальные окна ----------
  function modal(title, body, buttons, wide) {
    const m = $("#modal");
    m.textContent = "";
    m.append(el("div", { class: "dlg" + (wide ? " wide" : "") }, el("h2", {}, title), body, el("div", { class: "foot" }, buttons)));
    m.hidden = false;
  }
  const closeModal = () => { $("#modal").hidden = true; };

  function openSettings() {
    const c = JSON.parse(JSON.stringify(S.cfg));
    const body = el("div");
    const testMail = async () => {
      try { await api("PUT", "config", c); S.cfg = c; const r = await api("POST", "notify-test", {}); alert(_t("Тестовое письмо отправлено ({0}). Проверьте почту.", r.provider)); }
      catch (e) { alert(_t("Не вышло: ") + apiErr(e.message)); }
    };
    const draw = () => {
      body.textContent = "";
      const title = el("input", { value: c.siteTitle });
      title.addEventListener("input", () => (c.siteTitle = title.value));
      const depth = el("input", { type: "number", min: 1, max: 8, value: c.maxDepth });
      depth.addEventListener("input", () => (c.maxDepth = parseInt(depth.value, 10) || 1));
      body.append(W(_t("Название сайта"), title), W(_t("Макс. вложенность"), depth, el("span", { class: "hint" }, _t("1–8 уровней"))));

      body.append(H(_t("Что может содержать блок")));
      for (const parent of ["grid"]) {
        c.compat[parent] = c.compat[parent] || [];
        body.append(W(`${ICON[parent]} ${LABEL[parent]} →`, ...PM.BLOCK_TYPES.map((t) => {
          const cb = el("input", { type: "checkbox" });
          cb.checked = c.compat[parent].includes(t);
          cb.addEventListener("change", () => { c.compat[parent] = c.compat[parent].filter((x) => x !== t); if (cb.checked) c.compat[parent].push(t); });
          return el("label", {}, cb, ` ${LABEL[t]} `);
        })));
      }
      body.append(el("p", { class: "hint" }, _t("Текст, медиа, элементы и переключатель — листья: вложенность возможна только в сетках. Фаза 3–4 добавят в эту таблицу витрину и сторонний код.")));

      body.append(H(_t("Языки сайта (LTR и RTL)")));
      const tbl = el("table");
      c.langs.forEach((l, i) => {
        const code = el("input", { value: l.code, size: 4 }), name = el("input", { value: l.name });
        const dir = el("select", {}, el("option", { value: "ltr" }, "LTR →"), el("option", { value: "rtl" }, "← RTL"));
        dir.value = l.dir;
        const def = el("input", { type: "radio", name: "deflang" });
        def.checked = c.defaultLang === l.code;
        code.addEventListener("input", () => { if (c.defaultLang === l.code) c.defaultLang = code.value; l.code = code.value; });
        name.addEventListener("input", () => (l.name = name.value));
        dir.addEventListener("change", () => (l.dir = dir.value));
        def.addEventListener("change", () => (c.defaultLang = l.code));
        tbl.append(el("tr", {}, el("td", {}, code), el("td", {}, name), el("td", {}, dir), el("td", { title: _t("Язык по умолчанию") }, def),
          el("td", {}, c.langs.length > 1 ? el("button", { onclick: () => { c.langs.splice(i, 1); if (!c.langs.some((x) => x.code === c.defaultLang)) c.defaultLang = c.langs[0].code; draw(); } }, "✕") : "")));
      });
      body.append(tbl, el("button", { onclick: () => { c.langs.push({ code: "xx", name: "New", dir: "ltr" }); draw(); } }, _t("＋ Язык")),
        el("p", { class: "hint" }, _t("● — язык по умолчанию: на нём страница открывается первой.")));

      // Письма о заявках и капча
      c.notify = c.notify || { to: [], subject: "" };
      body.append(H(_t("Письма о заявках")),
        el("p", { class: "hint" }, S.mail ? _t("Отправка настроена: {0}.", S.mail === "resend" ? "Resend" : "Cloudflare Email") : _t("Отправка не настроена: нужны NOTIFY_FROM и RESEND_API_KEY либо привязка EMAIL (см. README).")));
      const to = el("input", { value: c.notify.to.join(", "), placeholder: "you@example.com, second@example.com" });
      to.addEventListener("input", () => { c.notify.to = to.value.split(/[,;\s]+/).filter(Boolean); });
      const subj = el("input", { value: c.notify.subject || "", placeholder: "New submission" });
      subj.addEventListener("input", () => (c.notify.subject = subj.value));
      body.append(W(_t("Получатели"), to), W(_t("Тема"), subj),
        el("div", { class: "row" }, el("button", { onclick: testMail }, _t("✉ Сохранить и отправить тестовое письмо"))));

      body.append(H(_t("Капча (Cloudflare Turnstile)")));
      const key = el("input", { value: c.turnstileSiteKey || "", placeholder: "0x4AAAAAAA…" });
      key.addEventListener("input", () => (c.turnstileSiteKey = key.value.trim()));
      body.append(W("Site key", key),
        el("p", { class: "hint" }, _t("Секрет TURNSTILE_SECRET на сервере: {0}. Пустой Site key отключает капчу на страницах. После изменений опубликуйте страницы заново.", S.captcha ? _t("задан — заявки без проверки не принимаются") : _t("не задан — капча не проверяется"))));
    };
    draw();
    modal(_t("Настройки сайта"), body, [
      el("button", { onclick: closeModal }, _t("Отмена")),
      el("button", { class: "main", onclick: async () => {
        try { await api("PUT", "config", c); S.cfg = c; if (!c.langs.some((l) => l.code === S.lang)) S.lang = c.defaultLang; fillLang(); closeModal(); renderAll(); status(_t("Настройки сохранены ✓")); }
        catch (e) { alert(_t("Ошибка: ") + e.message); }
      } }, _t("Сохранить")),
    ]);
  }

  async function openHistory() {
    await save();
    const { versions } = await api("GET", `pages/${S.page.id}/versions`);
    const body = el("div", {}, versions.length ? "" : el("p", { class: "hint" }, _t("Версий пока нет — они создаются автоматически при сохранении.")),
      versions.map((v) => el("div", { class: "row" }, el("span", { style: "flex:1" }, new Date(v.created).toLocaleString()),
        el("button", { onclick: async () => {
          const { doc } = await api("GET", "versions/" + v.id);
          S.page.doc = doc; S.sel = null; commit(); renderAll(); closeModal();
        } }, _t("Восстановить")))));
    modal(_t("История версий"), body, [el("button", { onclick: closeModal }, _t("Закрыть"))]);
  }

  // ---------- Страницы, языки, верхняя панель ----------
  function fillLang() {
    const s = $("#lang");
    s.textContent = "";
    S.cfg.langs.forEach((l) => s.append(el("option", { value: l.code }, `${l.code} · ${l.name} · ${l.dir.toUpperCase()}`)));
    s.value = S.lang;
  }
  function fillPages() {
    const s = $("#pages");
    s.textContent = "";
    S.pages.forEach((p) => s.append(el("option", { value: p.id }, p.type === "modal" ? `🗔 ${p.title}  (${p.slug})` : `/${p.slug === "index" ? "" : p.slug}  ${p.title}`)));
    if (S.page) s.value = S.page.id;
  }
  async function openPage(meta, push) {
    await save();
    if (push && S.page) S.back.push(S.page.id);
    const p = await api("GET", "pages/" + meta.id);
    S.page = p; S.sel = null;
    $("#back").hidden = !S.back.length;
    S.hist = [JSON.stringify(p.doc)]; S.hi = 0; S.dirty = false;
    $("#title").value = p.title;
    fillPages(); renderAll(); status("");
  }
  async function createPage(type) {
    const modalType = type === "modal";
    const slug = (prompt(modalType ? _t("Адрес окна латиницей (например thanks):") : _t("Адрес страницы латиницей (например about):")) || "").trim().toLowerCase();
    if (!slug) return null;
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) { alert(_t("Только a–z, 0–9 и дефис, до 40 символов")); return null; }
    const title = prompt(modalType ? _t("Название окна:") : _t("Заголовок страницы:"), slug) || slug;
    try {
      const meta = await api("POST", "pages", { slug, title, type, doc: PM.newDoc({ modal: modalType }) });
      S.pages.push(meta);
      return meta;
    } catch (e) { alert(_t("Ошибка: ") + e.message); return null; }
  }
  async function newPage(type) {
    const m = await createPage(type);
    if (m) { S.back = []; await openPage(m); }
  }

  // Окна, которые открываются со страницы (и вложенные окна, до 3 уровней)
  async function collectModals(doc) {
    const out = [], seen = new Set();
    const visit = async (d, depth) => {
      for (const slug of PM.modalRefs(d)) {
        if (seen.has(slug)) continue;
        const m = S.pages.find((p) => p.slug === slug && p.type === "modal");
        if (!m) throw new Error(_t("Окно «{0}» не найдено", slug));
        seen.add(slug);
        const full = S.page && S.page.id === m.id ? S.page : await api("GET", "pages/" + m.id);
        out.push({ slug, doc: full.doc });
        if (depth < 3) await visit(full.doc, depth + 1);
      }
    };
    await visit(doc, 1);
    return out;
  }
  async function buildPage(meta, doc, lang) {
    const modals = await collectModals(doc);
    const fm = PM.formsMeta(doc, modals);
    if (fm.error) throw new Error(fm.error);
    return { html: PM.page(doc, S.cfg, { lang: lang || S.cfg.defaultLang, title: meta.title, slug: meta.slug, modals, lib: S.lib }), meta: { forms: fm.forms } };
  }
  async function publishPage(meta, doc) {
    const { html, meta: m } = await buildPage(meta, doc);
    const r = await api("POST", `pages/${meta.id}/publish`, { html, meta: m });
    const row = S.pages.find((p) => p.id === meta.id);
    if (row) row.published_at = Date.now();
    return r;
  }
  async function publish() {
    status(_t("Публикация…"));
    await save();
    if (S.err) return;
    try {
      if (S.page.type === "modal") { // окно публикуется вместе со страницами, которые его открывают
        let n = 0;
        for (const p of S.pages.filter((x) => x.type === "page" && x.published_at)) {
          const full = await api("GET", "pages/" + p.id);
          if ((await collectModals(full.doc)).some((m) => m.slug === S.page.slug)) { await publishPage(full, full.doc); n++; }
        }
        status(n ? _t("Окно обновлено на страницах: {0} ✓", n) : _t("Окно сохранено. Опубликуйте страницу, которая его открывает."));
        return;
      }
      const r = await publishPage(S.page, S.page.doc);
      status(_t("Опубликовано: /{0} ✓", r.slug === "index" ? "" : r.slug));
      window.open("/" + (r.slug === "index" ? "" : r.slug), "_blank");
    } catch (e) { status(_t("Ошибка публикации: ") + e.message, true); }
  }
  async function preview() {
    const w = window.open("about:blank", "_blank"); // открываем сразу, чтобы не сработал блокировщик
    try {
      const { html } = await buildPage(S.page, S.page.doc, S.lang);
      const u = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      if (w) w.location.href = u; else window.open(u, "_blank");
    } catch (e) { if (w) w.close(); status(_t("Ошибка просмотра: ") + e.message, true); }
  }

  // ---------- Переводы и заявки ----------
  function openTranslations() {
    const rows = PM.strings(S.page.doc), langs = S.cfg.langs, base = S.cfg.defaultLang;
    let only = false;
    const tbl = el("div");
    const draw = () => {
      tbl.textContent = "";
      const t = el("table", { class: "tbl" }, el("tr", {}, el("th", {}, _t("Что")), langs.map((l) => el("th", {}, `${l.code} ${l.dir === "rtl" ? "←" : "→"}${l.code === base ? " ●" : ""}`))));
      let grp = "", n = 0;
      rows.forEach((r) => {
        const missing = (l) => r.map[base] && !r.map[l.code];
        if (only && !langs.some(missing)) return;
        if (r.grp !== grp) { grp = r.grp; t.append(el("tr", { class: "grp" }, el("td", { colspan: langs.length + 1 }, trGrp(grp)))); }
        n++;
        t.append(el("tr", {}, el("td", {}, trLabel(r.label)), langs.map((l) => {
          const i = el("input", { type: "text", dir: l.dir, value: r.map[l.code] || "" });
          i.addEventListener("input", () => { r.map[l.code] = i.value; });
          i.addEventListener("change", commit);
          return el("td", { class: missing(l) ? "miss" : "" }, i);
        })));
      });
      if (!n) t.append(el("tr", {}, el("td", { colspan: langs.length + 1 }, _t("Строк нет"))));
      tbl.append(t);
    };
    const cb = el("input", { type: "checkbox" });
    cb.addEventListener("change", () => { only = cb.checked; draw(); });
    draw();
    modal(_t("Переводы страницы"), el("div", {}, el("label", {}, cb, _t(" только непереведённые (красным — нет перевода при заполненном ● языке по умолчанию)")), tbl,
      el("p", { class: "hint" }, _t("Окна переводятся на своей странице: откройте окно и нажмите «🌐 Переводы»."))), [el("button", { class: "main", onclick: () => { closeModal(); renderAll(); } }, _t("Готово"))], true);
  }

  async function openSubs() {
    let list;
    try { list = (await api("GET", "submissions")).submissions; } catch (e) { return alert(_t("Ошибка: ") + e.message); }
    const fmt = (v) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? "✔" : v);
    const body = el("div", {}, list.length ? "" : el("p", { class: "hint" }, _t("Заявок пока нет.")),
      list.map((x) => el("div", { class: "sub" },
        el("div", {}, el("b", {}, new Date(x.created).toLocaleString()), ` · /${x.slug === "index" ? "" : x.slug} · ${x.form} · ${x.lang || ""}${x.mail ? (x.mail === "ok" ? _t(" · ✉ отправлено") : " · ✉✕ " + x.mail.slice(5)) : ""}`),
        el("div", {}, Object.entries(x.data).map(([k, v]) => `${k}: ${fmt(v)}`).join("   |   ")),
        el("button", { onclick: async (ev) => { await api("DELETE", "submissions/" + x.id); ev.target.closest(".sub").remove(); } }, _t("Удалить")))));
    modal(_t("Заявки"), body, [el("button", { onclick: () => exportCsv(list) }, "⬇ CSV"), el("button", { onclick: closeModal }, _t("Закрыть"))], true);
  }
  function exportCsv(list) {
    const keys = [...new Set(list.flatMap((x) => Object.keys(x.data)))];
    const q = (v) => { let t = Array.isArray(v) ? v.join("; ") : String(v ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; }; // защита от формул в Excel
    const rows = [["date", "page", "form", "lang", ...keys].map(q).join(","), ...list.map((x) => [new Date(x.created).toISOString(), x.slug, x.form, x.lang, ...keys.map((k) => x.data[k])].map(q).join(","))];
    el("a", { href: URL.createObjectURL(new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv" })), download: "submissions.csv" }).click();
  }

  function bind() {
    $("#basecss").textContent = PM.BASE_CSS;
    $("#pages").addEventListener("change", (e) => { S.back = []; openPage(S.pages.find((p) => p.id == e.target.value)); });
    $("#page-add").onclick = () => newPage("page");
    $("#modal-add").onclick = () => newPage("modal");
    $("#back").onclick = () => { const id = S.back.pop(); const m = S.pages.find((p) => p.id === id); if (m) openPage(m); };
    $("#tr").onclick = openTranslations;
    $("#uilang").addEventListener("change", async (e) => { UI.set(e.target.value); await save(); location.reload(); });
    $("#libtoggle").onclick = () => {
      S.libPinned = !S.libPinned;
      S.libForceVisible = S.libPinned;
      updateLibDrawer();
    };
    $("#lib-rail").onclick = () => { S.libPinned = true; S.libForceVisible = true; updateLibDrawer(); };
    $("#lib").addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") { S.libHover = true; updateLibDrawer(); }
    });
    $("#lib").addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") { S.libHover = false; updateLibDrawer(); }
    });
    $("#subs").onclick = openSubs;
    $("#page-del").onclick = async () => {
      if (S.page.slug === "index") return alert(_t("Главную страницу удалить нельзя"));
      if (!confirm(_t("Удалить «{0}»?", S.page.title))) return;
      await api("DELETE", "pages/" + S.page.id);
      S.pages = S.pages.filter((p) => p.id !== S.page.id);
      S.page = null; S.dirty = false;
      await openPage(S.pages.find((p) => p.slug === "index") || S.pages[0]);
    };
    $("#title").addEventListener("input", (e) => { S.page.title = e.target.value || "Untitled"; markDirty(); });
    $("#dev-d").onclick = () => setDev("d");
    $("#dev-m").onclick = () => setDev("m");
    $("#lang").addEventListener("change", (e) => { S.lang = e.target.value; renderAll(); });
    $("#undo").onclick = () => undo(-1);
    $("#redo").onclick = () => undo(1);
    $("#add").onclick = () => togglePal($("#add"));
    $("#history").onclick = openHistory;
    $("#settings").onclick = openSettings;
    $("#preview").onclick = preview;
    $("#publish").onclick = publish;

    $("#login-form").addEventListener("submit", (e) => { e.preventDefault(); S.token = $("#token").value; sessionStorage.setItem("pm-token", S.token); boot(); });
    addEventListener("keydown", (e) => {
      const typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable]");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
      else if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); undo(1); }
      else if (!typing && S.sel && e.key === "Delete") removeBlock(S.sel.bid);
      else if (!typing && S.sel && mod && e.key.toLowerCase() === "d") { e.preventDefault(); dupBlock(S.sel.bid); }
      else if (e.key === "Escape") { hideMenu(); if (!$("#modal").hidden) closeModal(); else closePal(); }
    });
    addEventListener("beforeunload", (e) => { if (S.dirty) e.preventDefault(); });
  }
  function setDev(d) {
    S.dev = d;
    $("#dev-d").classList.toggle("on", d === "d");
    $("#dev-m").classList.toggle("on", d === "m");
    renderAll();
  }

  // ---------- Вход и старт ----------
  const showLogin = () => { $("#login").hidden = false; };
  async function boot() {
    try {
      const d = await api("GET", "bootstrap");
      $("#login").hidden = true;
      S.cfg = d.config; S.pages = d.pages; S.r2 = d.r2; S.mail = d.mail; S.captcha = d.captcha;
      S.lang = S.cfg.defaultLang;
      fillLang();
      await loadLib();
      if (!S.pages.length) { // первый запуск: создаём главную страницу
        const meta = await api("POST", "pages", { slug: "index", title: "Home", doc: PM.newDoc() });
        S.pages.push(meta);
      }
      await openPage(S.pages.find((p) => p.slug === "index") || S.pages[0]);
    } catch (e) {
      if (e.message === "unauthorized") $("#login-err").textContent = S.token ? _t("Неверный токен") : "";
      else { $("#login").hidden = false; $("#login-err").textContent = _t("Ошибка: ") + e.message; }
    }
  }

  translateStatic();
  buildPal();
  bind();
  if (S.token) boot(); else showLogin();
})();
