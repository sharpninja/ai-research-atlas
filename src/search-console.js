const encoder = new TextEncoder();

function base64url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function privateKeyBytes(pem) {
  const clean = pem.replaceAll('\\n', '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(clean); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function accessToken(env, fetcher) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = base64url(JSON.stringify({iss:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/webmasters.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned = header + '.' + claim;
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const response = await fetcher('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+base64url(signature)})});
  if (!response.ok) throw new Error('Google authorization failed');
  const data = await response.json();
  if (!data.access_token) throw new Error('Google authorization returned no access token');
  return data.access_token;
}

export async function searchConsoleSummary(env, days, fetcher = fetch) {
  const required = ['SEARCH_CONSOLE_SITE_URL','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'];
  if (required.some(key => !env[key])) return {configured:false, rows:[]};
  const end = new Date(Date.now() - 86400000); const start = new Date(end.getTime() - (days - 1) * 86400000);
  const date = value => value.toISOString().slice(0,10);
  const token = await accessToken(env, fetcher);
  const endpoint = 'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(env.SEARCH_CONSOLE_SITE_URL) + '/searchAnalytics/query';
  const response = await fetcher(endpoint, {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({startDate:date(start),endDate:date(end),dimensions:['query','page'],type:'web',rowLimit:1000})});
  if (!response.ok) throw new Error('Google Search Console request failed');
  const data = await response.json();
  return {configured:true,start:date(start),end:date(end),rows:(data.rows || []).map(row => ({query:row.keys?.[0] || '',page:row.keys?.[1] || '',clicks:Number(row.clicks)||0,impressions:Number(row.impressions)||0,ctr:Number(row.ctr)||0,position:Number(row.position)||0}))};
}
