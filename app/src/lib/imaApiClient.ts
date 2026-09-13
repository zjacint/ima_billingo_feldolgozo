/**
 * IMA API kliens — kimenő (vevői) számla oldal. Ld. docs/tervezes.md 2.2,
 * 8. és 18. fejezet, valamint a referencia leírások:
 *   - docs/ima-api/sales-invoice-import-endpoint.md (a RÉGEBBI, elhagyott
 *     `/api/import/sales-invoice` beküldő végpont — ez tényleg az
 *     `imaapi.imaerp.hu` hoston van)
 *   - docs/ima-api/openapi-clientapi.json (glaaccounts/vatkeys/invoiceanalytics)
 *
 * ⚠️ 2026.09.10-i pontosítás: korábban két host volt dokumentálva, a
 * számla-beküldést az `imaapi.imaerp.hu`-hoz kötve — egy MEGERŐSÍTETT
 * működő referencia (ld. `pushSalesInvoiceRawAdd` doksztringje) szerint ez
 * TÉVES volt: a ténylegesen használt (és sikeresen tesztelt) nyers
 * beküldő végpont (`/invoices/sales/add`) is a **`clientapi.imaerp.hu`**
 * hoston van, "/api/" prefix NÉLKÜL — ugyanúgy, mint minden más
 * referencia-végpont ebben a fájlban. Az `IMA_SUBMIT_API_BASE_URL`
 * (`imaapi.imaerp.hu`) mostantól gyakorlatilag nem használt — csak a fent
 * hivatkozott, RÉGEBBI, elhagyott import-végponthoz tartozna, ha valaha
 * visszatérnénk hozzá.
 */

const IMA_SUBMIT_API_BASE_URL = process.env.IMA_SUBMIT_API_BASE_URL ?? "https://imaapi.imaerp.hu";
const IMA_CLIENT_API_BASE_URL = process.env.IMA_CLIENT_API_BASE_URL ?? "https://clientapi.imaerp.hu";

export interface ImaCredentials {
  apiKey: string;
  user: string;
  company: string;
}

export interface ImaGlaAccount {
  code: string;
  name: string;
}

/** A cég teljes számlatükrét kéri le (`/glaaccounts/{apikey}`). */
export async function fetchImaGlaAccounts(credentials: ImaCredentials): Promise<ImaGlaAccount[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/glaaccounts/${credentials.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
    body: new FormData(),
  });
  if (!res.ok) throw new Error(`IMA számlatükör lekérdezése sikertelen: HTTP ${res.status}`);

  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : body ? [body] : [];
  return list
    .map((a: Record<string, unknown>) => ({
      code: String(a.GLA_Code ?? "").trim(),
      name: String(a.GLA_Name ?? "").trim(),
    }))
    .filter((a) => a.code !== "");
}

export interface ImaVatKey {
  code: string;
  name: string;
  percent: number | null;
}

/** A cég ÁFA kulcs listáját kéri le (`/vatkeys/{apikey}`). */
export async function fetchImaVatKeys(credentials: ImaCredentials): Promise<ImaVatKey[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/vatkeys/${credentials.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
  });
  if (!res.ok) throw new Error(`IMA áfa kulcs lista lekérdezése sikertelen: HTTP ${res.status}`);

  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : body ? [body] : [];
  return list
    .map((v: Record<string, unknown>) => ({
      code: String(v.VAT_Code ?? "").trim(),
      name: String(v.VAT_Name ?? "").trim(),
      percent: v.VAT_Percent != null ? Number(v.VAT_Percent) : null,
    }))
    .filter((v) => v.code !== "");
}

export interface ImaPaymentMethod {
  id: number;
  desc: string;
  navPayMethodType: string | null;
}

/**
 * A cégnél IMA-ban ténylegesen létező fizetési módok listáját kéri le
 * (`/paymentmethod/get/{apikey}`) — a nyers beküldő végpont `payment_method`
 * mezője csak ezek egyikének a leírását (`PaymentM_Desc`) fogadja el, nem
 * egy generikus kódot (ld. `PaymentMethodMapping`).
 */
