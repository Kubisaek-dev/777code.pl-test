import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const LICENSE_KEY = process.env.LICENSE_KEY || '';
const LICENSE_API_BASE = process.env.LICENSE_API_BASE || 'http://localhost:4000';

const YSHOP_API_BASE = process.env.YSHOP_API_BASE || 'https://api.yshop.pl';
const YSHOP_PUBLIC_KEY = process.env.YSHOP_PUBLIC_KEY || process.env.PUBLIC_API_KEY || '';
const YSHOP_PRIVATE_KEY = process.env.YSHOP_PRIVATE_KEY || process.env.PRIVATE_API_KEY || '';
const YSHOP_SHOP_SLUG = process.env.YSHOP_SHOP_SLUG || '';
const YSHOP_PLATFORM = process.env.YSHOP_PLATFORM || 'platform/web';
const YSHOP_PLATFORM_VERSION = process.env.YSHOP_PLATFORM_VERSION || '1.0.0';
const YSHOP_PLATFORM_ENGINE = process.env.YSHOP_PLATFORM_ENGINE || 'yshop-itemshop-license-suite';

const siteDomain = new URL(SITE_URL).hostname;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

let cachedLicense = { valid: false, checkedAt: 0, reason: 'UNVERIFIED' };

function baseHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-app-platform': YSHOP_PLATFORM,
    'x-app-platform-version': YSHOP_PLATFORM_VERSION,
    'x-app-platform-engine': YSHOP_PLATFORM_ENGINE
  };
}

function buildAuthCandidates(key) {
  if (!key) return [];
  return [{ 'x-api-key': key }, { authorization: `Bearer ${key}` }];
}

function parseServers(payload) {
  const arr = Array.isArray(payload)
    ? payload
    : payload?.items || payload?.servers || payload?.data || payload?.data?.servers || [];
  if (!Array.isArray(arr)) return [];

  return arr
    .map((s) => ({ id: s.id ?? s.serverId ?? s.uuid, name: s.name ?? s.title ?? `Serwer ${s.id}` }))
    .filter((s) => s.id);
}

function collectObjectsRecursively(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectsRecursively(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    out.push(value);
    for (const v of Object.values(value)) collectObjectsRecursively(v, out);
  }
  return out;
}

function tryBase64Decode(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.includes('\u0000') ? value : decoded;
  } catch {
    return value;
  }
}

function parseProducts(payload) {
  const objects = collectObjectsRecursively(payload);
  const found = [];

  for (const obj of objects) {
    for (const key of ['items', 'products', 'offers', 'packages', 'kits']) {
      if (Array.isArray(obj[key])) {
        found.push(...obj[key]);
      }
    }

    const looksLikeProduct =
      (obj.id || obj.productId || obj.uuid) &&
      (obj.name || obj.title || obj.productName) &&
      (Object.hasOwn(obj, 'price') || Object.hasOwn(obj, 'lowestPrice') || Object.hasOwn(obj, 'basePrice'));

    if (looksLikeProduct) found.push(obj);
  }

  const normalized = found
    .map((item) => ({
      id: item.id ?? item.productId ?? item.uuid,
      name: item.name ?? item.title ?? item.productName ?? 'Produkt',
      description:
        item.description ??
        item.shortDescription ??
        item.short_description ??
        tryBase64Decode(item.short_description) ??
        '',
      price: item.price ?? item.lowestPrice ?? item.basePrice ?? null,
      currency: item.currency ?? 'PLN',
      serverId: item.serverId ?? item.server?.id ?? item.server_id ?? null,
      original: item
    }))
    .filter((item) => item.id);

  const unique = new Map();
  for (const item of normalized) {
    if (!unique.has(String(item.id))) unique.set(String(item.id), item);
  }

  return [...unique.values()];
}

