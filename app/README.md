# Billingo → IMA admin

Kimenő (vevői) számla admin alkalmazás: Billingo-ból szinkronizált
számlákhoz kontír/áfa javaslatot ad (az IMA korábbi könyvelési
analitikájából tanulva), a könyvelő jóváhagyása után pedig beküldi az
IMA API-n keresztül. A teljes tervezési dokumentum: `../docs/tervezes.md`.

## Fejlesztői indítás

```bash
npm install
cp .env.example .env.local   # töltsd ki DATABASE_URL, NEXTAUTH_SECRET, Google OAuth adatok
npm run prisma:migrate
SEED_ACCOUNTANT_EMAIL=te@example.com SEED_ACCOUNTANT_NAME="Teljes Név" npm run seed
npm run dev
```

Bejelentkezés: Google Workspace SSO (`ALLOWED_GOOGLE_WORKSPACE_DOMAIN`,
alapértelmezetten `example.com`) vagy email-OTP a `dashboard/admin/otp-emails`
oldalon engedélyezett külső címekkel — mindkét esetben előre létrehozott
`User` rekord szükséges (ld. `dashboard/users`, vagy a seed script).

## Architektúra röviden

- Next.js 14 (App Router) + Prisma/PostgreSQL, ugyanaz a stack és
  RBAC-minta, mint egy testvérprojekt admin appjában.
- `src/lib/billingoApiClient.ts` — Billingo API v3 kliens (`GET /documents`).
- `src/lib/imaApiClient.ts` — IMA API kliens: `glaaccounts`/`vatkeys`/
  `invoiceanalytics` (`clientapi.imaerp.hu`) és a beküldés
  (`imaapi.imaerp.hu/api/import/sales-invoice`, ld. docs/tervezes.md 2.2/8.
  fejezet).
- `src/lib/mappingRuleEngine.ts` — tanult + kézi kontír/áfa szabálymotor.
- `src/lib/billingoSync.ts`, `src/lib/invoiceWorkflow.ts` — a számla
  életciklus (`synced → needs_review → approved → submitted/booked/failed`).

## GCP-re telepítés

Cloud Run (Next.js standalone, ld. `Dockerfile`) + Cloud SQL (PostgreSQL) —
ugyanaz a minta, mint a testvérprojekt `docs/kornyezetek.md`-je. Ez a
lépés még nincs végrehajtva ebben a repóban — a konkrét parancsokat/
konfigurációt egy külön kör dokumentálja majd, miután a GCP projekt
készen áll.

Az időzített Billingo-szinkronhoz és IMA-tanuláshoz két önálló CLI script is
van (`npm run sync:billingo`, `npm run learn:invoiceanalytics`) — ezek
Cloud Run Job / Cloud Scheduler alapú ütemezéshez használhatók a UI-gombok
alternatívájaként.