export async function fetchImaPaymentMethods(credentials: ImaCredentials): Promise<ImaPaymentMethod[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/paymentmethod/get/${credentials.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
  });
  if (!res.ok) throw new Error(`IMA fizetési mód lista lekérdezése sikertelen: HTTP ${res.status}`);

  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : body ? [body] : [];
  return list
    .map((p: Record<string, unknown>) => ({
      id: Number(p.PaymentM_ID),
      desc: String(p.PaymentM_Desc ?? "").trim(),
      navPayMethodType: p.PaymentM_NAVPayMethodType ? String(p.PaymentM_NAVPayMethodType).trim() : null,
    }))
    .filter((p) => Number.isFinite(p.id) && p.desc !== "");
}

export interface ImaPartner {
  id: number;
  name: string;
  taxNumber: string | null;
}

/**
 * Az IMA-ban rögzített partnerek listáját kéri le (`/partners/{apikey}`) —
 * ez adja az adószám-alapú párosítás alapját a tanuláshoz (ld.
 * docs/tervezes.md 9.4): a `PartnerID` (amit az `/invoiceanalytics` is
 * visszaad) itt kereshető vissza `Partner_VATRegHun` (adószám) értékre,
 * ami megbízhatóbb, mint a névre illesztés.
 */
export async function fetchImaPartners(
  credentials: ImaCredentials,
  { type = "customer" }: { type?: "all" | "vendor" | "customer" | "both" } = {}
): Promise<ImaPartner[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/partners/${credentials.apiKey}`;
  const form = new FormData();
  form.set("type", type);

  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
    body: form,
  });
  if (!res.ok) throw new Error(`IMA partnerlista lekérdezése sikertelen: HTTP ${res.status}`);

  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : body ? [body] : [];

  return list
    .map((p: Record<string, unknown>) => ({
      id: Number(p.Partner_ID),
      name: String(p.Partner_Name ?? ""),
      taxNumber: p.Partner_VATRegHun ? String(p.Partner_VATRegHun).trim() : null,
    }))
    .filter((p) => Number.isFinite(p.id) && p.id > 0);
}

export interface ImaSalesAnalyticsRow {
  partnerId: number | null;
  partnerName: string;
  /**
   * A számla száma (`InvoiceDocNo`) — a `/gladetails` kereszt-
   * ellenőrzéshez kell (ld. `fetchImaGlaDetails`, `learnFromInvoiceAnalytics`
   * "gladetails" szakasza): ott a megfelelő sor `InvoiceNo` mezőjével
   * párosítjuk, `description`-nel együtt.
   */
  invoiceNo: string | null;
  /**
   * Elsődlegesen az IMA `Item` (formális cikktörzs-tétel) mezőből jön, de
   * `PL_Desc`-re (szabad szöveges leírás) esik vissza, ha az üres — sok
   * cég nem használ formális cikktörzset, csak szabad szöveget ír a
   * tételsorra, ilyenkor `Item` mindig üres.
   */
  itemName: string;
  description: string;
  /**
   * A számla bizonylattípusa (`InvoiceDocType`) — a tanulási motor ezt is
   * bevonja a csoportosításba, hogy pl. előlegszámla-sorok külön szabályt
   * kapjanak (ld. docs/tervezes.md 9.4). ⚠️ Szótára nem élőben ellenőrzött
   * a Billingo `Document.type` értékeivel szemben.
   */
  invoiceDocType: string | null;
  /**
   * A `GLAID` mező adja a TÉNYLEGES árbevétel (eredmény-) kontírkódot (pl.
   * `"9112"` — a cégnél a 911-es tartomány a valódi árbevétel-kód-
   * tartomány), NEM a `Bal_Account_No` (az mindig `"311"`-nek, azaz
   * VEVŐI/követelés főkönyvi számnak bizonyult). A tanulási motor
   * (`mappingRuleEngine.ts`) ezért a `glaId`-t használja elsődlegesen a
   * `MappingRule.glaCode`-hoz, a `balAccountNo`-t (vevői főkönyvi szám)
   * NEM használjuk kontírként — csak megtartjuk referenciának.
   */
  glaId: number | null;
  /** Vevő (követelés) főkönyvi száma — NEM kontír, csak referencia (ld. `glaId` doksztringje). */
  balAccountNo: string | null;
  vatPercent: number | null;
  vatName: string | null;
  /**
   * A `GLA_CodeSales` mezőből — a "CODE - Név" formátumból csak a kódot
   * tartjuk meg. Ez a tétel ÁFA-postázásának KÜLÖN főkönyvi száma (pl.
   * `"4671"` — "Fizetendő ÁFA - belföld"), megkülönböztetve az
   * árbevétel-kontírtól (`glaId`) — ld. docs/tervezes.md 8.3.
   */
  vatGlaCode: string | null;
  /**
   * Az IMA-oldali számla SOR azonosítója (`lineID`, dokumentált mező a
   * `/invoiceanalytics` sémában) — ld. docs/tervezes.md 17. fejezet: a
   * Stripe-tranzakcióazonosító-import (`transactionIdImport.ts`) ezt
   * párosítja a felismert tranzakcióazonosítóval, `invoiceNo` alapján
   * megtalálva a hozzá tartozó sor(oka)t.
   */
  lineId: number | null;
}

/**
 * Korábbi kimenő (vevői) számlák soronkénti könyvelési analitikáját kéri le
 * (`/invoiceanalytics/{apikey}`, `invoicetype=sales`) — ez a tanulási
 * alapadat a `MappingRule` motorhoz (ld. docs/tervezes.md 9. fejezet).
 */
export async function fetchImaSalesInvoiceAnalytics(
  credentials: ImaCredentials,
  options: { fromDate?: string; untilDate?: string } = {}
): Promise<ImaSalesAnalyticsRow[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/invoiceanalytics/${credentials.apiKey}`;
  const form = new FormData();
  form.set("invoicetype", "sales");
  if (options.fromDate) form.set("from-date", options.fromDate);
  if (options.untilDate) form.set("until-date", options.untilDate);

  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
    body: form,
  });

  const bodyText = await res.text();
  if (!res.ok) throw new Error(`IMA számla analitika lekérdezése sikertelen: HTTP ${res.status}`);

  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(
      `IMA számla analitika válasza nem érvényes JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Elsődlegesen sima tömböt várunk (ugyanaz a minta, mint a többi IMA
  // client API végpontnál, ld. fetchImaGlaAccounts/fetchImaVatKeys/
  // fetchImaPartners) — de defenzívan kezeljük, ha a válasz mégis egy
  // { data: [...] } / { rows: [...] } alakú wrapperbe csomagolva jönne.
  const list: Record<string, unknown>[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown> | null)?.data)
      ? ((body as Record<string, unknown>).data as Record<string, unknown>[])
      : Array.isArray((body as Record<string, unknown> | null)?.rows)
        ? ((body as Record<string, unknown>).rows as Record<string, unknown>[])
        : body
          ? [body as Record<string, unknown>]
          : [];

  return list.map((r: Record<string, unknown>) => {
    // Sok cég nem használ formális IMA cikktörzset — az `Item` mező
    // ilyenkor mindig üres, a tényleges tétel-leírás a szabad szöveges
    // `PL_Desc`-ben van. Terméknévnek ezért az `Item`-et preferáljuk, de
    // `PL_Desc`-re esünk vissza, ha az üres — enélkül a tanulás soha nem
    // talál "itemName"-mel rendelkező sort ilyen cégeknél.
    const itemFromCatalog = r.Item != null && String(r.Item).trim() !== "" ? String(r.Item).trim() : "";
    const description = String(r.PL_Desc ?? "").trim();
    // "4671 - Fizetendő ÁFA - belföld" -> "4671" (csak a vezető kód kell).
    const glaCodeSalesRaw = r.GLA_CodeSales != null ? String(r.GLA_CodeSales).trim() : "";
    const vatGlaCode = glaCodeSalesRaw ? glaCodeSalesRaw.split(" - ")[0]!.trim() : null;
    return {
      partnerId: r.PartnerID != null ? Number(r.PartnerID) : null,
      partnerName: String(r.Partner ?? "").trim(),
      invoiceNo: r.InvoiceDocNo ? String(r.InvoiceDocNo).trim() : null,
      itemName: itemFromCatalog || description,
      description,
      invoiceDocType: r.InvoiceDocType ? String(r.InvoiceDocType).trim() : null,
      glaId: r.GLAID != null ? Number(r.GLAID) : null,
      balAccountNo: r.Bal_Account_No != null ? String(r.Bal_Account_No).trim() : null,
      vatPercent: r.PL_VATPercent != null ? Number(r.PL_VATPercent) : null,
      vatName: r.VatL_Name ? String(r.VatL_Name).trim() : null,
      vatGlaCode: vatGlaCode || null,
      lineId: r.lineID != null ? Number(r.lineID) : null,
    };
  });
}

export interface ImaGlaDetailRow {
  /** A tényleges kontírkód — közvetlenül a `GLA_Code` mezőből, NEM egy `/glaaccounts`-szal feloldandó ID. */
  glaCode: string;
  invoiceNo: string;
  /** A könyvelési tétel szabad szöveges leírása — jellemzően a számlatétel neve/megjegyzése. */
  description: string;
  /** A vevői számla IMA-oldali azonosítója (`SalesHeaderID`, `show_inv_header_ID=1` mellett) — ld. `Invoice.imaSalesheaderId`. */
  salesHeaderId: number | null;
}

/**
 * Főkönyvi kivonat (`/gladetails/{apikey}`) — ld. docs/tervezes.md 12.
 * fejezet ("pontosabb, de meg nem épített tanulási forrás") és 13.
 * fejezet. A `/invoiceanalytics` `GLAID`-jével szemben (ami egy azonosító,
 * amit a `/glaaccounts` listával kell kódra feloldani/validálni) ez a
 * végpont KÖZVETLENÜL a tényleges kontírkódot (`GLA_Code`) adja vissza,
 * számla-azonosítóval összekötve. A `show_line_ID=1`/`show_inv_header_ID=1`
 * paraméterek kérik a számlasor- (`BookL_SalesLineID`/`BookL_PurchaseLineID`)
 * és számla-azonosítót (`SalesHeaderID`/`PurchaseHeaderID`) — ezek a mező-
 * nevek a kérés-séma paraméter-leírásából valók, a statikus válasz-séma nem
 * sorolja fel őket explicit módon (feltételesen jelennek meg).
 *
 * A végpont vevői ÉS szállítói tételeket EGYÜTT adja vissza (nincs `type`
 * szűrő, mint az `/invoicesandequalisations`-nál) — ezért csak azokat a
 * sorokat tartjuk meg, amikhez van `SalesHeaderID` (vevői oldal); a
 * szállítói sorokon ehelyett `PurchaseHeaderID` jönne, azt nem kérjük le
 * itt. A `learnFromInvoiceAnalytics` ezt kereszt-ellenőrzésre/preferált
 * forrásként használja `invoiceNo`+`description` alapján párosítva az
 * `/invoiceanalytics` sorokhoz (ld. ott) — NEM próbál a bizonytalan
 * `BookL_SalesLineID`/analitika-`lineID` értékek közötti (nem megerősített)
 * azonosság-feltételezésre építeni.
 */
export async function fetchImaGlaDetails(
  credentials: ImaCredentials,
  options: { fromDate?: string; untilDate?: string } = {}
): Promise<ImaGlaDetailRow[]> {
  const url = `${IMA_CLIENT_API_BASE_URL}/gladetails/${credentials.apiKey}`;
  const form = new FormData();
  form.set("show_line_ID", "1");
  form.set("show_inv_header_ID", "1");
  form.set("show-docdate", "1");
  if (options.fromDate) form.set("from-date", options.fromDate);
  if (options.untilDate) form.set("until-date", options.untilDate);

  const res = await fetch(url, {
    method: "POST",
    headers: { user: credentials.user, company: credentials.company },
    body: form,
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`IMA főkönyvi kivonat lekérdezése sikertelen: HTTP ${res.status}`);

  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(
      `IMA főkönyvi kivonat válasza nem érvényes JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const list: Record<string, unknown>[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown> | null)?.data)
      ? ((body as Record<string, unknown>).data as Record<string, unknown>[])
      : Array.isArray((body as Record<string, unknown> | null)?.rows)
        ? ((body as Record<string, unknown>).rows as Record<string, unknown>[])
        : body
          ? [body as Record<string, unknown>]
          : [];

  return list
    .filter((r) => r.SalesHeaderID != null)
    .map((r) => ({
      glaCode: String(r.GLA_Code ?? "").trim(),
      invoiceNo: String(r.InvoiceNo ?? "").trim(),
      description: String(r.Description ?? "").trim(),
      salesHeaderId: r.SalesHeaderID != null ? Number(r.SalesHeaderID) : null,
    }))
    .filter((r) => r.glaCode !== "" && r.invoiceNo !== "");
}

