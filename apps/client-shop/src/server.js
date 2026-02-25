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

const siteDomain = new URL(SITE_URL).hostname;

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

let cachedLicense = { valid: false, checkedAt: 0, reason: 'UNVERIFIED' };

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

async function requireLicense(req, res, next) {
  const status = await verifyLicense();
  if (!status.valid) {
    return res.status(403).type('html').send(`<!doctype html><meta charset='utf-8'>
      <h1>Sklep jest niedostępny</h1>
      <p>Licencja niepoprawna: ${status.reason}</p>`);
  }
  next();
}

async function yshopRequest(path, options = {}) {
  const response = await fetch(`${YSHOP_API_BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${YSHOP_API_KEY}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`YShop error ${response.status}: ${txt}`);
  }

  return response.json();
}

app.get('/', requireLicense, async (req, res) => {
  let products = [];
  let apiError = null;

  try {
    const result = await yshopRequest('/products');
    products = Array.isArray(result) ? result : result.items || [];
  } catch (err) {
    apiError = err.message;
  }

  res.type('html').send(`<!doctype html>
  <html lang='pl'><head><meta charset='utf-8'><title>ItemShop</title>
  <style>body{font-family:Arial;max-width:900px;margin:20px auto;padding:0 12px}.card{border:1px solid #ddd;padding:10px;margin:10px 0}</style>
  </head><body>
  <h1>ItemShop</h1>
  <p>Domena licencji: <b>${siteDomain}</b></p>
  ${apiError ? `<p style='color:red'>Błąd API YShop: ${apiError}</p>` : ''}
  ${products.map(p => `<div class='card'><h3>${p.name || 'Produkt'}</h3><p>Cena: ${p.price ?? 'N/A'}</p><form method='POST' action='/checkout'><input type='hidden' name='productId' value='${p.id || ''}'><input name='email' type='email' required placeholder='email'><button>Kup teraz</button></form></div>`).join('')}
  </body></html>`);
});

app.post('/checkout', requireLicense, async (req, res) => {
  const { productId, email } = req.body || {};

  if (!productId || !email) {
    return res.status(400).json({ error: 'Missing productId or email' });
  }

  try {
    const order = await yshopRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({ productId, email })
    });
    res.json({ ok: true, order });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/health', async (req, res) => {
  const license = await verifyLicense();
  res.json({ status: 'ok', license });
});

app.listen(PORT, () => {
  console.log(`Client shop running on http://localhost:${PORT}`);
});
