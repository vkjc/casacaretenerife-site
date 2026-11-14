export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const name = (data.name || '').trim().slice(0, 100);
  if (!name) return json({ error: 'name required' }, 400);

  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  const telegram = (data.telegram || '').trim();

  if (!email && !phone && !telegram && !data.oauth_email) {
    return json({ error: 'contact required' }, 400);
  }

  // Гео-данные от Cloudflare (определяются автоматически по IP)
  const cf = request.cf || {};
  const geoCountry = cf.country || '';
  const geoCity = cf.city || '';

  const id = crypto.randomUUID();
  const services = Array.isArray(data.services) ? data.services.join(',') : '';
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || '');

  const abVariant = data.ab_variant || 'A';
  const socialProvider = data.social_provider || null;
  const oauthProvider = data.oauth_provider || null;
  const oauthId = data.oauth_id || null;
  const oauthEmail = data.oauth_email || null;
  const oauthName = data.oauth_name || null;
  const formData = data.form_data ? JSON.stringify(data.form_data) : null;

  try {
    await env.DB.prepare(
      `INSERT INTO leads (id, created_at, lang, town, tier, obj_type, vacancy, services, email, phone, telegram, name, ua, ip_hash, geo_country, geo_city, ab_variant, social_provider, oauth_provider, oauth_id, oauth_email, oauth_name, form_data)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, data.lang || '', data.town || '', data.tier || '',
      data.objectType || '', data.vacancy || '', services,
      email, phone, telegram, name,
      (request.headers.get('User-Agent') || '').slice(0, 300), ipHash,
      geoCountry, geoCity,
      abVariant, socialProvider, oauthProvider, oauthId, oauthEmail, oauthName, formData
    ).run();
  } catch (e) {
    console.error("ОШИБКА БАЗЫ ДАННЫХ:", e.message);
    return json({ error: 'DB error: ' + e.message }, 500);
  }

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const text = buildTelegramText({ ...data, name, email, phone, telegram, abVariant, socialProvider, oauthProvider });
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }).catch((e) => console.error('Telegram error', e));
  }

  // Email
  const recipientEmail = email || oauthEmail;
  if (env.RESEND_API_KEY && recipientEmail) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Casa Care <onboarding@resend.dev>',
        to: 'casacaretenerife@gmail.com',
        subject: `Новая заявка (${abVariant}): ${data.town} · ${name}`,
        text: buildEmailText({ ...data, name, email, phone, telegram, abVariant, socialProvider, oauthProvider })
      })
    }).catch((e) => console.error('Email error', e));
  }

  return json({ ok: true, id, ab_variant: abVariant });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildTelegramText(d) {
  return [
    '🏠 <b>Новая заявка</b>',
    `<b>Вариант:</b> ${esc(d.abVariant)}`,
    `<b>Источник:</b> ${esc(d.socialProvider || d.oauthProvider || 'manual')}`,
    `<b>Имя:</b> ${esc(d.name)}`,
    `<b>Город:</b> ${esc(d.town)} (${esc(d.tier)})`,
    `<b>Тип:</b> ${esc(d.objectType)} · ${esc(d.vacancy)}`,
    `<b>Услуги:</b> ${esc(d.services)}`,
    `---`,
    `<b>Email:</b> ${esc(d.email || d.oauthEmail || '—')}`,
    `<b>WhatsApp:</b> ${esc(d.phone || '—')}`,
    `<b>Telegram:</b> ${esc(d.telegram || '—')}`,
    `<b>Язык:</b> ${esc(d.lang)}`
  ].join('\n');
}

function buildEmailText(d) {
  return [
    'Новая заявка с сайта Casa Care on Canary',
    '',
    `Вариант воронки: ${d.abVariant}`,
    `Источник: ${d.socialProvider || d.oauthProvider || 'ручной ввод'}`,
    `Имя: ${d.name}`,
    `Город: ${d.town} (${d.tier})`,
    `Тип: ${d.objectType} · ${d.vacancy}`,
    `Услуги: ${d.services}`,
    '',
    `Email: ${d.email || d.oauthEmail || '—'}`,
    `WhatsApp: ${d.phone || '—'}`,
    `Telegram: ${d.telegram || '—'}`,
    `Язык: ${d.lang}`
  ].join('\n');
}