import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { createDb } from './db.js';
import { normalizeDomain, signPayload, safeEqual } from './security.js';

dotenv.config();

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

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

app.get('/admin', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>License Admin</title>
<style>body{font-family:Arial;max-width:900px;margin:20px auto;padding:0 12px}input,button{padding:8px;margin:4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}</style>
</head><body>
<h1>License Admin</h1>
<div id="auth"></div><div id="app"></div>
<script>
async function login(e){e.preventDefault();const fd=new FormData(e.target);const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});if(r.ok){render()}else alert('Błąd logowania')}
async function logout(){await fetch('/auth/logout',{method:'POST'});render()}
async function fetchJSON(url,opts){const r=await fetch(url,opts);if(!r.ok)throw new Error(await r.text());return r.json()}
async function render(){
const me=await fetch('/auth/me').then(r=>r.json());
const auth=document.getElementById('auth');
const app=document.getElementById('app');
if(!me.auth){
auth.innerHTML='<form onsubmit="login(event)"><input name="username" placeholder="login" required><input name="password" type="password" placeholder="hasło" required><button>Zaloguj</button></form>';
app.innerHTML='';
return;
}
auth.innerHTML='<button onclick="logout()">Wyloguj</button>';
const data=await fetchJSON('/api/licenses');
const rows=data.items.map(function(l){
return '<tr><td>'+l.key+'</td><td>'+(l.blocked?'BLOCKED':'ACTIVE')+'</td><td>'+l.domains.join(', ')+'</td><td><form class="bind" data-key="'+l.key+'"><input name="domain" placeholder="example.com"><button>Przypnij</button></form><button onclick="toggle(\''+l.key+'\','+l.blocked+')">'+(l.blocked?'Odblokuj':'Zablokuj')+'</button></td></tr>';
}).join('');
app.innerHTML='<h2>Nowa licencja</h2><form id="newLic"><input name="maxDomains" type="number" value="1" min="1"><input name="expiresAt" type="datetime-local"><button>Utwórz</button></form><h2>Licencje</h2><table><tr><th>Key</th><th>Status</th><th>Domeny</th><th>Akcje</th></tr>'+rows+'</table>';
document.getElementById('newLic').onsubmit=async function(ev){ev.preventDefault();const fd=new FormData(ev.target);await fetchJSON('/api/licenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxDomains:Number(fd.get('maxDomains')),expiresAt:fd.get('expiresAt')||null})});render()};
document.querySelectorAll('form.bind').forEach(function(f){f.onsubmit=async function(ev){ev.preventDefault();const fd=new FormData(ev.target);await fetchJSON('/api/licenses/'+f.dataset.key+'/bind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:fd.get('domain')})});render()}});
window.toggle=async function(key,blocked){await fetchJSON('/api/licenses/'+key+'/'+(blocked?'unblock':'block'),{method:'POST'});render()}
}
render();
</script></body></html>`);
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

app.get('/api/licenses', requireAdmin, (req, res) => {
  const data = db.read();
  res.json({ items: data.licenses });
});

app.post('/api/licenses', requireAdmin, (req, res) => {
  const maxDomains = Number(req.body?.maxDomains || 1);
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;

  if (!Number.isFinite(maxDomains) || maxDomains < 1) {
    return res.status(400).json({ error: 'Invalid maxDomains' });
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

  let data;
  try {
    data = db.withData((state) => {
      const lic = state.licenses.find((l) => l.key === key);
      if (!lic) return state;
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
    return res.status(500).json({ error: 'Unexpected error' });
  }

  const lic = data.licenses.find((l) => l.key === key);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  addAudit('license_bound_domain', { key, domain });
  res.json({ item: lic });
});

app.post('/api/licenses/:key/block', requireAdmin, (req, res) => {
  const key = req.params.key;
  const data = db.withData((state) => {
    const lic = state.licenses.find((l) => l.key === key);
    if (lic) lic.blocked = true;
    return state;
  });
  const lic = data.licenses.find((l) => l.key === key);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  addAudit('license_blocked', { key });
  res.json({ item: lic });
});

app.post('/api/licenses/:key/unblock', requireAdmin, (req, res) => {
  const key = req.params.key;
  const data = db.withData((state) => {
    const lic = state.licenses.find((l) => l.key === key);
    if (lic) lic.blocked = false;
    return state;
  });
  const lic = data.licenses.find((l) => l.key === key);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  addAudit('license_unblocked', { key });
  res.json({ item: lic });
});

app.post('/api/licenses/verify', (req, res) => {
  const key = req.body?.key;
  const domain = normalizeDomain(req.body?.domain);
  const now = Date.now();

  if (!key || !domain) {
    return res.status(400).json({ valid: false, reason: 'INVALID_INPUT' });
  }

  const lic = db.read().licenses.find((l) => l.key === key);
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
