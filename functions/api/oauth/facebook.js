export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const clientId = env.FACEBOOK_CLIENT_ID;
  const clientSecret = env.FACEBOOK_CLIENT_SECRET;
  const redirectUri = env.FACEBOOK_REDIRECT_URI || 'https://casacaretenerife.pages.dev/api/oauth/facebook';
  const pagesUrl = env.PAGES_URL || 'https://casacaretenerife.pages.dev';

  if (error) {
    return new Response(`OAuth ошибка: ${error}`, { status: 400 });
  }

  if (!code) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email,public_profile'
    });
    return Response.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
  }

  const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  })}`);

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return new Response('Ошибка обмена кода на токен', { status: 400 });
  }

  const userRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokens.access_token}`);
  const user = await userRes.json();

  const cookieValue = JSON.stringify({
    provider: 'facebook',
    oauth_id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture?.data?.url
  });

  const response = Response.redirect(`${pagesUrl}/?oauth=success&variant=b`, 302);
  response.headers.set('Set-Cookie', `cc_oauth=${cookieValue}; Path=/; Max-Age=86400; SameSite=Lax`);
  return response;
}