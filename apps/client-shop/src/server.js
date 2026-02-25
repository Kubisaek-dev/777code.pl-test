import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const LICENSE_KEY = process.env.LICENSE_KEY || '';
const LICENSE_API_BASE = process.env.LICENSE_API_BASE || 'http://localhost:4000';

const YSHOP_API_BASE = process.env.YSHOP_API_BASE || 'https://api.yshop.pl';
const YSHOP_API_KEY = process.env.YSHOP_API_KEY || '';
const YSHOP_PUBLIC_KEY = process.env.YSHOP_PUBLIC_KEY || '';
const YSHOP_PRODUCTS_PATH = process.env.YSHOP_PRODUCTS_PATH || '/products';
const YSHOP_ORDERS_PATH = process.env.YSHOP_ORDERS_PATH || '/orders';

const siteDomain = new URL(SITE_URL).hostname;

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

let cachedLicense = { valid: false, checkedAt: 0, reason: 'UNVERIFIED' };

function yshopHeaders(extra = {}) {
  const headers = {
    'content-type': 'application/json',
    ...extra
  };

  if (YSHOP_API_KEY) {
    headers.authorization = `Bearer ${YSHOP_API_KEY}`;
  }

  if (YSHOP_PUBLIC_KEY) {
    headers['x-public-key'] = YSHOP_PUBLIC_KEY;
    headers['x-api-key'] = YSHOP_PUBLIC_KEY;
  }

  return headers;
}

async function verifyLicense() {
  if (!LICENSE_KEY) {
    cachedLicense = { valid: false, checkedAt: Date.now(), reason: 'MISSING_LICENSE_KEY' };
    return cachedLicense;
  }

  const now = Date.now();
  if (now - cachedLicense.checkedAt < 30_000) return cachedLicense;

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
  const status = await verifyLicense();
  if (!status.valid) {
    return res.status(403).type('html').send(`<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Shop disabled</title>
<style>body{font-family:Arial,sans-serif;background:#111827;color:#e5e7eb;padding:30px}.box{max-width:680px;margin:30px auto;background:#1f2937;padding:18px;border-radius:12px;border:1px solid #374151}</style>
</head><body><div class='box'><h1>Sklep jest niedostępny</h1><p>Licencja niepoprawna: <b>${status.reason}</b></p><p>Sprawdź ustawienia <code>LICENSE_KEY</code>, <code>SITE_URL</code> i przypisanie domeny w panelu admina.</p></div></body></html>`);
  }
  return next();
}

async function yshopRequest(path, options = {}) {
  const response = await fetch(`${YSHOP_API_BASE}${path}`, {
    ...options,
    headers: yshopHeaders(options.headers || {})
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`YShop error ${response.status}: ${txt}`);
  }

  return response.json();
}

function renderShopPage({ products, apiError }) {
  return `<!doctype html>
  <html lang='pl'>
  <head>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <title>YShop ItemShop</title>
    <style>
      :root{--bg:#0f172a;--panel:#111827;--text:#e5e7eb;--muted:#94a3b8;--accent:#22d3ee}
      *{box-sizing:border-box}
      body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#020617,#0f172a);color:var(--text)}
      .container{max-width:1080px;margin:0 auto;padding:22px 16px}
      .hero{background:rgba(17,24,39,.9);border:1px solid #243147;border-radius:14px;padding:16px;margin-bottom:18px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
      .card{background:rgba(17,24,39,.92);border:1px solid #243147;border-radius:12px;padding:12px}
      .price{font-size:20px;color:var(--accent);font-weight:700;margin:8px 0}
      input,button{width:100%;padding:10px;border-radius:8px;margin-top:8px}
      input{border:1px solid #334155;background:#0b1220;color:var(--text)}
      button{border:none;background:linear-gradient(90deg,#0ea5e9,#22d3ee);font-weight:700;color:#052230;cursor:pointer}
      .err{background:#3f0a14;border:1px solid #7f1d1d;color:#fecdd3;padding:10px;border-radius:8px;margin:12px 0}
      .muted{color:var(--muted)}
    </style>
  </head>
  <body>
    <main class='container'>
      <section class='hero'>
        <h1>YShop ItemShop</h1>
        <p class='muted'>Domena licencji: <b>${siteDomain}</b></p>
        <p class='muted'>Integracja: ${YSHOP_PUBLIC_KEY ? 'public key + API key/bearer (jeśli ustawione)' : 'API key/bearer'}</p>
      </section>

      ${apiError ? `<div class='err'>Błąd API YShop: ${apiError}</div>` : ''}

      <section class='grid'>
        ${products
          .map(
            (p) => `<article class='card'>
                <h3>${p.name || 'Produkt'}</h3>
                <div class='price'>${p.price ?? 'N/A'} zł</div>
                <p class='muted'>ID: ${p.id || 'brak'}</p>
                <form method='POST' action='/checkout'>
                  <input type='hidden' name='productId' value='${p.id || ''}'>
                  <input name='email' type='email' required placeholder='email kupującego'>
                  <button>Kup teraz</button>
                </form>
              </article>`
          )
          .join('')}
      </section>
    </main>
  </body>
  </html>`;
}

app.get('/', requireLicense, async (_req, res) => {
  let products = [];
  let apiError = null;

  try {
    const result = await yshopRequest(YSHOP_PRODUCTS_PATH);
    products = Array.isArray(result) ? result : result.items || result.data || [];
  } catch (err) {
    apiError = err.message;
  }

  res.type('html').send(renderShopPage({ products, apiError }));
});

app.post('/checkout', requireLicense, async (req, res) => {
  const { productId, email } = req.body || {};

  if (!productId || !email) {
    return res.status(400).json({ error: 'Missing productId or email' });
  }

  try {
    const order = await yshopRequest(YSHOP_ORDERS_PATH, {
      method: 'POST',
      body: JSON.stringify({ productId, email })
    });
    return res.json({ ok: true, order });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get('/health', async (_req, res) => {
  const license = await verifyLicense();
  res.json({
    status: 'ok',
    license,
    yshop: {
      base: YSHOP_API_BASE,
      usesApiKey: Boolean(YSHOP_API_KEY),
      usesPublicKey: Boolean(YSHOP_PUBLIC_KEY),
      productsPath: YSHOP_PRODUCTS_PATH,
      ordersPath: YSHOP_ORDERS_PATH
    }
  });
});

app.listen(PORT, () => {
  console.log(`Client shop running on http://localhost:${PORT}`);
});
