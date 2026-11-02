# Döntésnapló – 1. kör válaszai (2026-11-02)

Forrás: `ugyvedi_platform_kerdesek.docx` (kitöltve) és `MIT ADUNK, MENNYIÉRT.docx`.
Szolgáltató ügyvédi iroda: Dr Bor Ügyvédi Iroda, Szeged (Dr Bor István ügyvéd, Dr Somodi Réka ügyvédjelölt).

## Eldöntött kérdések

| # | Döntés | Hatás a tervre |
|---|---|---|
| D1 | Előfizetés **csak cégeknek**: *Cég – Alap* (9 900 Ft + ÁFA/hó, 1 felhasználó) és *Cég – Emelt* (29 900 Ft + ÁFA/hó, 2 felhasználó), 12 hónapos időszak | `Plan.commitmentMonths`, `maxSeats`, `Subscription` csak `Organization`-höz |
| D2 | Magánszemély és előfizetés nélküli cég: **egyedi dokumentum** 5 900 Ft + ÁFA/db | `Order` (vendég is lehet), `Product` |
| D3 | Keret felett: generálás 5 900, AI-ellenőrzés 2 900 Ft + ÁFA/db | `PlanEntitlement.overagePriceNetHuf` |
| D4 | Emelt: tudástár + havi 1 ügyvédi szerződés-ellenőrzés **vagy** 30 perc konzultáció | `knowledge_base` és `lawyer_review_or_consult` jogosultság |
| D5 | Ügyvédi kiegészítők: 9 900 Ft + ÁFA/szerződés, ill. /30 perc | `Product`, `LawyerServiceRequest` |
| D6 | Idő előtti felmondás: a hátralévő havi díjak egy összegben | `Subscription.earlyTerminationFeeNetHuf`, `PaymentKind.EARLY_TERMINATION` |
| D7 | Ellenjegyzéshez kötött ügyletek: nem önkiszolgáló, egyedi árajánlat, előfizetői kedvezménnyel | `Case` + `Quote`, nincs wizard |
| D8 | Fizetés: kártya, **foglalás a generálás előtt, megterhelés a generálás után azonnal**; átutalás nincs | `Order.cardHold`, `CardHoldStatus` |
| D9 | Nincs e-aláírás; az ÁSZF-et a vásárló pipával elfogadja | `Order.termsVersion/termsAcceptedAt`, `Consent` |
| D10 | **Adatminimalizálás**: a szerződés letöltése után törlés, legfeljebb 7 nap | `ContractDocument.expiresAt/purgedAt`, `File.deleteAfter`, törlő ütemező, `ClientProfile` lecsupaszítva |
| D11 | AI-ellenőrzés **csak a saját sablonokból generált** dokumentumra; AI-ért nincs felelősség, ügyvédi ellenőrzésért van (ha megfizették) | `AiContractReview.documentId` kötelező, feltöltött idegen szerződés kivéve |
| D12 | AI-feldolgozáshoz minden esetben külön ügyfél-hozzájárulás | `Consent(AI_PROCESSING)` kötelező az AI-funkció előtt |
| D13 | Nincs NAV/ügyfélkapu-integráció; „faék egyszerű" első verzió, utána 3 hónap pilot | MVP-hatókör (lásd lent) |
| D14 | A chat a legolcsóbb megoldással működjön | RAG + olcsó Gemini-modell, havi korlát, csak Emeltben |
| D15 | Jogi tudástartalom: Dr Bor; adó tartalom: a partner oldaláról; jogszabályfigyelés fontos | `KnowledgeArticle.reviewedById`, forrásfigyelő job |
| D16 | Nyelv: magyar; stack: Next.js + Prisma + PostgreSQL + Cloud Run: jóváhagyva | – |
| D17 | Pmt.-azonosítás: elfogadható a partner által elvégzett, ha az ügyfél hozzájárul az átadáshoz; távellenjegyzés lehetséges, nagy értéknél személyes | `KycRecord`, `Consent(KYC_SHARING)` |
| D18 | Az ügyvéd nem hirdethet; a könyvelő/partner cég igen | A weboldal üzemeltetője és szövegei a partner cég; „ügyvéd által" állítások egyeztetendők |

## Induló szerződéskatalógus (12 db)

1. Lakásbérleti szerződés (üzlethelyiség-változat később)
2. Használt gépjármű adásvételi szerződés
3. Munkaszerződés
4. Megbízási szerződés (később: ingatlanos, bizományosi, könyvelői, adótanácsadói változatok)
5. Vállalkozási szerződés (később: építőipar)
6. Kölcsönszerződés (később: alanyok szerinti változatok)
7. Tartozáselismerő és részletfizetési megállapodás
8. Ingó adásvételi szerződés
9. Ingó ajándékozási szerződés
10. Titoktartási megállapodás (NDA, csak cégeknek)
11. Szolgáltatási szerződés vállalkozások között
12. Munkaviszony megszüntetése közös megegyezéssel

