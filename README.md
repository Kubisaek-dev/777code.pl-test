# YShop ItemShop + License Suite

Kompletny projekt zawiera **2 strony www (2 aplikacje)**:

1. `apps/client-shop` – strona klienta z itemshopem pod API yshop.pl + walidacja licencji.
2. `apps/license-server` – bezpieczny panel admina do tworzenia, blokowania i przypisywania licencji do domen.

## Funkcje

### 1) Client Shop
- Pobieranie produktów z API v4 (`/public/shop`, `/public/page/{slug}`, `/public/servers/{id}`) z fallbackiem.
- Tworzenie płatności przez `POST /v4/client/private/payments/make`.
- Wymuszenie aktywnej licencji przy każdym żądaniu.
- Routing jak yshop: `/shop/{slug}` i `/shop/{slug}/server/{serverId}`.
- Obsługa wymaganych nagłówków OAS: `X-API-KEY`, `X-APP-PLATFORM`, `X-APP-PLATFORM-VERSION`, `X-APP-PLATFORM-ENGINE` + fallback `Authorization: Bearer`.

### 2) License Server (Admin)
- Logowanie admina (session + secure cookies).
- Tworzenie licencji (`key`, limit domen, data wygaśnięcia).
- Przypinanie domen do licencji.
- Blokowanie / odblokowanie licencji.
- API walidacji licencji dla stron klienckich.
- Podpis HMAC odpowiedzi weryfikacyjnej (`X-License-Signature`) – opcjonalne, ale gotowe.

---



## Co zostało poprawione teraz
- Panel licencji ma pełny front z CSS + osobnym JS (`/assets/admin.css`, `/assets/admin.js`) i działa pod `/admin`.
- Dodane akcje: tworzenie licencji, przypinanie domen, odpinanie domen, blokada/odblokowanie i usuwanie licencji.
- Dodany podgląd audytu akcji (`/api/audit`) w panelu.
- Poprawione nagłówki security (CSP) tak, żeby panel nie był „białą stroną”.
- Sklep ma nowy premium styl i działa bezpośrednio pod Swagger v4 (`public/shop` + `private/payments/make`) z kluczem publicznym i prywatnym.

## Start

### 1. Instalacja
```bash
npm install
```

### 2. Konfiguracja License Server
Skopiuj:
```bash
cp apps/license-server/.env.example apps/license-server/.env
```
Ustaw m.in.:
- `ADMIN_USER`, `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `LICENSE_SIGNING_SECRET`

### 3. Konfiguracja Client Shop
Skopiuj:
```bash
cp apps/client-shop/.env.example apps/client-shop/.env
```
Ustaw m.in.:
- `SITE_URL` (np. `https://twojsklep.pl`)
- `LICENSE_KEY`
- `LICENSE_API_BASE` (np. `http://localhost:4000`)
- `YSHOP_API_BASE`, `YSHOP_PUBLIC_KEY`, `YSHOP_PRIVATE_KEY`
- `YSHOP_SHOP_SLUG` (opcjonalny domyślny slug)
- `YSHOP_PLATFORM`, `YSHOP_PLATFORM_VERSION`, `YSHOP_PLATFORM_ENGINE`

### 4. Uruchom
Terminal 1:
```bash
npm run dev:license
```
Terminal 2:
```bash
npm run dev:shop
```

- Panel admina: `http://localhost:4000/admin`
- Sklep: `http://localhost:3000`

---

## Przykładowy flow licencji
1. Zaloguj się do panelu admina.
2. Utwórz licencję.
3. Przypnij domenę (np. `twojsklep.pl`).
4. W `apps/client-shop/.env` ustaw `SITE_URL=https://twojsklep.pl` i `LICENSE_KEY=...`.
5. Shop zacznie działać tylko jeśli `LICENSE_KEY` jest aktywna i przypięta do domeny.

---

## Bezpieczeństwo
- `helmet`, `rate-limit`, `session`, hashowanie haseł (możesz podać hash bcrypt zamiast plain).
- HTTP-only cookies.
- Ograniczanie prób logowania.
- Walidacja danych wejściowych i normalizacja domen.
- Podpis HMAC odpowiedzi endpointu verify.

> Przed produkcją: ustaw HTTPS, reverse proxy, prawdziwą bazę (np. Postgres), rotację sekretów i monitoring.


---

## ZIP (gotowy plik do pobrania i odpalenia)

Jeśli chcesz dostać gotowy folder w ZIP:

```bash
./scripts/make-zip.sh
```

Po wykonaniu komendy dostaniesz plik:

- `release/yshop-itemshop-license-suite.zip`

Rozpakowanie i start:

```bash
unzip release/yshop-itemshop-license-suite.zip -d yshop-suite
cd yshop-suite
npm install
cp apps/license-server/.env.example apps/license-server/.env
cp apps/client-shop/.env.example apps/client-shop/.env
npm run dev:license
npm run dev:shop
```

---

## Jak wrzucić to na GitHub (krok po kroku)

