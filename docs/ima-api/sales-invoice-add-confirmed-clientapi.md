# IMA vevői számla beszúrás — MEGERŐSÍTETT, működő referencia (`clientapi.imaerp.hu`)

> Forrás: Freier Dávid Balázs emailje ("IMA API - számla beszúrás tisztázva",
> 2026.09.10), saját, sikeres éles teszttel megerősítve (a KAMU1/KAMU2
> teszt-számlák ténylegesen létrejöttek IMA-ban, screenshot mellékelve az
> eredeti emailhez). Ez a fájl az email saját, tisztázott összefoglalója,
> nem szó szerinti másolat.
>
> ⚠️ Ez ELTÉR a korábban feltételezett host/útvonaltól (`imaapi.imaerp.hu`
> `/api/invoices/sales/add`) — ld. `docs/tervezes.md` 18. fejezet a teljes
> elemzésért és a kódbeli javításért (`src/lib/imaApiClient.ts`
> `pushSalesInvoiceRawAdd`).

## Végpont

```
POST https://clientapi.imaerp.hu/invoices/sales/add/{ApiKey}
```

**Nincs `/api/` prefix** — ugyanaz a mintázat, mint minden más
`clientapi.imaerp.hu` alatti referencia-végpontnál.

## Fejlécek

| Fejléc | Érték |
|---|---|
| `company` | Cég HEX ID |
| `user` | Felhasználó neve |
| `process` | `upload` — a forrás külön kiemelte "(!!!)"-lel, könnyen kihagyható, pedig szükséges |

Külön `api-key` fejléc NEM szerepelt a példában — az API kulcs csak az
útvonalban megy.

## Kérés törzse (raw JSON)

```json
{
  "header_data": [
    {
      "invoice_external_id": "KAMU1",
      "partner_id": null,
      "partner": {
        "customers_company": "KAMU",
        "customers_code": null,
        "customers_vat_number": "12345678",
        "customers_vat_number_eu": "HU12345678",
        "customers_is_person": 0,
        "customers_is_eu": 0,
        "customers_status": 0,
        "bank_account": "1111-1111",
        "addresses": [
          {
            "entry_postcode": "9876",
            "entry_city": "KAMU",
            "entry_country": "KAMU",
            "entry_street_address": "KAMU",
            "entry_address_type": "KAMU"
          }
        ]
      },
      "address_id": null,
      "posting_date": "20260910",
      "doc_date": "20260910",
      "vat_date": "20260910",
      "due_date": "20260910",
      "invoice_type": "invoice",
      "currency": "HUF",
      "currency_id": 1,
      "exchange_rate": null,
      "gross_amount": 0,
      "payment_method_id": 1,
      "payment_method": "átutalás",
      "bank_id": 1,
      "ismanual": 1,
      "worknumber_id": null,
      "worknumber": null,
      "spend_place_id": null,
      "spend_place": null,
      "header_labels": null,
      "invoice_source": null,
      "lines_data": [
        {
          "unit_cost_type": "netto",
          "line_type": "invoice",
          "description": "KAMU",
          "unit_of_measure_id": 1,
          "unit_of_measure": "KAMU",
          "quantity": 1,
          "line_unit_cost": 10,
          "net_amount": 10,
          "vat_amount": 2.7,
          "gross_amount": 12.7,
          "gla_id": null,
          "gla_code": null,
          "vat_id": 1,
          "vat_code": "27%",
          "worknumber_id": null,
          "worknumber": null,
          "spend_place_id": 0,
          "spend_place": null,
          "line_labels": null
        }
      ]
    }
  ]
}
```

Megjegyzés a forrástól: "ezt értelemszerűen a megfelelő ima-id-kal kell
feltölteni (pl. pénznem, bankid, költséghely, munkaszám stb, ha valamire
nincs info, sokszor meg lehet próbálni null-t átadni az id-t és adni
hozzá egy értéket — elvileg létrehozza a soron következő worknumbert.
Ezt azért érdemes tesztelni."

## Válasz

```json
[
  {
    "success": true,
    "process": "insert",
    "invoice_id": "5643",
    "error": null
  }
]
```

Ez megegyezik a már dokumentált `SalesInvoiceResponseItem` sémával
(`docs/ima-api/openapi-clientapi.json`).

## Mit veszünk át ebből a saját implementációnkba

Ld. `docs/tervezes.md` 18. fejezet a teljes elemzésért. Röviden:
- Host+útvonal javítva `clientapi.imaerp.hu/invoices/sales/add`-ra.
- `process: upload` fejléc hozzáadva, `api-key` fejléc eltávolítva.
- `invoice_source: null` mostantól explicit mezőként szerepel.
- A többi, csak ebben a példában látott opcionális mezőt (numerikus
  ID-k a kód/szöveg mezők mellett, `customers_is_person`,
  `customers_vat_number_eu` stb.) EGYELŐRE NEM vettük át — a forrás
  szerint ezek nullázhatók/opcionálisak, és a jelenlegi payloadunk enélkül
  is a dokumentált séma szerint épül fel. Ha az élő teszt után is maradna
  hiba, ez a következő vizsgálandó kör.