export interface ImaInvoicePdf {
  buffer: Buffer;
  contentType: string;
}

/**
 * Egy már beküldött vevői számla IMA-oldali PDF-jét kéri le vissza
 * (`GET /invoices/{id}/{apikey}`, clientapi host) — ellenőrzésre: hogy
 * ténylegesen úgy jött-e létre a számla IMA-ban, ahogy beküldtük (ld.
 * docs/tervezes.md 13. fejezet, "IMA-beküldés ellenőrzése"). Az `id` az
 * IMA-oldali számla-azonosító — nálunk `Invoice.imaSalesheaderId` (a nyers
 * beküldés válaszának `invoice_id` mezője, ld. `pushSalesInvoiceRawAdd`).
 *
 * A dokumentált válasz-leírás ("Returns the invoice PDF coding") nem
 * egyértelmű: lehet nyers bináris PDF, vagy egy base64-kódolt mezőt
 * tartalmazó JSON — mindkettőt kezeljük, `content-type` alapján döntve,
 * JSON esetén pedig a szokásos mezőnevek (`pdf`/`file`/`content`/`base64`)
 * közül az elsőt használva.
 */
export async function fetchImaInvoicePdf(
  credentials: ImaCredentials,
  imaInvoiceId: number
): Promise<ImaInvoicePdf> {
  const url = `${IMA_CLIENT_API_BASE_URL}/invoices/${imaInvoiceId}/${credentials.apiKey}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { user: credentials.user, company: credentials.company, Accept: "application/pdf, application/json" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`IMA számla-visszakérdezés sikertelen: HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const base64 =
      (body?.pdf as string | undefined) ??
      (body?.file as string | undefined) ??
      (body?.content as string | undefined) ??
      (body?.base64 as string | undefined);
    if (!base64) {
      throw new Error("IMA számla-visszakérdezés JSON választ adott, de nem található benne PDF tartalom.");
    }
    return { buffer: Buffer.from(base64, "base64"), contentType: "application/pdf" };
  }

  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: contentType || "application/pdf" };
}