+ **Végrendelet** (lásd javaslat lent). A „későbbi változatokhoz" a séma `ContractTemplate.parentTemplateId`-t tartalmaz.

## Javaslatok a válaszokban feltett kérdésekre

**Végrendelet** – igen, készüljön kérdőív, két termékként:
1. *Önkiszolgáló végrendelet-sablon* (nincs ellenjegyzés): kérdőív → kész szöveg + **kinyomtatható aláírási útmutató** (kézírás vagy két egyidejűleg jelen lévő tanú, tanúk adatai, a sablon figyelmeztet a tipikus hibákra). Rendes katalógus-termék, ára az Ön döntése (egyedi dokumentum alapára vagy magasabb).
2. *Ügyvédi ellenjegyzett végrendelet*: **nem wizard, hanem `Case`** + árajánlat + (táv)ellenjegyzés. A kérdőív ugyanaz lehet, de a kitöltés „előkészítés" és az ügyvéd viszi tovább.
Így a kérdőívet egyszer kell megírni.

**Ki a szolgáltató?** (ez blokkolja az ÁSZF-et, a számlázást és az AI-hozzájárulást) Javaslat:
- **Egyetlen üzemeltető cég** (Dzabakusz vagy S.L.A Bt) értékesíti a *szoftveres szolgáltatást* (dokumentum-generálás, AI-ellenőrzés, tudástár), ő a weboldal üzemeltetője, számlakiállítója és adatkezelője, az ÁSZF-je szerint.
- Az **ügyvédi kiegészítőket és az ellenjegyzéses ügyeket** az ügyvédi iroda saját megbízás alapján, saját számlával végzi. A weboldal csak a megrendelést közvetíti (ez a hirdetési korlát miatt is tisztább).
- Az iroda a sablonokat licenc alapján adja az üzemeltetőnek.
Ezt a jogi szerkezetet Dr Bornak kell jóváhagynia.

**Fizetés és számlázás** (javaslat, nem döntés): Stripe (kártya-foglalás + megterhelés, ismétlődő díj, erős ügyfél-hitelesítés) vagy Barion (hazai, foglalás támogatott); számlázásra **Billingo**, mert a repó már használ Billingo-integrációt és az automatikus számlakiállítás (NAV online számla) megoldott.

**Q25 magyarázata**: azt kérdeztem, a minták közül mely megoldásokat vegyük át. Javaslatom (nem kell válaszolni): lépésenkénti kérdőív, élő előnézet, csomag-összehasonlító táblázat, bizalmi elemek. A többit elhagyjuk.

## Jogi/szabályozási pontok, amiket Dr Bornak jóvá kell hagynia

- **Fogyasztói árjelzés**: magánszemély felé bruttó árat kell mutatni (5 900 + 27% ÁFA = 7 493 Ft), a cégeknek nettót lehet.
- **Elállási jog** (45/2014. Korm. rendelet): digitális tartalomnál a letöltéssel a vásárló lemondhat róla, de ehhez kifejezett hozzájárulás és tudomásulvétel kell a fizetés előtt.
- **Felelősségkizárás**: fogyasztóval szemben korlátozott a kizárhatóság; ÁSZF-szöveget ügyvédnek kell véglegesítenie.
- **Megőrzés**: a 7 napos törlés a szerződés *tartalmára* szól. A számlák és fizetési adatok megőrzése kötelező (számviteli szabályok); a Pmt.-azonosítás dokumentumaié is (idő: ügyvéd megerősíti).
- **Idő előtti felmondás** egyösszegű díja: ÁSZF-ben egyértelműen szerepeljen.
- **Vertex AI**: a 17. kérdésre adott „Nem" válasz kétértelmű (lásd 2. kör).

## Első kiadás (MVP) hatóköre

- Cég regisztráció + előfizetés (Alap/Emelt), kártyás fizetés, Billingo-számla.
- Vendég-vásárlás (egyedi dokumentum): e-mailes letöltőlink, 7 napos törlés.
- 12 + 1 sablon, wizard, DOCX/PDF generálás, admin sablonfeltöltés.
- AI-ellenőrzés saját dokumentumra, hozzájárulással és kerettel.
- Ügyvédi kiegészítők megrendelése (űrlap + fizetés).
- Tudástár és chat (Emelt), egyszerű RAG.
- Ellenjegyzéses ügy: csak ajánlatkérő űrlap + kézi kezelés az adminban.
- **Később**: e-aláírás, NAV-integráció, angol nyelv, további sablonváltozatok.
