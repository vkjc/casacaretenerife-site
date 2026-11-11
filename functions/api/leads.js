export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM leads ORDER BY created_at DESC`
    ).all();
    
    return new Response(JSON.stringify({ leads: results }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store' 
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}