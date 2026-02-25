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
const YSHOP_PLATFORM = process.env.YSHOP_PLATFORM || 'platform/web';
const YSHOP_PLATFORM_VERSION = process.env.YSHOP_PLATFORM_VERSION || '1.0.0';
const YSHOP_PLATFORM_ENGINE = process.env.YSHOP_PLATFORM_ENGINE || 'yshop-itemshop-license-suite';

const siteDomain = new URL(SITE_URL).hostname;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

let cachedLicense = { valid: false, checkedAt: 0, reason: 'UNVERIFIED' };

function parsePublicProducts(payload) {
  const buckets = [
    payload?.items,
    payload?.products,
    payload?.offers,
    payload?.packages,
    payload?.data?.items,
    payload?.data?.products,
    payload?.data?.offers,
    payload?.data?.packages,
    payload?.shop?.items,
    payload?.shop?.products,
    payload?.shop?.offers,
    payload?.shop?.packages
  ].filter(Array.isArray);

  const raw = buckets.flat();
  const normalized = raw
    .map((item) => ({
      id: item.id ?? item.productId ?? item.uuid,
      name: item.name ?? item.title ?? item.productName ?? 'Produkt',
      description: item.description ?? item.shortDescription ?? '',
      price: item.price ?? item.lowestPrice ?? item.basePrice ?? null,
      currency: item.currency ?? 'PLN'
    }))
    .filter((x) => x.id);

  const map = new Map();
  for (const p of normalized) {
    if (!map.has(String(p.id))) map.set(String(p.id), p);
  }
  return [...map.values()];
}

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
  return [
    // zgodnie z nową dokumentacją
    { 'x-api-key': key },
    // fallback pod starsze implementacje
    { authorization: `Bearer ${key}` }
  ];
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

    if (response.ok) {
      return payload;
    }

    const message = payload?.message || payload?.error || payload?.error_message || text || `HTTP ${response.status}`;
    lastErr = `YShop ${response.status}: ${message}`;

    // jeśli to nie auth błąd, nie ma sensu próbować kolejnym sposobem
    if (![400, 401, 403, 404].includes(response.status)) {
      break;
    }
  }

  throw new Error(lastErr);
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
      <p>Jeśli ustawiłeś <code>LICENSE_KEY</code> przed chwilą, zrestartuj <code>npm run dev:shop</code>. Ta aplikacja ładuje .env z <code>apps/client-shop/.env</code>.</p></div></body></html>`);
  }
  return next();
}

async function fetchShopBootstrap() {
  try {
    const [shop, servers] = await Promise.all([
      yshopRequest({ keyType: 'public', endpoint: '/v4/client/public/shop' }),
      yshopRequest({ keyType: 'public', endpoint: '/v4/client/public/servers' })
    ]);

    const products = parsePublicProducts(shop);
    return {
      shop,
      servers: Array.isArray(servers) ? servers : servers?.items || servers?.data || [],
      products,
      error: null
    };
  } catch (err) {
    return { shop: null, products: [], servers: [], error: err.message };
  }
}

function renderPage() {
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
.price{font-size:22px;color:var(--acc);font-weight:700}button,input,select{width:100%;padding:10px;border-radius:8px;margin-top:8px}
input,select{border:1px solid #334155;background:#0b1220;color:var(--text)}button{border:none;background:linear-gradient(90deg,#0ea5e9,#22d3ee);font-weight:700;color:#082f49;cursor:pointer}
.err{margin:12px 0;padding:10px;border-radius:8px;background:#3f0a14;border:1px solid #7f1d1d;color:#fecdd3}.ok{margin:12px 0;padding:10px;border-radius:8px;background:#052e16;border:1px solid #166534;color:#bbf7d0}
.muted{color:var(--muted)}
</style>
</head>
<body>
<main class='wrap'>
  <section class='hero'>
    <h1>Premium ItemShop</h1>
    <p class='muted'>Połączone z yshop.pl (Swagger v4 client public/private). Domena licencji: <b>${siteDomain}</b></p>
  </section>
  <div id='alerts'></div>
  <section class='grid' id='products'></section>
</main>
<script>
const alerts=document.getElementById('alerts');
const productsEl=document.getElementById('products');

function setAlert(type,msg){alerts.innerHTML='<div class="'+(type==='ok'?'ok':'err')+'">'+msg+'</div>'}

async function boot(){
  const r=await fetch('/api/bootstrap');
  const data=await r.json();
  if(!r.ok){setAlert('err',data.error||'Błąd ładowania');return}
  if(data.error){setAlert('err',data.error)}
  if(!data.products?.length){setAlert('err','Brak produktów zwróconych przez /v4/client/public/shop. Sprawdź konfigurację yshop i klucze.');}

  productsEl.innerHTML=(data.products||[]).map(function(p){
    const options=(data.servers||[]).map(function(s){
      return '<option value="'+(s.id||'')+'">'+(s.name||s.id||'server')+'</option>';
    }).join('');
    return '<article class="card">'
      +'<h3>'+(p.name||'Produkt')+'</h3>'
      +'<div class="price">'+((p.price ?? 'N/A'))+' '+(p.currency||'PLN')+'</div>'
      +'<p class="muted">ID: '+p.id+'</p>'
      +'<p class="muted">'+(p.description||'')+'</p>'
      +'<form data-id="'+p.id+'">'
      +'<input name="email" type="email" placeholder="email kupującego" required>'
      +'<input name="nickname" placeholder="nick gracza (opcjonalnie)">'
      +'<select name="serverId"><option value="">serverId (opcjonalnie)</option>'+options+'</select>'
      +'<button>Zapłać</button>'
      +'</form>'
      +'</article>';
  }).join('');

  productsEl.querySelectorAll('form').forEach(f=>f.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const fd=new FormData(f);
    const body={productId:f.dataset.id,email:fd.get('email'),nickname:fd.get('nickname')||undefined,serverId:fd.get('serverId')||undefined};
    const rr=await fetch('/api/payments/make',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const out=await rr.json();
    if(!rr.ok){setAlert('err',out.error||'Błąd płatności');return}
    const link=out.paymentUrl||out.url||out.paymentLink||out?.payment?.url;
    if(link){window.location.href=link;return}
    setAlert('ok','Płatność utworzona. Odpowiedź: '+JSON.stringify(out));
  }))
}
boot().catch(e=>setAlert('err',e.message));
</script>
</body></html>`;
}

app.get('/', requireLicense, (_req, res) => {
  res.type('html').send(renderPage());
});

app.get('/api/bootstrap', requireLicense, async (_req, res) => {
  const data = await fetchShopBootstrap();
  res.status(data.error ? 502 : 200).json(data);
});

app.get('/api/payments/products/:id', requireLicense, async (req, res) => {
  try {
    const product = await yshopRequest({
      keyType: 'private',
      endpoint: `/v4/client/private/payments/products/${encodeURIComponent(req.params.id)}`
    });
    res.json(product);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/payments/make', requireLicense, async (req, res) => {
  const { productId, email, nickname, serverId } = req.body || {};
  if (!productId || !email) {
    return res.status(400).json({ error: 'productId i email są wymagane' });
  }

  const payload = {
    productId,
    email,
    nickname,
    serverId,
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
      platform: YSHOP_PLATFORM,
      platformVersion: YSHOP_PLATFORM_VERSION,
      platformEngine: YSHOP_PLATFORM_ENGINE
    }
  });
});

app.listen(PORT, () => {
  console.log(`Client shop running on http://localhost:${PORT}`);
});
