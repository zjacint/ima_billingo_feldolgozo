# Ügyvédi előfizetéses platform – vázlat v0.1

Magyar joganyagra épülő, ügyvéd által felügyelt, előfizetéses webalkalmazás.
Mintaként szolgáló termékek (LawDepot, online végrendelet-készítők) tanulsága: önkiszolgáló
kérdőív → dokumentum → letöltés. A mi különbségünk: **magyar jog + mögötte valódi ügyvéd**.

## 1. Négy terület, három működési mód

| Terület | Mód | Mit lát az ügyfél | Mit csinál az ügyvéd (admin) |
|---|---|---|---|
| Szerződések | **Önkiszolgáló** | Sablonkatalógus → kérdőív (wizard) → előnézet → DOCX/PDF; AI-felülvizsgálat saját/idegen szerződésre | Sablont tölt fel/verziózik, változókat és záradékokat definiál, jóváhagy, publikál |
| Adóhatósági eljárás | **Tudástár + chat** | Egyszerűsített útmutatók (ellenőrzés, bírság, fizetési könnyítés, jogorvoslat), határidő-segéd, chat forráshivatkozással | Cikkeket ír/hagy jóvá, chat-eszkalációt kezel |
| Adótanácsadás | **Tudástár + chat** | Ugyanaz, adózási témákban (SZJA, kata/kiva, ÁFA, TAO…) | Ugyanaz |
| Vagyontervezés, hagyaték | **Feladatgyűjtő + árajánlat** | Intake-kérdőív (családi állapot, vagyon, örökösök) → ügy létrejön → árajánlat → elfogadás/fizetés | Ügyet átvesz, árajánlatot ad, feladatokat és dokumentumkérést kezel |

Megjegyzés: a szerződés-terület (pl. végrendelet) *jogilag érzékeny* – az „ügyvédi ellenjegyzés kell"
jelölő (`requiresLawyerCountersign`) ezért sablon-szinten állítható; ilyenkor a generált anyag
„ügyvédnek küldés" státuszba kerül, nem csak letölthető.

## 2. Szerepkörök

- **CLIENT** – regisztrál, előfizet, használja a modulokat.
- **LAWYER** – teljes admin: sablonok, tudástár, ügyek, árajánlatok, felhasználók, AI-eredmények ellenőrzése.
- **STAFF** – korlátozott (ügykezelés, nem publikálhat sablont).
- **SUPERADMIN** – üzemeltetés, csomagok, naplók.

## 3. Architektúra (GCP)

```
 Böngésző ──► Cloud Load Balancer + Cloud Armor
                │
                ▼
   Next.js 14 (App Router, TS) – Cloud Run  ◄── Identity Platform (auth, 2FA)
                │
   ┌────────────┼──────────────────────────┬───────────────────┐
   ▼            ▼                          ▼                   ▼
 Cloud SQL    Cloud Storage (CMEK)     Vertex AI (Gemini)   Cloud Tasks / Pub/Sub
 PostgreSQL   dokumentumok             + embedding          háttérmunkák:
 + pgvector   (EU régió)               (EU régió!)          AI-review, PDF, jogszabály-szinkron
                │
 Secret Manager · Cloud KMS · Cloud Logging/Audit · Cloud Scheduler (jogszabály-frissítés)
```

