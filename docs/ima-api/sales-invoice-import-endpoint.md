# IMA vevői számla import végpont — `/api/import/sales-invoice/{apikey?}`

> Forrás: ügyfél által kapott két docx (2026.07.20): "IMA vevői számla import API —
> ügyfélnek kiadható fejlesztői és integrációs dokumentáció", illetve "Ügyféloldali JSON
> leírás". Ez a fájl a két dokumentum saját, tisztázott összefoglalója, nem szó szerinti
> másolat. Az eredeti docx-ek a beszélgetésben lettek átadva.

Host: `https://imaapi.imaerp.hu` (ugyanaz a host, mint a `docs/ima-api/postman-sales-invoice-add.json`-ban dokumentált nyers beszúró végpont — mindkettő `/api/` prefixű útvonal).

## Miben más, mint a nyers `/api/invoices/sales/add/{apikey}` végpont

| Szempont | `/api/import/sales-invoice` | `/api/invoices/sales/add` |
|---|---|---|
| Bemenet | JSON, CSV, XLS/XLSX, NAV OSA XML | csak nyers JSON (`header_data`/`lines_data`) |
| Partner | üzleti adatból (`partner_name`, adószám, cím) old fel/hoz létre automatikusan | kötelező létező `partner_id`, vagy `partner` objektum (02-es Postman példa) |
| ÁFA/fizetési mód | szabad szöveg/kód alapján próbálja azonosítani | explicit `vat_code` kötelező |
| Kontír felülbírálás | opcionális `line_gla_code`/`line_vat_code` mező, de a dokumentáció szerint "előzetesen egyeztetett használat" szükséges hozzá — a tényleges felülbírálás-garancia nincs dokumentálva | a `vat_code` és a header/line összegek explicit, garantáltan azok mennek be |
| Feldolgozás | staging (`incoming_invoices`) → automatikus továbbküldés → `salesheader`/`salesline`, hash-alapú duplikációvédelem | közvetlen beszúrás, nincs staging/duplikációvédelem dokumentálva |
| Válasz | `results[]` (import) + `transfer_results[]` (a tényleges `sales_invoice_id`/hiba) | közvetlen siker/hiba a beszúrásról |

**Döntés a tervben (ld. `docs/tervezes.md`, 2026.08.09-i pontosítás):** a felhasználó
megerősítette, hogy ez — az `imaapi.imaerp.hu` host alatti `/api/import/sales-invoice` —
az **utoljára kapott, jelenleg érvényes** beküldő végpont, ezért a v1 **erre** épül, a
korábban tervezett nyers `/api/invoices/sales/add` helyett. A felhasználó szerint a doksi
némileg eltér a ténylegesen érkező adatoktól, de ez a leírás az irányadó — az eltérést
élő teszttel kell tisztázni (ld. `docs/tervezes.md` 12. fejezet). A staging+
duplikációvédelem és a partner automatikus feloldása üzleti adatból (ld. lent) előny a
nyers végponthoz képest; cserébe a kontír/áfa felülbírálás (`line_gla_code`/
`line_vat_code`) tényleges érvényesülése nincs garantálva dokumentáltan — ezt is élő
teszttel kell megerősíteni. A fájl-alapú bemenet (CSV/XLSX/NAV OSA XML) egyelőre nem
releváns, mert a forrás mindig Billingo JSON.

## Kérés felépítése (JSON mód)

```
POST /api/import/sales-invoice/{apikey?}
Header: user, company            (kötelező — ugyanaz az IMA "user"/"company" fejléc-pár,
                                   mint a nyers add végpontnál)
Content-Type: application/json
```

```json
{
  "invoices": [
    {
      "header": {
        "invoice_number": "CAD-2026-000124",
        "invoice_type": "invoice",
        "doc_date": "2026-07-20",
        "posting_date": "2026-07-20",
        "vat_fulfillment_date": "2026-07-20",
        "due_date": "2026-08-04",
        "payment_method": "transfer",
        "currency_code": "HUF",
        "net_amount": 20000,
        "vat_amount": 5400,
        "gross_amount": 25400,
        "partner_name": "Minta Vevő Kft.",
        "vat_reg_number": "12345678-2-42",
        "partner_code": "V000123",
        "postal_code": "1111",
        "city": "Budapest",
        "addr_street": "Minta utca 1.",
        "country_code": "HU",
        "external_accounting_mode": "Projekt könyvelés",
        "external_id": "cadren-invoice-991122",
        "external_comments": [ { "comment": "...", "external_source": "billingo" } ]
      },
      "lines": [
        {
          "line_number": 1,
          "line_product_or_service_name": "Tanácsadási szolgáltatás",
          "line_quantity": 2,
          "line_unit_of_measure": "óra",
          "line_net_unit_cost": 10000,
          "line_vat_percent_or_code": "27%",
          "line_net_amount": 20000,
          "line_vat_amount": 5400,
          "line_gross_amount": 25400,
          "line_gla_code": "911",
          "line_vat_code": "27%"
        }
      ]
    }
  ]
}
```

## Fontos mezők

- `invoice_type`: `invoice` | `creditentr` | `storno`.
- Dátumok: `YYYY-MM-DD`.
- Nem HUF devizánál `exchange_rate` kötelező.
- Tétel szinten **mindig küldjünk explicit `line_net_amount`/`line_vat_amount`/
  `line_gross_amount`-ot** — a szállítói oldalon (12.4.1, pdf_feldolgozó terv) pontosan
  emiatt keletkezett váratlan áfa+kerekítés sor a hiányzó mezők miatt; feltételezzük,
  hogy ugyanez a kockázat fennáll itt is, még ha ez a végpont dokumentáltan "kötelező a
  végleges feldolgozáshoz" szintre sorolja is ezeket.
- `external_id`: erre fogjuk tenni a Billingo dokumentum azonosítóját idempotencia/
  duplikáció-ellenőrzéshez, ha ezt a végpontot használjuk.

## Válasz

```json
{
  "ok": true,
  "import_batch_id": 101,
  "inserted": 1,
  "results": [ { "index": 0, "ok": true, "incoming_invoice_id": 555 } ],
  "transfer_results": [
    { "incoming_invoice_id": 555, "ok": true, "salesheader_id": 7890, "status": "transferred" }
  ]
}
```

HTTP 200 = teljes siker, HTTP 422 = legalább egy számla import vagy transfer lépése hibás
(számlánként külön hibaüzenettel), HTTP 400/415 = kérésformátum hiba.
