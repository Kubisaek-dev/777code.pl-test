import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { createDb } from './db.js';
import { normalizeDomain, signPayload, safeEqual } from './security.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4000);
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const LICENSE_SIGNING_SECRET = process.env.LICENSE_SIGNING_SECRET || 'change-me';
const DATA_FILE = process.env.DATA_FILE || './data/licenses.json';

app.set('trust proxy', TRUST_PROXY);
const db = createDb(DATA_FILE);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:']
      }
    }
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/assets', express.static(path.join(__dirname, '../public')));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 });
app.use('/api', apiLimiter);

function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function addAudit(action, details = {}) {
  db.withData((data) => {
    data.audit.push({ at: new Date().toISOString(), action, details });
    if (data.audit.length > 1000) data.audit = data.audit.slice(-1000);
    return data;
  });
}

function getLicenseByKey(data, key) {
  return data.licenses.find((l) => l.key === key);
}

app.get('/admin', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YShop License Admin</title>
    <link rel="stylesheet" href="/assets/admin.css" />
  </head>
  <body>
    <main class="container">
      <header class="header">
        <h1>YShop License Admin</h1>
      </header>
      <section id="auth-root"></section>
      <section id="app-root"></section>
    </main>
    <script src="/assets/admin.js"></script>
  </body>
</html>`);
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !safeEqual(username, ADMIN_USER)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  let ok = false;
  if (ADMIN_PASSWORD_HASH) {
    ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  } else {
    ok = safeEqual(password, ADMIN_PASSWORD);
  }

  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.admin = true;
  addAudit('login_success', { username });
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/auth/me', (req, res) => {
  res.json({ auth: Boolean(req.session?.admin) });
});

app.get('/api/licenses', requireAdmin, (_req, res) => {
  const data = db.read();
  const items = [...data.licenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ items });
});

app.get('/api/audit', requireAdmin, (_req, res) => {
  const data = db.read();
  const items = [...data.audit].sort((a, b) => b.at.localeCompare(a.at));
  res.json({ items });
});

app.post('/api/licenses', requireAdmin, (req, res) => {
  const maxDomains = Number(req.body?.maxDomains || 1);
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;

  if (!Number.isFinite(maxDomains) || maxDomains < 1) {
    return res.status(400).json({ error: 'Invalid maxDomains' });
  }

  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    return res.status(400).json({ error: 'Invalid expiresAt' });
  }

  const key = `LIC-${nanoid(18)}`;
  const license = {
    key,
    blocked: false,
    domains: [],
    maxDomains,
    createdAt: new Date().toISOString(),
    expiresAt
  };

  db.withData((data) => {
    data.licenses.push(license);
    return data;
  });

  addAudit('license_created', { key, maxDomains, expiresAt });
  res.status(201).json({ item: license });
});

app.post('/api/licenses/:key/bind', requireAdmin, (req, res) => {
  const key = req.params.key;
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });

  let output;
  try {
    output = db.withData((state) => {
      const lic = getLicenseByKey(state, key);
      if (!lic) throw new Error('LICENSE_NOT_FOUND');

      if (!lic.domains.includes(domain)) {
        if (lic.domains.length >= lic.maxDomains) {
          throw new Error('DOMAIN_LIMIT');
        }
        lic.domains.push(domain);
      }

      return state;
    });
  } catch (err) {
    if (err.message === 'DOMAIN_LIMIT') {
      return res.status(400).json({ error: 'Domain limit reached for this license' });
    }
    if (err.message === 'LICENSE_NOT_FOUND') {
      return res.status(404).json({ error: 'License not found' });
    }
    return res.status(500).json({ error: 'Unexpected error' });
  }

  const lic = getLicenseByKey(output, key);
  addAudit('license_bound_domain', { key, domain });
  res.json({ item: lic });
});

app.post('/api/licenses/:key/unbind', requireAdmin, (req, res) => {
  const key = req.params.key;
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });

  const data = db.withData((state) => {
    const lic = getLicenseByKey(state, key);
    if (!lic) return state;
    lic.domains = lic.domains.filter((d) => d !== domain);
    return state;
  });

  const lic = getLicenseByKey(data, key);
  if (!lic) return res.status(404).json({ error: 'License not found' });

  addAudit('license_unbound_domain', { key, domain });
  res.json({ item: lic });
});

app.post('/api/licenses/:key/block', requireAdmin, (req, res) => {
  const key = req.params.key;
  const data = db.withData((state) => {
    const lic = getLicenseByKey(state, key);
    if (lic) lic.blocked = true;
    return state;
  });

  const lic = getLicenseByKey(data, key);
  if (!lic) return res.status(404).json({ error: 'License not found' });

  addAudit('license_blocked', { key });
  res.json({ item: lic });
});

app.post('/api/licenses/:key/unblock', requireAdmin, (req, res) => {
  const key = req.params.key;
  const data = db.withData((state) => {
    const lic = getLicenseByKey(state, key);
    if (lic) lic.blocked = false;
    return state;
  });

  const lic = getLicenseByKey(data, key);
  if (!lic) return res.status(404).json({ error: 'License not found' });

  addAudit('license_unblocked', { key });
  res.json({ item: lic });
});

app.delete('/api/licenses/:key', requireAdmin, (req, res) => {
  const key = req.params.key;
  let removed = false;

  db.withData((state) => {
    const before = state.licenses.length;
    state.licenses = state.licenses.filter((l) => l.key !== key);
    removed = state.licenses.length !== before;
    return state;
  });

  if (!removed) return res.status(404).json({ error: 'License not found' });

  addAudit('license_deleted', { key });
  res.json({ ok: true });
});

app.post('/api/licenses/verify', (req, res) => {
  const key = req.body?.key;
  const domain = normalizeDomain(req.body?.domain);
  const now = Date.now();

  if (!key || !domain) {
    return res.status(400).json({ valid: false, reason: 'INVALID_INPUT' });
  }

  const lic = getLicenseByKey(db.read(), key);
  let valid = true;
  let reason = 'OK';

  if (!lic) {
    valid = false;
    reason = 'NOT_FOUND';
  } else if (lic.blocked) {
    valid = false;
    reason = 'BLOCKED';
  } else if (lic.expiresAt && new Date(lic.expiresAt).getTime() < now) {
    valid = false;
    reason = 'EXPIRED';
  } else if (!lic.domains.includes(domain)) {
    valid = false;
    reason = 'DOMAIN_NOT_BOUND';
  }

  const payload = { valid, reason, key, domain, at: new Date().toISOString() };
  const signature = signPayload(payload, LICENSE_SIGNING_SECRET);
  res.setHeader('X-License-Signature', signature);
  res.json(payload);
});

app.listen(PORT, () => {
  console.log(`License server running on http://localhost:${PORT}`);
});