Főbb döntések (javaslat, vitatható):
- **Gemini Vertex AI-on keresztül**, `europe-west*` régióban – nem a consumer Gemini API. Okok: GDPR, ügyvédi titoktartás (Üttv.), nincs tanítás az adatainkon, szerződéses DPA.
- **RAG a chathez**: jóváhagyott `KnowledgeArticle` + `LegalSource` (njt.hu, NAV) → `KnowledgeChunk` (pgvector). A chat csak a tudástárból válaszol, **kötelező forráshivatkozással**, alacsony biztonságnál „Kérdezd az ügyvédet" eszkaláció.
- **Sablonmotor**: HTML + Handlebars-szerű változók/feltételek; kimenet DOCX és PDF. Az ügyvéd .docx-et tölthet fel, amit változókra képezünk le (`TemplateVersion.sourceDocxFileId`).
- **Verziózás**: minden generált dokumentum a *saját sablonverziójára* mutat; jogszabályváltozásnál az érintett sablon `IN_REVIEW`-ba kerül.
- **Hozzáférés-naplózás** (`AuditLog`) minden dokumentum/ügy megnyitásáról.
- Monorepo: `apps/web` (Next.js), `packages/db` (Prisma), `packages/ai` (Gemini/RAG), `infra/` (Terraform).

## 4. Adatmodell – összefoglaló

Részletes séma: [`../prisma/schema.prisma`](../prisma/schema.prisma) (Prisma 5.22-vel validálva).

- **Felhasználó**: `User`, `ClientProfile` (érzékeny mezők KMS-titkosítva), `Organization`, `OrgMember`
- **Előfizetés**: `Plan`, `PlanEntitlement` (kereten alapuló jogosultság), `Subscription`, `Payment`, `UsageCounter`
- **Szerződés-sablonok**: `TemplateCategory`, `ContractTemplate`, `TemplateVersion`, `TemplateVariable`, `TemplateClause`
- **Ügyfél-dokumentumok**: `ContractDocument`, `AiContractReview`, `ReviewFinding`
- **Tudástár/chat**: `LegalSource`, `KnowledgeArticle`, `KnowledgeChunk` (vector), `ChatThread`, `ChatMessage`, `ChatCitation`
- **Ügykezelés**: `IntakeForm`, `Case`, `Quote`, `QuoteItem`, `Task`, `CaseNote`
- **Közös**: `File`, `Consent`, `AuditLog`

Fő kapcsolatok: `User 1–n Subscription n–1 Plan 1–n PlanEntitlement`;
`ContractTemplate 1–n TemplateVersion 1–n (Variable, Clause, ContractDocument)`;
`Case 1–n (Quote, Task, CaseNote, File, ChatThread)`.

## 5. UI/UX

### 5.1 Alapelvek
- **Laikus nyelv**, minden jogi fogalomnál „Mit jelent?" súgó.
- **Bizalom**: látható ügyvédi név/kamarai szám, „ügyvéd által jóváhagyva – dátum" jelvény minden cikken/sablonon, jogszabály-állapot dátuma.
- **Őszinte AI-jelölés**: minden AI-kimeneten „Tájékoztató jellegű, nem jogi tanács" + forrásmegjelölés + „Ügyvéd ellenőrzését kérem" gomb.
- Mobil-first, WCAG 2.1 AA, magyar nyelvű hibaüzenetek, mentett piszkozat minden wizard-lépésnél.

### 5.2 Ügyfél-felület – oldaltérkép

```
/                       Nyitóoldal (4 terület, árak, bizalmi elemek)
/arak                   Csomagok összehasonlítása
/regisztracio, /belepes 2FA opcióval, e-mail megerősítés, hozzájárulások
/app                    Irányítópult
 ├─ /app/szerzodesek            Katalógus (kategória, keresés) → /sablon/[slug]
 │    ├─ /uj/[slug]             Wizard: lépések, haladásjelző, élő előnézet
 │    ├─ /dokumentumaim         Státusz: piszkozat / kész / ügyvédnél / aláírt
 │    └─ /felulvizsgalat        Feltöltés → AI-jelentés (súlyosság szerint)
 ├─ /app/adoeljaras             Tudástár + chat + határidő-segéd
 ├─ /app/adotanacsadas          Tudástár + chat
 ├─ /app/vagyon-hagyatek        Intake → ügyeim → árajánlat elfogadás
 ├─ /app/ugyeim/[id]            Idővonal, feladatok, fájlok, üzenetek
 └─ /app/fiok                   Profil, előfizetés, számlák, adatkezelés (letöltés/törlés)
```

