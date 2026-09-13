# Billingo → IMA kimenő számla integráció

Kimenő (vevői) számla admin alkalmazás: a [Billingo](https://www.billingo.hu/)-ból
szinkronizált számlákhoz kontír/áfa javaslatot ad (a korábbi IMA könyvelési
analitikájából tanulva), a könyvelő jóváhagyása után pedig beküldi az
[IMA](https://imaerp.hu/) API-n keresztül.

> **Ez egy publikus, megosztható verzió.** Minden cégspecifikus adat
> (adatbázis-kapcsolat, GCP-projekt, Google Workspace domain, API-kulcsok,
> hitelesítő adatok) környezeti változóból vagy adatbázis-rekordból jön —
> nincs a kódba égetve. A saját telepítésedhez a lenti dokumentáció alapján
> minden `<...>` jelölésű vagy placeholder értéket a sajátoddal kell
> helyettesítened.

## Miért létezik ez a projekt

A cég a kimenő (vevői) számláit Billingóban állítja ki, a könyvelés viszont
IMA-ban történik. Ez az admin alkalmazás automatizálja az átvitelt: lekérdezi
a Billingo számlákat, kontírt/áfa kulcsot javasol a korábbi könyvelésből
tanulva, majd a könyvelő jóváhagyása után beküldi IMA-nak.

A teljes architektúra, adatmodell és a döntések indoklása: **[docs/tervezes.md](docs/tervezes.md)**.

## Gyors indulás (helyi fejlesztés)

Az alkalmazás forráskódja az `app/` mappában van (Next.js 14 + Prisma +
PostgreSQL). Lépésről lépésre: **[app/README.md](app/README.md)**.

Röviden:

```bash
cd app
npm install
cp .env.example .env.local   # töltsd ki: DATABASE_URL, NEXTAUTH_SECRET, Google OAuth adatok
npm run prisma:migrate       # Prisma migrációk lefuttatása a helyi/dev adatbázison
SEED_ACCOUNTANT_EMAIL=te@example.com SEED_ACCOUNTANT_NAME="Teljes Név" npm run seed
npm run dev
```

Az adatmodell (Prisma séma, migrációk) itt található: `app/prisma/`.

## Éles (GCP) telepítés

Cloud Run (Next.js standalone build) + Cloud SQL (PostgreSQL) — a teljes,
lépésről lépésre útmutató (projekt létrehozás, Cloud SQL, Secret Manager,
Google OAuth kliens, Cloud Run deploy, Prisma migráció éles adatbázison,
és a leggyakoribb hibák/buktatók): **[docs/kornyezetek.md](docs/kornyezetek.md)**.

## Külső API-k dokumentációja

- **[docs/billingo-api/openapi.yaml](docs/billingo-api/openapi.yaml)** — Billingo API v3 hivatalos OpenAPI leírása.
- **[docs/ima-api/](docs/ima-api/)** — IMA API referencia (OpenAPI séma, Postman-gyűjtemény, a számla-beküldő végpontokkal kapcsolatos tapasztalatok).

## Repó felépítése

```
app/    — az alkalmazás forráskódja (Next.js, Prisma séma és migrációk, CLI szkriptek)
docs/   — tervezési dokumentum, GCP telepítési útmutató, külső API dokumentáció
```

## Amit a saját telepítésedhez be kell állítanod

| Mit | Hol | Leírás |
|---|---|---|
| Adatbázis-kapcsolat | `DATABASE_URL` env változó | ld. `app/.env.example` |
| Google Workspace SSO | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`ALLOWED_GOOGLE_WORKSPACE_DOMAIN` | ld. `docs/kornyezetek.md` 6. lépés |
| Email-OTP küldés (SMTP) | `SMTP_*` env változók | ld. `app/.env.example` |
| Billingo API-kulcs | `Company.billingoApiKey` (adatbázis) | cégenkénti, a Beállítások oldalon adható meg — **nem** env változó |
| IMA API-kulcs | `Company.imaApiKey`/`imaApiUser`/`imaApiCompany` (adatbázis) | cégenkénti, a Beállítások oldalon adható meg — **nem** env változó |
| GCP projekt, Cloud SQL, Cloud Run | ld. `docs/kornyezetek.md` | teljes, sablonosított telepítési útmutató |

Egyetlen érték sincs a forráskódba égetve — az itteni dokumentáció és a
`.env.example` fájl mutatja meg, hova kell behelyettesíteni a sajátodat.
