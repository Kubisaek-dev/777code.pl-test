const authRoot = document.getElementById('auth-root');
const appRoot = document.getElementById('app-root');

let flash = null;

function showMessage(type, text) {
  flash = { type, text };
  render();
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pl-PL');
}

function statusBadge(license) {
  if (license.blocked) return '<span class="badge blocked">BLOCKED</span>';
  return '<span class="badge ok">ACTIVE</span>';
}

async function login(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await fetchJSON('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd))
    });
    showMessage('success', 'Zalogowano poprawnie.');
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  flash = null;
  await render();
}

async function createLicense(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await fetchJSON('/api/licenses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maxDomains: Number(fd.get('maxDomains')),
        expiresAt: fd.get('expiresAt') || null
      })
    });
    showMessage('success', 'Licencja utworzona.');
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function bindDomain(ev, key) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await fetchJSON(`/api/licenses/${encodeURIComponent(key)}/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: fd.get('domain') })
    });
    showMessage('success', `Domena przypięta do ${key}.`);
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function unbindDomain(key, domain) {
  try {
    await fetchJSON(`/api/licenses/${encodeURIComponent(key)}/unbind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    showMessage('success', `Domena ${domain} odpięta.`);
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function toggleBlock(key, blocked) {
  try {
    await fetchJSON(`/api/licenses/${encodeURIComponent(key)}/${blocked ? 'unblock' : 'block'}`, { method: 'POST' });
    showMessage('success', `Licencja ${blocked ? 'odblokowana' : 'zablokowana'}.`);
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function removeLicense(key) {
  if (!window.confirm(`Na pewno usunąć licencję ${key}?`)) return;
  try {
    await fetchJSON(`/api/licenses/${encodeURIComponent(key)}`, { method: 'DELETE' });
    showMessage('success', 'Licencja usunięta.');
  } catch (err) {
    showMessage('error', err.message);
  }
}

async function render() {
  const me = await fetchJSON('/auth/me');

  authRoot.innerHTML = me.auth
    ? `<button class="secondary" id="logout-btn">Wyloguj</button>`
    : `
      <div class="card">
        <h2>Logowanie administratora</h2>
        <form id="login-form">
          <input name="username" placeholder="Login" required />
          <input name="password" type="password" placeholder="Hasło" required />
          <button>Zaloguj</button>
        </form>
      </div>
    `;

  if (!me.auth) {
    appRoot.innerHTML = '';
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', login);
    return;
  }

  const [licensesData, auditData] = await Promise.all([
    fetchJSON('/api/licenses'),
    fetchJSON('/api/audit')
  ]);

  const notice = flash
    ? `<div class="notice ${flash.type === 'error' ? 'error' : 'success'}">${flash.text}</div>`
    : '';

  const rows = licensesData.items.map((l) => {
    const domains = l.domains.length
      ? l.domains
          .map(
            (d) => `<div class="inline"><input disabled value="${d}" /><button class="secondary" data-action="unbind" data-key="${l.key}" data-domain="${d}">Odepnij</button></div>`
          )
          .join('')
      : '<small>Brak domen</small>';

    return `
      <tr>
        <td><strong>${l.key}</strong><br/><small>Utworzono: ${fmtDate(l.createdAt)}</small></td>
        <td>${statusBadge(l)}</td>
        <td>
          ${domains}
          <form data-action="bind" data-key="${l.key}">
            <div class="inline">
              <input name="domain" placeholder="example.com" required />
              <button class="secondary">Przypnij</button>
            </div>
          </form>
        </td>
        <td>
          maxDomains: <strong>${l.maxDomains}</strong><br/>
          wygasa: <strong>${fmtDate(l.expiresAt)}</strong>
        </td>
        <td>
          <button class="${l.blocked ? 'ok' : 'warn'}" data-action="toggle" data-key="${l.key}" data-blocked="${l.blocked}">${l.blocked ? 'Odblokuj' : 'Zablokuj'}</button>
          <button class="danger" data-action="delete" data-key="${l.key}">Usuń</button>
        </td>
      </tr>
    `;
  }).join('');

  const auditRows = auditData.items
    .slice(0, 12)
    .map((a) => `<tr><td>${fmtDate(a.at)}</td><td>${a.action}</td><td><small>${JSON.stringify(a.details)}</small></td></tr>`)
    .join('');

  appRoot.innerHTML = `
    ${notice}
    <div class="grid">
      <section class="card">
        <h2>Nowa licencja</h2>
        <form id="create-license-form">
          <label class="muted">Limit domen</label>
          <input name="maxDomains" type="number" min="1" value="1" required />
          <label class="muted">Data wygaśnięcia (opcjonalnie)</label>
          <input name="expiresAt" type="datetime-local" />
          <button>Utwórz licencję</button>
        </form>
      </section>
      <section class="card">
        <h2>Info</h2>
        <p class="muted">Panel jest gotowy do tworzenia, przypisywania, blokowania, odpinania i usuwania licencji.</p>
        <p class="muted">Endpoint walidacji: <code>POST /api/licenses/verify</code></p>
      </section>
    </div>

    <section class="card">
      <h2>Licencje</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Klucz</th><th>Status</th><th>Domeny</th><th>Parametry</th><th>Akcje</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5">Brak licencji</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Ostatnie akcje (audit)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Czas</th><th>Akcja</th><th>Szczegóły</th></tr></thead>
          <tbody>${auditRows || '<tr><td colspan="3">Brak wpisów</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;

  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('create-license-form')?.addEventListener('submit', createLicense);

  appRoot.querySelectorAll('[data-action="bind"]').forEach((form) => {
    form.addEventListener('submit', (ev) => bindDomain(ev, form.dataset.key));
  });
  appRoot.querySelectorAll('[data-action="unbind"]').forEach((btn) => {
    btn.addEventListener('click', () => unbindDomain(btn.dataset.key, btn.dataset.domain));
  });
  appRoot.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleBlock(btn.dataset.key, btn.dataset.blocked === 'true'));
  });
  appRoot.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => removeLicense(btn.dataset.key));
  });
}

render().catch((err) => {
  appRoot.innerHTML = `<div class="notice error">Błąd panelu: ${err.message}</div>`;
});