1. Utwórz nowe repo na GitHub (np. `yshop-itemshop-license-suite`).
2. W tym folderze projektu odpal:

```bash
git init
git add .
git commit -m "Initial commit: yshop itemshop + license panel"
git branch -M main
git remote add origin https://github.com/TWOJ_LOGIN/yshop-itemshop-license-suite.git
git push -u origin main
```

Po tym kod będzie widoczny na Twoim GitHubie.


## Komendy (kopiuj/wklej)

### 1) Uruchomienie lokalnie (2 terminale)
```bash
npm install
cp apps/license-server/.env.example apps/license-server/.env
cp apps/client-shop/.env.example apps/client-shop/.env
```

Terminal 1:
```bash
npm run dev:license
```

Terminal 2:
```bash
npm run dev:shop
```

### 2) Logowanie do panelu
Ustaw w `apps/license-server/.env`:
```env
ADMIN_USER=admin
ADMIN_PASSWORD=super-mocne-haslo
SESSION_SECRET=losowy_dlugi_secret
LICENSE_SIGNING_SECRET=losowy_dlugi_secret_2
```

Panel: `http://localhost:4000/admin`

### 3) Konfiguracja połączenia z api.yshop.pl
Ustaw w `apps/client-shop/.env`:
```env
YSHOP_API_BASE=https://api.yshop.pl
YSHOP_PUBLIC_KEY=twoj_public_key
YSHOP_PRIVATE_KEY=twoj_private_secret_key
YSHOP_SHOP_SLUG=asdas715612as
YSHOP_PLATFORM=platform/web
YSHOP_PLATFORM_VERSION=1.0.0
YSHOP_PLATFORM_ENGINE=yshop-itemshop-license-suite
```



## Fix problemu `MISSING_LICENSE_KEY`

Jeśli po dodaniu licencji dalej widzisz `MISSING_LICENSE_KEY`:

1. Sprawdź czy klucz jest w `apps/client-shop/.env` (`LICENSE_KEY=LIC-...`).
2. Zrestartuj shop (`npm run dev:shop`).
3. Sprawdź health: `http://localhost:3000/health`.
4. Upewnij się, że domena z `SITE_URL` jest przypięta do licencji w panelu admina.

Aplikacja ładuje teraz `.env` **bezpośrednio z folderu appki** (`apps/client-shop/.env` i `apps/license-server/.env`), więc nie ma problemu z odpalaniem przez workspace z roota.


## Fix błędu `YShop 401: Please provide a valid Public Key`

Najczęstsze przyczyny:
1. W `apps/client-shop/.env` masz zły klucz lub spację/znak nowej linii.
2. Podajesz private key jako public key (lub odwrotnie).
3. Nie restartujesz `npm run dev:shop` po zmianie `.env`.

### Poprawna konfiguracja
```env
YSHOP_PUBLIC_KEY=publ_xxx
YSHOP_PRIVATE_KEY=priv_xxx
YSHOP_SHOP_SLUG=asdas715612as
YSHOP_PLATFORM=platform/web
YSHOP_PLATFORM_VERSION=1.0.0
YSHOP_PLATFORM_ENGINE=yshop-itemshop-license-suite
```

### Jak to działa teraz w kodzie
- Dla endpointów publicznych (`/v4/client/public/*`) używany jest klucz publiczny.
- Dla endpointów private (`/v4/client/private/*`) używany jest klucz private.
- Kod ma fallback autoryzacji:
  - najpierw `X-API-KEY` (zgodnie z nową dokumentacją),
  - potem `Authorization: Bearer ...` (zgodnie ze starym działającym przykładem).

Dzięki temu integracja działa zarówno pod nowy Swagger, jak i warianty starsze.


## Czy to musi działać na serwerze z publicznym IP?

Nie — **łączenie do `https://api.yshop.pl` może działać lokalnie** (na Twoim komputerze), o ile:
1. masz internet,
2. klucze są poprawne,
3. nagłówki są poprawnie wysyłane,
4. firewall/proxy nie blokuje ruchu.

Publiczne IP jest potrzebne dopiero wtedy, gdy chcesz wystawić sklep/publiczny webhook dla klientów z internetu.

## Routing jak w yshop (wybór serwera)

Teraz sklep obsługuje:
- `/shop/{slug}`
- `/shop/{slug}/server/{serverId}`

Przykład:
- `http://localhost:3000/shop/asdas715612as`
- `http://localhost:3000/shop/asdas715612as/server/12457615`

W UI kliknięcie serwera przełącza URL i filtruje produkty pod wybrany serwer.


## Dodatkowy fallback gdy API nie zwraca produktów

Jeśli endpointy API nie zwrócą listy produktów, aplikacja użyje fallbacku i odczyta dane publiczne ze strony `https://yshop.pl/shop/{slug}` (analiza `__NEXT_DATA__`).
To pomaga w przypadkach, gdzie API zwraca inny format lub puste dane dla Twojej konfiguracji.
