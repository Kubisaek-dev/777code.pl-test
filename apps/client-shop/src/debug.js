const YSHOP_PUBLIC_KEY = 'publ_59APPMHUK07SY7QHX7DYXVCF7I4ZD8P7';

async function debugProduct2052() {
  const response = await fetch('https://api.yshop.pl/v4/client/public/shop', {
    headers: {
      'authorization': `Bearer ${YSHOP_PUBLIC_KEY}`,
      'accept': 'application/json'
    }
  });

  const shop = await response.json();
  console.log('Current Shop ID:', shop.id);
  
  // Teraz pobierz serwery tego sklepu
  const serversRes = await fetch('https://api.yshop.pl/v4/client/public/servers', {
    headers: {
      'authorization': `Bearer ${YSHOP_PUBLIC_KEY}`,
      'accept': 'application/json'
    }
  });

  const servers = await serversRes.json();
  console.log('Servers:', servers.map(s => ({ id: s.id, name: s.name })));
  
  // Pobierz pierwszy serwer z produktami
  if (servers[0]) {
    const serverRes = await fetch(`https://api.yshop.pl/v4/client/public/servers/${servers[0].id}`, {
      headers: {
        'authorization': `Bearer ${YSHOP_PUBLIC_KEY}`,
        'accept': 'application/json'
      }
    });

    const server = await serverRes.json();
    
    if (server.categories?.[0]?.products?.[0]) {
      const product = server.categories[0].products[0];
      console.log('\n🔍 First Product:');
      console.log(JSON.stringify(product, null, 2));
      
      // Teraz spróbuj pobrać pełne dane produktu
      console.log(`\n🔍 Trying to fetch full product data for ID ${product.id}...`);
      
      const fullRes = await fetch(`https://api.yshop.pl/v4/client/public/products/${product.id}`, {
        headers: {
          'authorization': `Bearer ${YSHOP_PUBLIC_KEY}`,
          'accept': 'application/json'
        }
      });

      const fullProduct = await fullRes.json();
      console.log(`Status: ${fullRes.status}`);
      console.log(JSON.stringify(fullProduct, null, 2));
    }
  }
}

debugProduct2052();