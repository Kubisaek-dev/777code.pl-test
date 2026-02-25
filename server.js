const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = process.env.PORT || 3000;

const store = {
  servers: [
    { slug: 'yshop', name: 'YShop' },
    { slug: 'survival', name: 'Survival' },
    { slug: 'skyblock', name: 'SkyBlock' }
  ],
  productsByServer: {
    yshop: [
      { id: 3797, name: 'SVIP', price: null, description: 'dGVzdA==' },
      { id: 3802, name: 'VIP+', price: 34.99, description: 'Pakiet premium z dodatkami.' }
    ],
    survival: [{ id: 101, name: 'Klucz Epic', price: 19.99, description: 'Klucz do skrzyni Epic.' }],
    skyblock: [{ id: 201, name: 'Ranga Hero', price: 49, description: 'Ranga z dodatkowymi perkami.' }]
  }
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, statusCode, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
      return;
    }

    const extension = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8'
    };

    res.writeHead(statusCode, { 'Content-Type': mimeTypes[extension] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
}

const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/servers') {
    return sendJson(res, 200, store.servers);
  }

  if (pathname.startsWith('/api/servers/') && pathname.endsWith('/products')) {
    const slug = pathname.replace('/api/servers/', '').replace('/products', '').replace(/^\/+|\/+$/g, '');
    const serverEntry = store.servers.find((entry) => entry.slug === slug);

    if (!serverEntry) {
      return sendJson(res, 404, { error: `Server ${slug} not found` });
    }

    return sendJson(res, 200, { server: serverEntry, products: store.productsByServer[slug] || [] });
  }

  if (pathname.startsWith('/static/')) {
    const filePath = path.join(publicDir, pathname.replace('/static/', ''));

    if (!filePath.startsWith(publicDir)) {
      return sendFile(res, 404, path.join(publicDir, '404.html'));
    }

    return sendFile(res, 200, filePath);
  }

  if (pathname === '/') {
    return sendFile(res, 200, path.join(publicDir, 'index.html'));
  }

  const slug = pathname.replace(/^\//, '');
  const serverExists = store.servers.some((entry) => entry.slug === slug);

  if (serverExists) {
    return sendFile(res, 200, path.join(publicDir, 'index.html'));
  }

  return sendFile(res, 404, path.join(publicDir, '404.html'));
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});
