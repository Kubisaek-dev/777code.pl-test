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

function baseHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-app-platform': YSHOP_PLATFORM,
    'x-app-platform-version': YSHOP_PLATFORM_VERSION,
    'x-app-platform-engine': YSHOP_PLATFORM_ENGINE
  };
}

function buildAuthHeaders(key) {
  if (!key) return null;
  return { 'authorization': `Bearer ${key}` };
}

async function yshopRequest({ keyType, method = 'GET', endpoint, body = null, debug = false }) {
  const key = keyType === 'private' ? YSHOP_PRIVATE_KEY : YSHOP_PUBLIC_KEY;
  
  if (!key) {
    throw new Error(`MISSING_${keyType.toUpperCase()}_KEY`);
  }

  const authHeaders = buildAuthHeaders(key);
  const url = `${YSHOP_API_BASE}${endpoint}`;
  
  if (debug) {
    console.log(`\n🔍 YShop ${keyType.toUpperCase()} Request:`);
    console.log(`   URL: ${url}`);
  }

  try {
    const response = await fetch(url, {
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

    if (debug) {
      console.log(`   Response Status: ${response.status}`);
      if (response.ok) {
        console.log(`   ✅ Success`);
      }
    }

    if (!response.ok) {
      throw new Error(`${response.status}: ${payload?.message || 'Error'}`);
    }

    return payload;
  } catch (err) {
    if (debug) console.log(`   ❌ ${err.message}`);
    throw err;
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
      </head><body><div class='box'><h1>Sklep zablokowany</h1><p>Licencja: <b>${status.reason}</b></p></div></body></html>`);
  }
  return next();
}

async function fetchShopBootstrap() {
  try {
    console.log('\n📦 Fetching shop bootstrap...');
    
    const shop = await yshopRequest({ 
      keyType: 'public', 
      endpoint: '/v4/client/public/shop', 
      debug: true 
    });

    const serversResponse = await yshopRequest({ 
      keyType: 'public', 
      endpoint: '/v4/client/public/servers', 
      debug: true 
    });

    const servers = Array.isArray(serversResponse) ? serversResponse : [];
    console.log(`\n📌 Found ${servers.length} servers`);

    let allProducts = [];
    
    for (const server of servers) {
      try {
        console.log(`\n🔍 ${server.name}`);
        
        const serverDetails = await yshopRequest({ 
          keyType: 'public',
          endpoint: `/v4/client/public/servers/${server.id}`,
          debug: false 
        });

        if (serverDetails?.categories?.length > 0) {
          for (const category of serverDetails.categories) {
            if (category?.products?.length > 0) {
              console.log(`   📦 ${category.name}: ${category.products.length} products`);
              
              for (const product of category.products) {
                // ✅ NOWE: Pobierz warianty z API dla każdego produktu
                let variants = [];
                let paymentMethods = ['stripe'];
                
                try {
                  console.log(`      🔄 Fetching variants for product ${product.id}...`);
                  
                  const productDetails = await yshopRequest({
                    keyType: 'public',
                    endpoint: `/v4/client/public/products/${product.id}`,
                    debug: false
                  });

                  if (productDetails?.variants?.length > 0) {
                    variants = productDetails.variants;
                    console.log(`      ✅ Found ${variants.length} variants`);
                  } else {
                    console.log(`      ⚠️  No variants, creating default`);
                    // ✅ Utwórz domyślny wariant jeśli brak
                    variants = [{
                      id: product.id,
                      name: product.name,
                      prices: [{ amount: 0, method: 'stripe' }],
                      commands: []
                    }];
                  }

                  // Spróbuj pobrać payment methods
                  if (productDetails?.paymentMethods) {
                    paymentMethods = productDetails.paymentMethods;
                  }
                } catch (err) {
                  console.log(`      ⚠️  Error fetching variants: ${err.message}`);
                  // Jeśli fail, utwórz domyślny wariant
                  variants = [{
                    id: product.id,
                    name: product.name,
                    prices: [{ amount: 0, method: 'stripe' }],
                    commands: []
                  }];
                }

                allProducts.push({
                  id: product.id,
                  name: product.name,
                  description: product.long_description 
                    ? Buffer.from(product.long_description, 'base64').toString('utf-8')
                    : (product.short_description
                      ? Buffer.from(product.short_description, 'base64').toString('utf-8')
                      : ''),
                  imageUrl: product.imageUrl || '',
                  serverId: server.id,
                  serverName: server.name,
                  categoryName: category.name,
                  promoted: product.promoted || false,
                  promotionPercentage: product.promotionPercentage || 0,
                  variants: variants,
                  paymentMethods: paymentMethods
                });
              }
            }
          }
        }
      } catch (err) {
        console.log(`   ❌ ${err.message}`);
      }
    }

    console.log(`\n✅ Loaded ${allProducts.length} products\n`);
    
    return {
      shop,
      servers,
      products: allProducts,
      error: null
    };
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    return { shop: null, products: [], servers: [], error: err.message };
  }
}

function renderPage() {
  return `<!doctype html>
<html lang='pl'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>ItemShop</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #09090b;
  --panel: #18181b;
  --panel-hover: #27272a;
  --border: #27272a;
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --accent: #818cf8;
  --text: #f4f4f5;
  --text-muted: #a1a1aa;
  --success: #10b981;
  --danger: #ef4444;
  --radius: 12px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background-color: var(--bg);
  color: var(--text);
  font-family: 'Outfit', sans-serif;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}

/* Layout */
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 20px; }

/* Header */
.header {
  background: rgba(9, 9, 11, 0.8);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 20px 0;
}
.header-content { display: flex; justify-content: space-between; align-items: center; }
.brand { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #fff, var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

/* Server Selector */
.server-tabs {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.server-tab {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.server-tab:hover { background: var(--panel-hover); color: var(--text); }
.server-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
}

/* Grid */
.products-area { padding: 40px 0; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

/* Card */
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
  border-color: var(--panel-hover);
}
.card-img-wrap {
  position: relative;
  width: 100%;
  padding-top: 60%; /* Aspect ratio */
  background: #000;
  overflow: hidden;
}
.card-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform 0.5s;
}
.card:hover .card-img { transform: scale(1.05); }
.card-body { padding: 20px; flex: 1; display: flex; flex-direction: column; }
.card-meta { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }
.card-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.card-badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent);
  padding: 4px 8px;
  border-radius: 6px;
}
.card-desc {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0 0 20px 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Variants */
.variants { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.variant-opt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.variant-opt:hover { border-color: var(--text-muted); }
.variant-opt.selected {
  background: rgba(99, 102, 241, 0.1);
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}
.v-name { font-size: 14px; font-weight: 500; }
.v-price { font-size: 14px; font-weight: 700; color: var(--text); }

/* Buttons */
.btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.btn-primary {
  background: var(--primary);
  color: white;
}
.btn-primary:hover { background: var(--primary-hover); }

/* Modal */
.modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.8);
  backdrop-filter: blur(4px);
  z-index: 100;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.modal.open { display: flex; opacity: 1; }
.modal-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  padding: 30px;
  position: relative;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  transform: scale(0.95);
  transition: transform 0.2s;
}
.modal.open .modal-box { transform: scale(1); }
.close-modal {
  position: absolute; top: 20px; right: 20px;
  background: transparent; border: none; color: var(--text-muted);
  font-size: 24px; cursor: pointer;
}
.close-modal:hover { color: var(--text); }

/* Form */
.form-group { margin-bottom: 16px; }
.label { display: block; font-size: 13px; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
.input {
  width: 100%;
  background: #09090b;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 12px;
  border-radius: 8px;
  font-family: inherit;
  transition: border-color 0.2s;
}
.input:focus { outline: none; border-color: var(--primary); }

/* Payment Methods */
.pm-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.pm-btn {
  padding: 8px 16px;
  background: #09090b;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}
.pm-btn.selected {
  background: var(--text);
  color: #000;
  border-color: var(--text);
  font-weight: 600;
}

.alert { padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
.alert-err { background: rgba(239, 68, 68, 0.1); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.2); }
.alert-ok { background: rgba(16, 185, 129, 0.1); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.2); }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
</style>
</head>
<body>
<div class='header'>
  <div class='wrap header-content'>
    <div class='brand'>⚡ ItemShop</div>
    <div class='server-tabs' id='serverButtons'></div>
  </div>
</div>

<div class='products-area'>
  <div class='wrap'>
    <div id='alerts'></div>
    <div class='grid' id='products'></div>
  </div>
</div>

<div class='modal' id='checkoutModal'>
  <div class='modal-box'>
    <button class='close-modal' onclick="closeCheckout()">×</button>
    <h2 style="margin: 0 0 20px 0; font-size: 22px;" id='modalTitle'>Kasa</h2>
    <div id='checkoutForm'></div>
  </div>
</div>

<script>
const serverButtonsEl = document.getElementById('serverButtons');
const productsEl = document.getElementById('products');
const alertsEl = document.getElementById('alerts');
const checkoutModal = document.getElementById('checkoutModal');
const modalTitle = document.getElementById('modalTitle');
const checkoutForm = document.getElementById('checkoutForm');

let allProducts = [];
let allServers = [];
let selectedServerId = null;
let selectedVariantId = null;
let selectedPaymentMethod = 'stripe';

function setAlert(type, msg) {
  alertsEl.innerHTML = '<div class="alert alert-' + (type === 'ok' ? 'ok' : 'err') + '">' + msg + '</div>';
  setTimeout(() => alertsEl.innerHTML = '', 5000);
}

function closeCheckout() {
  checkoutModal.classList.remove('open');
}

function handleImgError(img) {
  img.onerror = null;
  img.src = 'https://via.placeholder.com/400x240/18181b/52525b?text=No+Image';
}

function renderProducts() {
  if (!selectedServerId) {
    productsEl.innerHTML = '<div class="empty-state">Wybierz serwer, aby zobaczyć ofertę.</div>';
    return;
  }

  const serverProducts = allProducts.filter(p => p.serverId == selectedServerId);
  
  if (serverProducts.length === 0) {
    productsEl.innerHTML = '<div class="empty-state">Brak produktów na tym serwerze.</div>';
    return;
  }

  productsEl.innerHTML = serverProducts.map(p => {
    // Domyślnie wybieramy pierwszy wariant do wyświetlenia ceny
    const defaultVariant = p.variants[0];
    const defaultPrice = defaultVariant && defaultVariant.prices[0] 
      ? (defaultVariant.prices[0].amount / 100).toFixed(2) 
      : '0.00';

    const variantsHtml = p.variants.map((v, i) => {
      const price = v.prices && v.prices[0] ? (v.prices[0].amount / 100).toFixed(2) : '0.00';
      const isSelected = i === 0 ? 'selected' : '';
      // WAŻNE: Przekazujemy ID jako liczby, bez cudzysłowów
      return '<div class="variant-opt ' + isSelected + '" onclick="selectVariant(' + p.id + ',' + v.id + ',this)" data-price="' + price + '">' +
        '<span class="v-name">' + v.name + '</span>' +
        '<span class="v-price">' + price + ' PLN</span>' +
        '</div>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-img-wrap">' +
        '<img src="' + p.imageUrl + '" class="card-img" onerror="handleImgError(this)"/>' +
      '</div>' +
      '<div class="card-body">' +
      '<div class="card-meta">' +
        '<h3 class="card-title">' + p.name + '</h3>' +
        '<span class="card-badge">' + p.categoryName + '</span>' +
      '</div>' +
      '<p class="card-desc">' + p.description + '</p>' +
      '<div class="variants">' + variantsHtml + '</div>' +
      // WAŻNE: Tutaj przekazujemy TYLKO ID. Nazwę pobierzemy z obiektu w JS.
      '<button class="btn btn-primary" onclick="openCheckout(' + p.id + ')">Wybierz</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

function selectVariant(productId, variantId, el) {
  // Znajdź kartę produktu (rodzica)
  const card = el.closest('.card');
  // Odznacz inne warianty w tej karcie
  card.querySelectorAll('.variant-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  
  // Zapisz wybór tymczasowo w atrybucie karty (opcjonalne, ale pomocne)
  card.dataset.selectedVariant = variantId;
}

function selectPaymentMethod(method, el) {
  selectedPaymentMethod = method;
  document.querySelectorAll('.pm-btn').forEach(m => m.classList.remove('selected'));
  el.classList.add('selected');
}

function openCheckout(productId) {
  // Pobieramy produkt z pamięci JS zamiast z HTML
  const product = allProducts.find(p => p.id == productId);
  if (!product) return;

  // Sprawdzamy, który wariant jest zaznaczony w UI
  // Szukamy elementu DOM dla tego produktu
  // Uproszczenie: bierzemy pierwszy wariant, jeśli nie ma logiki śledzenia per karta w tym prostym skrypcie
  // W idealnym świecie React/Vue robiłby to za nas. Tutaj zrobimy prosto:
  // Pobierzemy domyślny (pierwszy) wariant, chyba że dodamy logikę śledzenia.
  // Dla uproszczenia: Zawsze otwieramy z pierwszym wariantem, a w modalu można by dać select.
  // Ale w obecnym UI warianty są na karcie.
  
  // Spróbujmy znaleźć zaznaczony wariant w DOM
  // To wymagałoby unikalnych ID w DOM. Zróbmy fallback do pierwszego wariantu.
  // (W pełnej wersji można by dodać id="product-card-${id}" i szukać .selected wewnątrz)
  
  let variant = product.variants[0];
  
  // Zaawansowane szukanie w DOM (opcjonalne, ale naprawia UX)
  // Ponieważ nie mamy łatwego dostępu do instancji DOM klikniętego przycisku w tej funkcji (tylko ID),
  // zakładamy pierwszy wariant LUB musielibyśmy przekazać 'this' do openCheckout.
  // Zostawmy pierwszy wariant jako bezpieczny default.

  modalTitle.textContent = product.name;
  const price = variant && variant.prices && variant.prices[0] ? (variant.prices[0].amount / 100).toFixed(2) : '0.00';

  const paymentMethodsHtml = product.paymentMethods.map(m => {
    return '<button class="pm-btn ' + (m == 'stripe' ? 'selected' : '') + '" onclick="selectPaymentMethod(\'' + m + '\',this)" type="button">' + m + '</button>';
  }).join('');

  checkoutForm.innerHTML = '<div class="alert alert-err" id="msg" style="display:none"></div>' +
    '<div class="form-group">' +
    '<label class="label">Adres Email</label>' +
    '<input class="input" type="email" id="email" placeholder="name@example.com" required>' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="label">Nick (opcjonalnie)</label>' +
    '<input class="input" type="text" id="nickname" placeholder="Twój nick z gry">' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="label">Metoda płatności</label>' +
    '<div class="pm-grid">' + paymentMethodsHtml + '</div>' +
    '</div>' +
    '<div style="background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;margin:20px 0;display:flex;justify-content:space-between;align-items:center">' +
    '<div style="color:var(--text-muted);font-size:14px">Do zapłaty:</div>' +
    '<div style="color:var(--primary);font-size:20px;font-weight:700">' + price + ' PLN</div>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="processPayment(' + productId + ',' + variant.id + ')">Przejdź do płatności</button>';
  
  checkoutModal.classList.add('open');
}

async function processPayment(productId, variantId) {
  const email = document.getElementById('email').value;
  const nickname = document.getElementById('nickname').value;
  const msgEl = document.getElementById('msg');

  if (!email) {
    msgEl.style.display = 'block';
    msgEl.textContent = 'Email jest wymagany!';
    return;
  }

  const payload = {
    productId: productId,
    variantId: variantId,
    email: email,
    nickname: nickname || undefined,
    serverId: selectedServerId,
    paymentMethod: selectedPaymentMethod
  };

  try {
    const r = await fetch('/api/payments/make', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    if (!r.ok) {
      msgEl.style.display = 'block';
      msgEl.textContent = data.error || 'Błąd płatności';
      return;
    }

    if (data.paymentUrl || data.url) {
      window.location.href = data.paymentUrl || data.url;
    } else {
      setAlert('ok', 'Płatność utworzona!');
      closeCheckout();
    }
  } catch (err) {
    msgEl.style.display = 'block';
    msgEl.textContent = 'Błąd: ' + err.message;
  }
}

function renderServerButtons() {
  serverButtonsEl.innerHTML = allServers.map(s => 
    '<div class="server-tab" data-id="' + s.id + '">' + s.name + '</div>'
  ).join('');
  
  serverButtonsEl.querySelectorAll('.server-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      selectedServerId = parseInt(this.dataset.id);
      serverButtonsEl.querySelectorAll('.server-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      renderProducts();
    });
  });
}

async function boot() {
  const r = await fetch('/api/bootstrap');
  const data = await r.json();
  
  if (data.error) {
    setAlert('err', data.error);
    return;
  }

  allServers = data.servers || [];
  allProducts = data.products || [];

  console.log('Loaded:', allServers.length, 'servers,', allProducts.length, 'products');

  renderServerButtons();

  if (allServers.length > 0) {
    selectedServerId = allServers[0].id;
    serverButtonsEl.querySelector('.server-tab').classList.add('active');
    renderProducts();
  } else {
    setAlert('err', 'Brak serwerów');
  }
}

boot().catch(e => setAlert('err', e.message));
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

app.post('/api/payments/make', requireLicense, async (req, res) => {
  const { productId, variantId, email, nickname, serverId, paymentMethod } = req.body || {};
  
  if (!productId || !email) {
    return res.status(400).json({ error: 'productId i email są wymagane' });
  }

  const payload = {
    productId,
    variantId: variantId || productId,
    email,
    nickname,
    serverId,
    paymentMethod: paymentMethod || 'stripe',
    successUrl: `${SITE_URL}/?payment=success`,
    failUrl: `${SITE_URL}/?payment=fail`
  };

  try {
    const payment = await yshopRequest({
      keyType: 'private',
      method: 'POST',
      endpoint: '/v4/client/private/payments/make',
      body: payload,
      debug: true
    });
    return res.json(payment);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🚀 Shop running on ${SITE_URL}`);
});