// --- Beküldés: /api/invoices/sales/add (nyers végpont) -----------------
//
// A `/api/import/sales-invoice` végpont IMA-oldali szerverhibába ütközik
// éles beküldésnél (HTTP 422, "Column 'import_batch_id' cannot be null" a
// saját `incoming_invoices` staging/transfer lépésükben). Ezért a nyers
// `/api/invoices/sales/add/{apikey}` végpontot használjuk elsődlegesen.
// ⚠️ 2026.08.14-i élő teszttel megerősítve: EZ A HIBA A NYERS VÉGPONTON IS
// jelentkezett — az `INSERT INTO incoming_invoices (import_batch_id, ...,
// salesheader_id, ...)` szerint a nyers út is ír egy sort ugyanabba a
// staging táblába (valószínűleg egy közös, mindkét beküldő útvonalon
// lefutó audit/napló lépés), csak épp a `source`-hoz ("direct_apicall")
// tartozó `import_batch_id` generálása hiányzik — tehát ez korábbi
// állítással ELLENTÉTBEN NEM biztos, hogy elkerüli a hibát. A `partner_id`
// (ismert IMA partner) preferálása egy még élőben nem megerősített
// kísérleti javítás — ld. docs/tervezes.md 12. fejezet a részletekért és a
// nyitott kockázatért (a `salesheader_id` oszlop jelenléte a hibás
// INSERT-ben arra utal, hogy a tényleges számla ilyenkor már létrejöhetett,
// mielőtt ez a másodlagos írás elhasalna — retry előtt ezt ellenőrizni
// kell).
//
// A mezőnevek forrása: `docs/ima-api/openapi-clientapi.json`
// (`SalesInvoiceRequest`/`SalesInvoiceHeader`/`SalesInvoiceLine` séma) — ez
// a szerver saját, generált OpenAPI leírása, megbízhatóbb, mint a
// `docs/ima-api/postman-sales-invoice-add.json` néhány mintapéldája, ami
// NEM mutatott `gla_code` mezőt, de az OpenAPI séma szerint a
// `SalesInvoiceLine.gla_code` (nullable string) ténylegesen létező,
// dokumentált mező — tehát a kontír-felülbírálás ezen a végponton is
// működik, csak a Postman-példák nem tértek ki rá.
export interface ImaSalesInvoiceLine {
  productOrServiceName: string;
  quantity: number;
  unitOfMeasure: string | null;
  netUnitCost: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  /** A jóváhagyott IMA áfa kód (`MappingRule.vatCode`/`VatCodeMapping.imaVatCode`) — ld. docs/tervezes.md 8.2. */
  vatCode: string;
  /** A jóváhagyott IMA kontír (`MappingRule.glaCode`) — a `SalesInvoiceLine.gla_code` mezőbe megy. */
  glaCode: string | null;
}

