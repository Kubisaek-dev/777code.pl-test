const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = Number(process.env.PORT || 3000);

const defaultServerSlug = process.env.YSHOP_SHOP_SLUG || 'glowny-serwer';

const fallbackProducts = [
  {
    id: '1',
    name: 'SVIP',
    price: 49.99,
    currency: 'PLN',
    description: 'Ranga premium na 30 dni.'
  },
  {
    id: '2',
    name: 'VIP+',
    price: 19.99,
    currency: 'PLN',
    description: 'Ranga premium na 7 dni.'
  }
];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function fetchYShopProducts(serverSlug) {
  const apiBase = process.env.YSHOP_API_BASE || 'https://api.yshop.pl';
  const publicKey = process.env.YSHOP_PUBLIC_KEY || process.env.PUBLIC_API_KEY;
  const privateKey = process.env.YSHOP_PRIVATE_KEY || process.env.PRIVATE_API_KEY;

  if (!publicKey || !privateKey) {
    return { source: 'fallback', products: fallbackProducts };
  }

  const url = `${apiBase.replace(/\/$/, '')}/v1/shops/${encodeURIComponent(serverSlug)}/products`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-api-public-key': publicKey,
        'x-api-private-key': privateKey,
        'x-platform': process.env.YSHOP_PLATFORM || 'platform/web',
        'x-platform-version': process.env.YSHOP_PLATFORM_VERSION || '1.0.0',
        'x-platform-engine': process.env.YSHOP_PLATFORM_ENGINE || 'client-shop'
      }
    });

    if (!response.ok) {
      return { source: 'fallback', products: fallbackProducts };
    }

    const payload = await response.json();
    const fromApi = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload) ? payload : [];

    const normalized = fromApi
      .map((item) => ({
        id: String(item.id || item.uuid || ''),
        name: String(item.name || item.title || 'Produkt'),
        price: Number(item.price ?? item.amount ?? NaN),
        currency: String(item.currency || 'PLN'),
        description: String(item.description || item.shortDescription || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((item) => item.name);

    return {
      source: 'api',
      products: normalized.length ? normalized : fallbackProducts
    };
  } catch (_err) {
    return { source: 'fallback', products: fallbackProducts };
  }
}

app.get('/api/servers', (_req, res) => {
  res.json({
    servers: [
      {
        slug: defaultServerSlug,
        name: defaultServerSlug
      }
    ]
  });
});

app.get('/api/servers/:slug/products', async (req, res) => {
  const { slug } = req.params;
  const result = await fetchYShopProducts(slug);

  res.json({
    server: slug,
    source: result.source,
    products: result.products
  });
});

app.get('/:slug', (req, res, next) => {
  const maybeFile = req.params.slug.includes('.');
  if (maybeFile) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'server.html'));
});

app.listen(port, () => {
  console.log(`Client shop działa na porcie ${port}`);
});
