export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT variant_id, name, is_active, traffic_percent, form_module FROM ab_variants ORDER BY variant_id`
    ).all();

    return new Response(JSON.stringify({ variants: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    const variants = Array.isArray(data) ? data : [data];

    const activeSum = variants
      .filter(v => v.is_active)
      .reduce((sum, v) => sum + (parseInt(v.traffic_percent) || 0), 0);

    if (activeSum !== 100) {
      return new Response(JSON.stringify({ error: `Сумма процентов активных вариантов должна быть 100, сейчас ${activeSum}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    for (const v of variants) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO ab_variants (variant_id, name, is_active, traffic_percent, form_module, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        v.variant_id,
        v.name || '',
        v.is_active ? 1 : 0,
        v.traffic_percent || 0,
        v.form_module || ''
      ).run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}