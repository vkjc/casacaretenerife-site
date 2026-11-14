export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI || 'https://casacaretenerife.pages.dev/api/oauth/google';
  const pagesUrl = env.PAGES_URL || 'https://casacaretenerife.pages.dev';

  if (error) {
    return new Response(`OAuth ошибка: ${error}`, { status: 400 });
  }

  if (!code) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent'
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return new Response('Ошибка обмена кода на токен', { status: 400 });
  }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const user = await userRes.json();

  const cookieValue = JSON.stringify({
    provider: 'google',
    oauth_id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture
  });

  const response = Response.redirect(`${pagesUrl}/?oauth=success&variant=b`, 302);
  response.headers.set('Set-Cookie', `cc_oauth=${cookieValue}; Path=/; Max-Age=86400; SameSite=Lax`);
  return response;
}