async function yshopRequest({ keyType, method = 'GET', endpoint, body = null }) {
  const key = keyType === 'private' ? YSHOP_PRIVATE_KEY : YSHOP_PUBLIC_KEY;
  const authCandidates = buildAuthCandidates(key);

  if (!authCandidates.length) {
    throw new Error(`MISSING_${keyType.toUpperCase()}_KEY`);
  }

  let lastErr = 'Unknown error';
  for (const authHeaders of authCandidates) {
    const response = await fetch(`${YSHOP_API_BASE}${endpoint}`, {
      method,
      headers: { ...baseHeaders(), ...authHeaders },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (response.ok) return payload;

    const message = payload?.message || payload?.error || payload?.error_message || text || `HTTP ${response.status}`;
    lastErr = `YShop ${response.status}: ${message}`;

    if (![400, 401, 403, 404].includes(response.status)) break;
  }

  throw new Error(lastErr);
}

function parseNextDataFromHtml(html) {
  const regex = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i;
  const match = html.match(regex);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function fetchFromYshopWebsite({ shopSlug, serverId }) {
  if (!shopSlug) return { products: [], servers: [], warning: null };
  const url = serverId
    ? `https://yshop.pl/shop/${encodeURIComponent(shopSlug)}/server/${encodeURIComponent(serverId)}`
    : `https://yshop.pl/shop/${encodeURIComponent(shopSlug)}`;

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; yshop-itemshop-template/1.0)' }
    });

    if (!response.ok) {
      return { products: [], servers: [], warning: `Fallback web fetch failed: HTTP ${response.status}` };
    }

    const html = await response.text();
    const nextData = parseNextDataFromHtml(html);
    if (!nextData) {
      return { products: [], servers: [], warning: 'Fallback web fetch: __NEXT_DATA__ not found' };
    }

    const products = parseProducts(nextData);
    const servers = parseServers(nextData);

    return {
      products,
      servers,
      warning: products.length ? null : 'Fallback web fetch found no products'
    };
  } catch (err) {
    return { products: [], servers: [], warning: `Fallback web fetch error: ${err.message}` };
  }
}