### 5.3 Kulcsképernyők (drótváz)

**Irányítópult**
```
┌ Üdv, Anna!            Csomag: Pro · keret: 3/5 szerződés ┐
│ [Szerződés készítése] [Kérdés a tudástárban] [Új ügy]    │
│ Teendők: ▢ Töltsd fel a tulajdoni lapot (ügy #0042)       │
│ Legutóbbi dokumentumok …   Közelgő határidők …            │
└───────────────────────────────────────────────────────────┘
```

**Szerződés-wizard**
```
Lépés 2/5 – Felek                      │ Élő előnézet
[Eladó neve ____] [Adószám ____]       │ ADÁSVÉTELI SZERZŐDÉS
? Mi az a kellékszavatosság?           │ amely létrejött …
[Vissza]            [Mentés] [Tovább]  │ (kiemelve a most szerkesztett rész)
```

**AI-felülvizsgálat**: bal oldalon a szerződés szövege kiemelésekkel, jobb oldalon találatok (🔴 kritikus / 🟠 közepes / 🔵 info), mindegyik: probléma, javaslat, jogszabályi hivatkozás, „Elfogadom a javaslatot".

**Chat**: üzenetek + alatta *Források* (cikk, §), „Hasznos volt?" és „Kérdezem az ügyvédet" gomb; oldalsávban a releváns tudástár-cikkek.

**Intake → árajánlat**: feltételes kérdések (pl. ingatlan van? → tulajdoni lap feltöltés) → összegzés → „Árajánlatot kérek". Az ajánlat oldalán tételes lista, érvényesség, [Elfogadom és fizetek] / [Kérdésem van].

### 5.4 Admin (ügyvédi) felület
```
/admin
 ├─ Irányítópult        Jóváhagyásra váró sablonok/cikkek, új ügyek, eszkalált chatek
 ├─ Sablonok            Lista → szerkesztő:
 │                       [Szöveg] [Változók] [Záradékok] [Kérdőív-előnézet] [Verziók]
 │                       .docx import, {{változó}} megjelölés, „Teszt kitöltés", Publikálás
 ├─ Tudástár            Cikk-szerkesztő (Markdown), jogszabály-forrás csatolás, felülvizsgálati határidő
 ├─ Ügyek               Kanban: Új → Intake → Ajánlat → Folyamatban → Kész
 │    └─ Ügylap         Intake-válaszok, árajánlat-szerkesztő, feladatok, jegyzetek, fájlok
 ├─ AI-felülvizsgálatok Ügyvédi ellenőrzés sor
 ├─ Felhasználók, Csomagok & árak, Naplók (audit)
```

### 5.5 Jogi/megfelelési elemek a felületen
Cookie-banner, ÁSZF/adatkezelés/AI-hozzájárulás külön jelölőnégyzet (`Consent`), adatexport és törlés kérése, „nem jogi tanácsadás, amíg ügyvédi megbízás nem jön létre" tájékoztatás.

## 6. Ütemezés (javaslat)

1. **Alap** (2–3 hét): auth, szerepkörök, Prisma/Cloud SQL, CI/CD, Terraform.
2. **Szerződés-modul** (4 hét): admin sablonszerkesztő, wizard, DOCX/PDF.
3. **Előfizetés/fizetés** (2 hét).
4. **Tudástár + chat (RAG)** (3–4 hét).
5. **Gemini szerződés-review** (2 hét).
6. **Ügy-/árajánlat-modul** (3 hét).
7. Biztonsági audit, pilot ügyfelekkel.

## 7. Kérdések – kérlek válaszolj