export interface ImaSalesInvoiceHeader {
  /** Az IMA duplikáció-védelme erre (+ `postingDate`) fut — nálunk a Billingo dokumentum-azonosító. */
  invoiceExternalId: string;
  invoiceType: "invoice" | "creditentr" | "storno";
  /** `YYYYMMDD` formátum — ld. `SalesInvoiceHeader.posting_date` minta a sémában. */
  docDate: string;
  postingDate: string;
  vatFulfillmentDate: string;
  dueDate: string;
  paymentMethod: string;
  currencyCode: string;
  exchangeRate: number | null;
  grossAmount: number;
  partnerName: string;
  vatRegNumber: string | null;
  postalCode: string | null;
  city: string | null;
  addrStreet: string | null;
  countryCode: string | null;
  /**
   * Egy már ISMERT, létező IMA partner azonosítója (`Partner.imaPartnerCode`,
   * ld. Partnerek oldal) — ha ismert, EZT küldjük a `partner: {...}`
   * objektum HELYETT (a kettő a séma szerint alternatíva, nem egyszerre
   * adandó — "kötelező létező partner_id, VAGY partner objektum, ha IMA fel
   * tudja oldani"). Gyanú (2026.08.14, élő `import_batch_id` hiba nyomán):
   * lehet, hogy a `partner: {...}` objektumos, automatikus feloldást/
   * létrehozást igénylő út az, ami IMA-oldalon a staging (`incoming_invoices`)
   * táblán megy át — a `partner_id`-s út esetleg elkerüli ezt. Élő teszttel
   * kell megerősíteni.
   */
  partnerId: number | null;
  lines: ImaSalesInvoiceLine[];
}