async function verifyLicense(force = false) {
  if (!LICENSE_KEY) {
    cachedLicense = { valid: false, checkedAt: Date.now(), reason: 'MISSING_LICENSE_KEY' };
    return cachedLicense;
  }

  const now = Date.now();
  if (!force && now - cachedLicense.checkedAt < 15_000) return cachedLicense;

  try {
    const response = await fetch(`${LICENSE_API_BASE}/api/licenses/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: LICENSE_KEY, domain: siteDomain })
    });
    const data = await response.json();
    cachedLicense = { ...data, checkedAt: now };
  } catch {
    cachedLicense = { valid: false, checkedAt: now, reason: 'VERIFY_UNAVAILABLE' };
  }

  return cachedLicense;
}

async function requireLicense(_req, res, next) {
  const status = await verifyLicense(true);
  if (!status.valid) {
    return res.status(403).type('html').send(`<!doctype html><html lang='pl'><head><meta charset='utf-8'><title>Licencja</title>
      <style>body{font-family:Inter,Arial;background:#0b1220;color:#e2e8f0;padding:24px}.box{max-width:760px;margin:40px auto;background:#111827;border:1px solid #334155;padding:18px;border-radius:12px}</style>
      </head><body><div class='box'><h1>Sklep zablokowany</h1><p>Licencja: <b>${status.reason}</b></p>
      <p>Ta aplikacja ładuje .env z <code>apps/client-shop/.env</code>. Po zmianie kluczy uruchom ponownie <code>npm run dev:shop</code>.</p></div></body></html>`);
  }
  return next();
}

async function fetchShopData({ shopSlug, serverId }) {
  const outputs = {};

  const [shop, serversRaw, page, serverDetails] = await Promise.allSettled([
    yshopRequest({ keyType: 'public', endpoint: '/v4/client/public/shop' }),
    yshopRequest({ keyType: 'public', endpoint: '/v4/client/public/servers' }),
    yshopRequest({ keyType: 'public', endpoint: `/v4/client/public/page/${encodeURIComponent(shopSlug)}` }),
    serverId
      ? yshopRequest({ keyType: 'public', endpoint: `/v4/client/public/servers/${encodeURIComponent(serverId)}` })
      : Promise.resolve(null)
  ]);

  outputs.shop = shop.status === 'fulfilled' ? shop.value : null;
  outputs.serversRaw = serversRaw.status === 'fulfilled' ? serversRaw.value : null;
  outputs.page = page.status === 'fulfilled' ? page.value : null;
  outputs.serverDetails = serverDetails.status === 'fulfilled' ? serverDetails.value : null;

  const warnings = [shop, serversRaw, page, serverDetails]
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message)
    .filter(Boolean);

  let products = parseProducts(outputs.shop)
    .concat(parseProducts(outputs.page))
    .concat(parseProducts(outputs.serverDetails));

  let servers = parseServers(outputs.serversRaw);

  if (!products.length) {
    const webFallback = await fetchFromYshopWebsite({ shopSlug, serverId });
    products = webFallback.products;
    if (!servers.length) servers = webFallback.servers;
    if (webFallback.warning) warnings.push(webFallback.warning);
  }

  const uniqueProducts = [];
  const seen = new Set();
  for (const p of products) {
    const key = String(p.id);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProducts.push(p);
    }
  }

  const filteredProducts = serverId
    ? uniqueProducts.filter((p) => !p.serverId || String(p.serverId) === String(serverId))
    : uniqueProducts;

  return {
    shopSlug,
    serverId: serverId || null,
    shop: outputs.shop,
    servers,
    products: filteredProducts,
    warnings,
    error: filteredProducts.length ? null : warnings[0] || 'Brak produktów zwróconych przez API'
  };
}

function renderPage({ shopSlug = '', serverId = '' }) {
  return `<!doctype html>
<html lang='pl'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Premium ItemShop</title>
<style>
:root{--bg:#020617;--panel:#0f172a;--line:#223047;--text:#e2e8f0;--muted:#9aa6b2;--acc:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 10% -20%,#1e3a8a33,transparent),var(--bg);font-family:Inter,Arial;color:var(--text)}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px}.hero{padding:18px;border:1px solid var(--line);background:#0b1220;border-radius:14px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}.card{border:1px solid var(--line);background:linear-gradient(180deg,#0e1728,#0a1220);border-radius:12px;padding:12px}
.price{font-size:22px;color:var(--acc);font-weight:700}button,input{width:100%;padding:10px;border-radius:8px;margin-top:8px}
input{border:1px solid #334155;background:#0b1220;color:var(--text)}button{border:none;background:linear-gradient(90deg,#0ea5e9,#22d3ee);font-weight:700;color:#082f49;cursor:pointer}
.err{margin:12px 0;padding:10px;border-radius:8px;background:#3f0a14;border:1px solid #7f1d1d;color:#fecdd3}.ok{margin:12px 0;padding:10px;border-radius:8px;background:#052e16;border:1px solid #166534;color:#bbf7d0}
.muted{color:var(--muted)} .servers{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.server-btn{display:inline-block;padding:8px 12px;border-radius:999px;border:1px solid #334155;color:#cbd5e1;text-decoration:none}
.server-btn.active{background:#0ea5e9;color:#082f49;border-color:#0ea5e9}
</style>
</head>
<body>
<main class='wrap'>
  <section class='hero'>
    <h1>Premium ItemShop</h1>
    <p class='muted'>Widok jak yshop: /shop/{slug}/server/{id}. Domena licencji: <b>${siteDomain}</b></p>
    <div class='muted'>Wybrany sklep (slug): <b>${shopSlug || '-'}</b> | serwer: <b>${serverId || 'all'}</b></div>
    <form id='shopForm'>
      <input name='shopSlug' placeholder='slug sklepu, np. asdas715612as' value='${shopSlug}' required>
      <button>Przejdź do sklepu</button>
    </form>
  </section>
  <div id='alerts'></div>
  <section id='servers' class='servers'></section>
  <section class='grid' id='products'></section>
</main>
<script>
const initialSlug=${JSON.stringify(shopSlug)};
const initialServer=${JSON.stringify(serverId)};
const alerts=document.getElementById('alerts');
const productsEl=document.getElementById('products');
const serversEl=document.getElementById('servers');

function setAlert(type,msg){alerts.innerHTML='<div class="'+(type==='ok'?'ok':'err')+'">'+msg+'</div>'}

document.getElementById('shopForm').addEventListener('submit', (ev)=>{
  ev.preventDefault();
  const fd=new FormData(ev.target);
  const slug=String(fd.get('shopSlug')||'').trim();
  if(!slug)return;
  window.location.href='/shop/'+encodeURIComponent(slug);
});

async function boot(){
  const qs=new URLSearchParams({shopSlug:initialSlug,serverId:initialServer||''});
  const r=await fetch('/api/shop-data?'+qs.toString());
  const data=await r.json();

  if(data.error){setAlert('err',data.error)}
  if(Array.isArray(data.warnings) && data.warnings.length){
    setAlert('err',(data.error?data.error+' | ':'')+'API/Fallback warnings: '+data.warnings.join(' | '));
  }

  const slug=encodeURIComponent(data.shopSlug||'');
  const activeServer=String(data.serverId||'');
  serversEl.innerHTML='<a class="server-btn '+(activeServer===''?'active':'')+'" href="/shop/'+slug+'">Wszystkie</a>'+
    (data.servers||[]).map(function(s){
      const id=String(s.id);
      return '<a class="server-btn '+(id===activeServer?'active':'')+'" href="/shop/'+slug+'/server/'+encodeURIComponent(id)+'">'+(s.name||id)+'</a>';
    }).join('');

  if(!data.products?.length){
    productsEl.innerHTML='';
    if(!data.error)setAlert('err','Brak produktów dla wybranego sklepu/serwera.');
    return;
  }

  productsEl.innerHTML=(data.products||[]).map(function(p){
    return '<article class="card">'
      +'<h3>'+(p.name||'Produkt')+'</h3>'
      +'<div class="price">'+((p.price ?? 'N/A'))+' '+(p.currency||'PLN')+'</div>'
      +'<p class="muted">ID: '+p.id+'</p>'
      +'<p class="muted">'+(p.description||'')+'</p>'
      +'<form data-id="'+p.id+'">'
      +'<input name="email" type="email" placeholder="email kupującego" required>'
      +'<input name="nickname" placeholder="nick gracza (opcjonalnie)">'
      +'<input name="serverId" value="'+(activeServer||'')+'" placeholder="serverId (opcjonalnie)">'
      +'<button>Zapłać</button>'
      +'</form>'
      +'</article>';
  }).join('');

  productsEl.querySelectorAll('form').forEach(function(f){
    f.addEventListener('submit', async function(ev){
      ev.preventDefault();
      const fd=new FormData(f);
      const body={
        productId:f.dataset.id,
        email:fd.get('email'),
        nickname:fd.get('nickname')||undefined,
        serverId:fd.get('serverId')||undefined,
        shopSlug:initialSlug
      };
      const rr=await fetch('/api/payments/make',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const out=await rr.json();
      if(!rr.ok){setAlert('err',out.error||'Błąd płatności');return}
      const link=out.paymentUrl||out.url||out.paymentLink||out?.payment?.url;
      if(link){window.location.href=link;return}
      setAlert('ok','Płatność utworzona. Odpowiedź: '+JSON.stringify(out));
    });
  });
}

boot().catch(function(e){setAlert('err',e.message)});
</script>
</body></html>`;
}

app.get('/', requireLicense, (_req, res) => {
  if (YSHOP_SHOP_SLUG) return res.redirect(`/shop/${encodeURIComponent(YSHOP_SHOP_SLUG)}`);
  return res.type('html').send(renderPage({ shopSlug: '', serverId: '' }));
});

app.get('/shop/:shopSlug', requireLicense, (req, res) => {
  res.type('html').send(renderPage({ shopSlug: req.params.shopSlug, serverId: '' }));
});

app.get('/shop/:shopSlug/server/:serverId', requireLicense, (req, res) => {
  res.type('html').send(renderPage({ shopSlug: req.params.shopSlug, serverId: req.params.serverId }));
});

app.get('/api/shop-data', requireLicense, async (req, res) => {
  const shopSlug = String(req.query.shopSlug || YSHOP_SHOP_SLUG || '').trim();
  const serverId = String(req.query.serverId || '').trim();
  if (!shopSlug) return res.status(400).json({ error: 'Brak shopSlug. Użyj /shop/{slug}' });

  const data = await fetchShopData({ shopSlug, serverId });
  return res.status(data.error ? 502 : 200).json(data);
});

app.get('/api/payments/products/:id', requireLicense, async (req, res) => {
  try {
    const product = await yshopRequest({
      keyType: 'private',
      endpoint: `/v4/client/private/payments/products/${encodeURIComponent(req.params.id)}`
    });
    return res.json(product);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.post('/api/payments/make', requireLicense, async (req, res) => {
  const { productId, email, nickname, serverId, shopSlug } = req.body || {};
  if (!productId || !email) return res.status(400).json({ error: 'productId i email są wymagane' });

  const payload = {
    productId,
    email,
    nickname,
    serverId,
    shopSlug,
    successUrl: `${SITE_URL}/?payment=success`,
    failUrl: `${SITE_URL}/?payment=fail`
  };

  try {
    const payment = await yshopRequest({
      keyType: 'private',
      method: 'POST',
      endpoint: '/v4/client/private/payments/make',
      body: payload
    });
    return res.json(payment);
  } catch (err) {
    return res.status(502).json({ error: err.message, requestPayload: payload });
  }
});

app.get('/health', async (_req, res) => {
  const license = await verifyLicense(true);
  res.json({
    status: 'ok',
    license,
    config: {
      envFile: path.join(__dirname, '../.env'),
      siteDomain,
      yshopBase: YSHOP_API_BASE,
      hasPublicKey: Boolean(YSHOP_PUBLIC_KEY),
      hasPrivateKey: Boolean(YSHOP_PRIVATE_KEY),
      defaultShopSlug: YSHOP_SHOP_SLUG,
      platform: YSHOP_PLATFORM,
      platformVersion: YSHOP_PLATFORM_VERSION,
      platformEngine: YSHOP_PLATFORM_ENGINE
    }
  });
});

app.listen(PORT, () => {
  console.log(`Client shop running on http://localhost:${PORT}`);
});
