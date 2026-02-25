# YShop ItemShop + License Suite

Kompletny projekt zawiera **2 strony www (2 aplikacje)**:

1. `apps/client-shop` – strona klienta z itemshopem pod API yshop.pl + walidacja licencji.
2. `apps/license-server` – bezpieczny panel admina do tworzenia, blokowania i przypisywania licencji do domen.

## Funkcje

### 1) Client Shop
- Pobieranie produktów z API YShop.
- Tworzenie zamówień przez API YShop.
- Wymuszenie aktywnej licencji przy każdym żądaniu.
- Konfiguracja URL strony klienta (`SITE_URL`) – licencja jest przypinana do domeny.

### 2) License Server (Admin)
- Logowanie admina (session + secure cookies).
- Tworzenie licencji (`key`, limit domen, data wygaśnięcia).
- Przypinanie domen do licencji.
- Blokowanie / odblokowanie licencji.
- API walidacji licencji dla stron klienckich.
- Podpis HMAC odpowiedzi weryfikacyjnej (`X-License-Signature`) – opcjonalne, ale gotowe.

---

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
- `YSHOP_API_BASE` i `YSHOP_API_KEY`

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