function buildRawInvoicePayload(header: ImaSalesInvoiceHeader) {
  const hasFullAddress = Boolean(header.postalCode && header.city && header.addrStreet);

  const headerData: Record<string, unknown> = {
    invoice_external_id: header.invoiceExternalId,
    ...(header.partnerId != null
      ? { partner_id: header.partnerId }
      : {
          partner: {
            customers_company: header.partnerName,
            ...(header.vatRegNumber ? { customers_vat_number: header.vatRegNumber } : {}),
            addresses: hasFullAddress
              ? [
                  {
                    entry_postcode: header.postalCode,
                    entry_city: header.city,
                    entry_country: header.countryCode ?? "HU",
                    entry_street_address: header.addrStreet,
                    entry_address_type: "invoice",
                  },
                ]
              : [],
          },
        }),
    posting_date: header.postingDate,
    doc_date: header.docDate,
    vat_date: header.vatFulfillmentDate,
    due_date: header.dueDate,
    invoice_type: header.invoiceType,
    currency: header.currencyCode,
    gross_amount: header.grossAmount,
    payment_method: header.paymentMethod,
    // Egy megerősítetten működő élő példában (ld. `pushSalesInvoiceRawAdd`
    // doksztringje) ez a mező explicit `null`-lal szerepel, nem hiányzik —
    // ugyanazt tesszük, hogy a payload alakja a lehető legközelebb legyen
    // a bizonyítottan sikeres híváshoz.
    invoice_source: null,
    lines_data: header.lines.map((line) => {
      const lineData: Record<string, unknown> = {
        unit_cost_type: "netto",
        line_type: header.invoiceType,
        description: line.productOrServiceName,
        quantity: line.quantity,
        line_unit_cost: line.netUnitCost,
        // Mindig explicit összegek — ld. docs/tervezes.md 8.2, a szállítói
        // oldali tanulság (hiányzó összeg -> váratlan áfa/kerekítés sor)
        // miatt itt is óvatosságból; a séma szerint explicit összegnél
        // nincs automatikus kerekítés-sor beszúrás.
        net_amount: line.netAmount,
        vat_amount: line.vatAmount,
        gross_amount: line.grossAmount,
        vat_code: line.vatCode,
      };
      if (line.unitOfMeasure) lineData.unit_of_measure = line.unitOfMeasure;
      if (line.glaCode) lineData.gla_code = line.glaCode;
      return lineData;
    }),
  };
  if (header.exchangeRate != null) headerData.exchange_rate = header.exchangeRate;

  return { header_data: [headerData] };
}

