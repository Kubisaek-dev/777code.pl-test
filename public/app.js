const serversContainer = document.querySelector('#servers');
const productsContainer = document.querySelector('#products');
const productsTitle = document.querySelector('#products-title');

function parseMaybeBase64(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  if (!base64Pattern.test(trimmed) || trimmed.length % 4 !== 0) {
    return trimmed;
  }

  try {
    const decoded = atob(trimmed);
    const readable = /^[\x20-\x7E\n\r\tąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*$/u.test(decoded);
    return readable ? decoded : trimmed;
  } catch {
    return trimmed;
  }
}

function renderServers(servers, currentSlug) {
  serversContainer.innerHTML = '';

  servers.forEach((server) => {
    const link = document.createElement('a');
    link.className = 'server-link';
    link.href = `/${server.slug}`;
    link.textContent = currentSlug === server.slug ? `${server.name} (aktywny)` : server.name;
    serversContainer.appendChild(link);
  });
}

function formatPrice(price) {
  if (typeof price !== 'number') {
    return 'Niedostępne';
  }

  return `${price.toFixed(2)} PLN`;
}

function renderProducts(serverName, products) {
  productsTitle.textContent = `Produkty • ${serverName}`;
  productsContainer.innerHTML = '';

  if (!products.length) {
    productsContainer.innerHTML = '<p class="muted">Brak produktów dla tego serwera.</p>';
    return;
  }

  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';

    const name = document.createElement('h3');
    name.className = 'product-name';
    name.textContent = product.name;

    const price = document.createElement('p');
    price.className = 'product-price';
    price.textContent = formatPrice(product.price);

    const id = document.createElement('p');
    id.className = 'product-meta';
    id.textContent = `ID: ${product.id}`;

    const description = document.createElement('p');
    description.className = 'product-meta';
    description.textContent = parseMaybeBase64(product.description);

    card.append(name, price, id, description);
    productsContainer.appendChild(card);
  });
}

async function initialize() {
  const currentSlug = window.location.pathname === '/' ? null : window.location.pathname.slice(1);

  const serversResponse = await fetch('/api/servers');
  const servers = await serversResponse.json();

  renderServers(servers, currentSlug);

  if (!currentSlug) {
    productsTitle.textContent = 'Produkty';
    productsContainer.innerHTML = '<p class="muted">Wybierz serwer, aby zobaczyć produkty.</p>';
    return;
  }

  const productsResponse = await fetch(`/api/servers/${currentSlug}/products`);

  if (!productsResponse.ok) {
    productsContainer.innerHTML = '<p class="muted">Nie udało się pobrać produktów.</p>';
    return;
  }

  const payload = await productsResponse.json();
  renderProducts(payload.server.name, payload.products);
}

initialize();
