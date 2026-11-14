export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const variant = url.searchParams.get('ab_variant');
    const source = url.searchParams.get('source');
    const status = url.searchParams.get('status');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const search = url.searchParams.get('search');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let sql = `SELECT * FROM leads WHERE 1=1`;
    const params = [];

    if (variant) {
      sql += ` AND ab_variant = ?`;
      params.push(variant);
    }
    if (source) {
      sql += ` AND (social_provider = ? OR oauth_provider = ?)`;
      params.push(source, source);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (dateFrom) {
      sql += ` AND created_at >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND created_at <= ?`;
      params.push(dateTo);
    }
    if (search) {
      sql += ` AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR town LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const { results } = await env.DB.prepare(sql).bind(...params).all();

    return new Response(JSON.stringify({ leads: results }), {
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
    if (!data.id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    await env.DB.prepare(
      `UPDATE leads SET status = ?, notes = ?, next_action = ?, next_action_date = ? WHERE id = ?`
    ).bind(
      data.status || 'new',
      data.notes || '',
      data.next_action || '',
      data.next_action_date || null,
      data.id
    ).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}