export interface ImaSalesInvoiceSubmitResult {
  success: boolean;
  duplicate: boolean;
  /** A létrejött IMA számla azonosítója (`SalesInvoiceResponseItem.invoice_id`). */
  imaInvoiceId: number | null;
  error: string | null;
}

/**
 * Egyetlen számlát küld be a `/invoices/sales/add/{apikey}` nyers
 * végponton.
 *
 * ⚠️ 2026.09.10-i javítás, MEGERŐSÍTETT működő referencia alapján (Freier
 * Dávid emailje, "IMA API - számla beszúrás tisztázva", saját sikeres élő
 * teszttel — KAMU1/KAMU2 számlák ténylegesen létrejöttek IMA-ban): a
 * végpont a **`clientapi.imaerp.hu`** hoston van, **`/api/` prefix
 * NÉLKÜL** — ugyanaz a mintázat, mint az összes többi referencia-végpont
 * ebben a fájlban (`/glaaccounts`, `/partners` stb.), NEM a korábban
 * feltételezett `imaapi.imaerp.hu/api/invoices/sales/add`. Ez alighanem
 * megmagyarázza a hosszan vizsgált `import_batch_id`
 * (`incoming_invoices` staging) hibát is — ha a régi, rossz host/útvonal
 * egy elavult/legacy kódúton ment keresztül IMA-oldalon, ami még mindig
 * az import-staging logikát futtatta, míg ez a (helyes) végpont ezt
 * elkerüli. A korábbi `partner_id` vs. `partner` objektum elmélet emiatt
 * valószínűleg tévút volt — a hiba oka feltehetően egyszerűen a hibás
 * host/útvonal volt, nem a partner-feloldás módja.
 *
 * A megerősített példában a fejléc-headerek: `company`, `user`, ÉS
 * **`process: upload`** (a forrás explicit kiemelte "(!!!)"-lel, könnyen
 * kihagyható, pedig szükséges) — külön `api-key` header NEM szerepelt (az
 * API kulcs csak az útvonalban megy, ugyanúgy, mint a többi clientapi
 * hívásnál ebben a fájlban).
 *
 * A válasz egy tömb (egy elem számlánként) — mivel mindig pontosan egy
 * számlát küldünk kérésenként, csak az első elemet olvassuk. Duplikált
 * beküldésnél (azonos `invoice_external_id` + `posting_date`) a végpont
 * dokumentáltan HTTP 409-et ad.
 */
