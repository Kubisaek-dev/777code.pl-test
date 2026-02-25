# YShop ItemShop + License Suite

Kompletny projekt zawiera **2 strony www (2 aplikacje)**:

1. `apps/client-shop` – strona klienta z itemshopem pod API yshop.pl + walidacja licencji.
2. `apps/license-server` – bezpieczny panel admina do tworzenia, blokowania i przypisywania licencji do domen.

## Funkcje

### 1) Client Shop
- Pobieranie produktów z endpointu `GET /v4/client/public/shop` (Swagger yshop.pl).
- Tworzenie płatności przez `POST /v4/client/private/payments/make`.
- Wymuszenie aktywnej licencji przy każdym żądaniu.
- Konfiguracja URL strony klienta (`SITE_URL`) – licencja jest przypinana do domeny.
- Obsługa wymaganych nagłówków OAS: `X-API-KEY`, `X-APP-PLATFORM`, `X-APP-PLATFORM-VERSION`, `X-APP-PLATFORM-ENGINE`.

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
YSHOP_PLATFORM=platform/web
YSHOP_PLATFORM_VERSION=1.0.0
YSHOP_PLATFORM_ENGINE=yshop-itemshop-license-suite
```

Jeśli endpointy w Twoim planie yshop są inne, podmień `YSHOP_PRODUCTS_PATH` i `YSHOP_ORDERS_PATH`.


## Fix problemu `MISSING_LICENSE_KEY`

Jeśli po dodaniu licencji dalej widzisz `MISSING_LICENSE_KEY`:

1. Sprawdź czy klucz jest w `apps/client-shop/.env` (`LICENSE_KEY=LIC-...`).
2. Zrestartuj shop (`npm run dev:shop`).
3. Sprawdź health: `http://localhost:3000/health`.
4. Upewnij się, że domena z `SITE_URL` jest przypięta do licencji w panelu admina.

Aplikacja ładuje teraz `.env` **bezpośrednio z folderu appki** (`apps/client-shop/.env` i `apps/license-server/.env`), więc nie ma problemu z odpalaniem przez workspace z roota.