**Üzlet és jog**
1. Ki a jogi szolgáltató (egyéni ügyvéd / iroda)? Hány ügyvéd/asszisztens fér hozzá az adminhoz?
2. A **végrendelet** formai szabályai szigorúak (kézírás, 2 tanú, közjegyzői/ügyvédi ellenjegyzés). Szeretnétek végrendelet-sablont, vagy csak „előkészítő" kérdőívet ügyvédi véglegesítéssel?
3. Mely szerződéstípusok kerüljenek az induló katalógusba (kb. 10–15)? Pl. adásvétel, bérleti, megbízási, vállalkozási, munkaszerződés, NDA, tartozáselismerés, ajándékozási…
4. Az előfizetés mit tartalmaz pontosan: korlátlan sablonhasználat? havi kerettel? Az ügyvédi konzultáció benne van-e?
5. Árazás: havi/éves, magánszemély és cég külön csomag? Van tervezett ársáv?
6. Ügyvédi felelősségbiztosítás és ÁSZF: kell-e „nem minősül jogi tanácsnak" tartalmú mondatok szövege tőletek?

**Felhasználók és adatok**
7. Magánszemélyek, cégek (B2B), vagy mindkettő a célcsoport? Kell-e több felhasználó egy céghez?
8. Milyen személyes adatok szükségesek a szerződésekhez (adóazonosító, anyja neve, lakcím, személyi ig. szám)? Hol tároljuk, mennyi ideig (megőrzési idő)?
9. Szükséges-e **elektronikus aláírás** (AVDH, KAÜ, DocuSign/Adobe Sign), vagy elég a PDF letöltés?
10. Kell-e **ügyfélkapus / NAV-integráció** (pl. adózói adatok betöltése), vagy csak tudástár?

**Tudástár és AI**
11. A tudástár tartalmát ki írja és ki tartja naprakészen? Automatikus jogszabály-figyelés (njt.hu) kell?
12. A chat válaszoljon *szabad szöveggel* a tudástár alapján, vagy csak előre megírt GYIK-ből?
13. Gemini review: csak a mi sablonjainkra, vagy ügyfél által feltöltött *idegen* szerződésre is? (Utóbbi sokkal nagyobb kockázat és ügyvédi ellenőrzési igény.)
14. Elfogadható-e, hogy az AI-eredmény ügyvédi jóváhagyás nélkül azonnal megjelenik (disclaimerrel), vagy minden riportot ügyvéd néz át?

**Fizetés és számlázás**
15. Fizetési szolgáltató: Stripe, Barion, OTP SimplePay? Számlázás: Billingo (a repo már használja), Számlázz.hu?
16. Az árajánlat elfogadása után online fizetés kell, vagy átutalás?

**Technikai**
17. Nyelv: csak magyar, vagy később angol is?
18. Van meglévő GCP-projekt/szervezet, régiópreferencia (javaslat: `europe-west3` Frankfurt vagy `europe-central2` Varsó)?
19. Van márkanév, logó, színvilág? Szeretnétek-e saját domaint (pl. `.hu`)?
20. Nyelv/stack rendben a Next.js + Prisma + PostgreSQL + Cloud Run? Vagy más keretrendszer (pl. NestJS API külön)?
21. A megadott minták (NCOA, CNBC, LawDepot) közül melyik elemek legyenek **kötelezően** megvalósítva (pl. LawDepot-szerű lépésenkénti kérdőív, összehasonlító táblázatok)?

## 8. Kockázatok
- Jogi felelősség AI-válaszokért → forráshivatkozás, disclaimer, eszkaláció, ügyvédi jóváhagyás.
- Ügyvédi titoktartás és GDPR → EU régió, CMEK, audit log, hozzáférés-szabályozás, DPA a Google-lel.
- Jogszabályi elavulás → `reviewDueAt`, sablon `lawEffectiveFrom`, automatikus értesítés.
- Tiltott/szabályozott tevékenység: jogi szolgáltatás ügyvédi tevékenységhez kötött – egyeztetni kell a Kamarával a hirdetési és online szolgáltatási szabályokról.