export async function pushSalesInvoiceRawAdd(
  credentials: ImaCredentials,
  header: ImaSalesInvoiceHeader
): Promise<ImaSalesInvoiceSubmitResult> {
  const url = `${IMA_CLIENT_API_BASE_URL}/invoices/sales/add/${credentials.apiKey}`;
  const payload = buildRawInvoicePayload(header);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        user: credentials.user,
        company: credentials.company,
        process: "upload",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      success: false,
      duplicate: false,
      imaInvoiceId: null,
      error: `IMA API hívás sikertelen (hálózati hiba): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 409) {
    return {
      success: false,
      duplicate: true,
      imaInvoiceId: null,
      error: "A számla korábban már be lett küldve (azonos külső azonosító + könyvelési dátum).",
    };
  }

  const bodyText = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // hagyjuk null-on, alább HTTP-hiba vagy "váratlan válasz" üzenet lesz
  }

  if (!res.ok || body == null) {
    return {
      success: false,
      duplicate: false,
      imaInvoiceId: null,
      error: `IMA API HTTP ${res.status}: ${bodyText.slice(0, 500)}`,
    };
  }

  const items = Array.isArray(body) ? body : [body];
  const item = items[0] as Record<string, unknown> | undefined;
  if (!item) {
    return {
      success: false,
      duplicate: false,
      imaInvoiceId: null,
      error: "Üres/váratlan IMA válasz.",
    };
  }

  const success = Boolean(item.success);
  const invoiceId = item.invoice_id != null ? Number(item.invoice_id) : null;

  return {
    success,
    duplicate: false,
    imaInvoiceId: Number.isFinite(invoiceId) ? invoiceId : null,
    error: success ? null : String(item.error ?? "Ismeretlen IMA hiba."),
  };
}

// --- Számlakép csatolás: /files/upload (clientapi host) -----------------

export interface ImaFileUploadResult {
  ok: boolean;
  error: string | null;
}

/**
 * Fájlt csatol egy meglévő IMA rekordhoz (`POST /files/upload/{apikey}`,
 * clientapi host). Az `upload_tablename`/`upload_recID` mezőpár mondja meg,
 * melyik rekordhoz kerüljön — ha üresen hagynánk, a fájl a generic
 * "online mappába" kerülne, csatolás nélkül (ld. IMA openapi doksi). A
 * `file` mező nyers bájtokat vár, multipart/form-data-ban — nincs
 * link/URL alapú feltöltési lehetőség, a fájlt előbb le kell tölteni.
 */
export async function uploadFileToIma(
  credentials: ImaCredentials,
  params: { uploadTablename: string; uploadRecId: string; fileBuffer: Buffer; fileName: string; mimeType: string }
): Promise<ImaFileUploadResult> {
  const url = `${IMA_CLIENT_API_BASE_URL}/files/upload/${credentials.apiKey}`;
  const form = new FormData();
  form.set("upload_tablename", params.uploadTablename);
  form.set("upload_recID", params.uploadRecId);
  form.set("file", new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType }), params.fileName);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { user: credentials.user, company: credentials.company },
      body: form,
    });
  } catch (err) {
    return {
      ok: false,
      error: `IMA fájlfeltöltés sikertelen (hálózati hiba): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, error: `IMA fájlfeltöltés HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
  }
  return { ok: true, error: null };
}

/**
 * A kimenő számla PDF-jét csatolja a már beküldött IMA vevői számlához.
 * ⚠️ `upload_tablename: "SalesHeader"` — ANALÓGIA a testvérprojekt
 * (beszerzési oldal) "PurchaseHeader" feltételezésével, ÉLŐBEN MÉG NEM
 * MEGERŐSÍTVE (a testvérprojekt saját táblaneve is csak feltételezés volt,
 * sosem tesztelték élesben végig) — az IMA openapi sémája nem sorolja fel
 * az érvényes `upload_tablename` értékeket. Az első sikeres feltöltésnél
 * IMA oldalon kell ellenőrizni, hogy a kép ténylegesen a számlához került-e,
 * nem csak a generic online mappába.
 */
export async function uploadSalesInvoiceImageToIma(
  credentials: ImaCredentials,
  imaSalesheaderId: number,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ImaFileUploadResult> {
  return uploadFileToIma(credentials, {
    uploadTablename: "SalesHeader",
    uploadRecId: String(imaSalesheaderId),
    fileBuffer,
    fileName,
    mimeType,
  });
}
