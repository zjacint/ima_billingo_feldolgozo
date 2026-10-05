export type AmountSign = "original" | "negative";

/**
 * Egy Invoice.lines tömb eleme (JSON mező, ld. prisma/schema.prisma). A
 * Billingo `DocumentItem`-ből töltődik (ld. src/lib/billingoApiClient.ts),
 * a `suggested*` mezőket a MappingRule motor tölti ki szinkronkor (ld.
 * src/lib/mappingRuleEngine.ts), az `approved*` mezők a könyvelő
 * jóváhagyott (esetleg felülírt) értékei — beküldéskor ez utóbbiak mennek
 * ki `line_gla_code`/`line_vat_code` felülbírálásként, ill. `amountSign:
 * negative` esetén előjelet váltva (ld. docs/tervezes.md 8.2, 9.2).
 */
export interface InvoiceLine {
  productName: string;
  /** A Billingo tétel saját megjegyzése — `commentPattern` szabályok ezt (is) illesztik. */
  comment: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  netUnitCost: number;
  /** A Billingo `Vat` mező eredeti értéke (pl. "27%", "AAM") — ld. docs/tervezes.md 8.3. */
  vatPercentOrCode: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  suggestedGlaCode: string | null;
  suggestedVatCode: string | null;
  /** Külön ÁFA főkönyvi szám, csak megjelenítésre/ellenőrzésre — ld. docs/tervezes.md 8.3. */
  suggestedVatGlaCode: string | null;
  suggestedAmountSign: AmountSign | null;
  suggestedRuleSource:
    | "learned_invoiceanalytics"
    | "manual"
    | "vat_mapping"
    | "advance_reference"
    | "cancellation_reference"
    | "modification_reference"
    | null;
  /** A ténylegesen illeszkedő MappingRule azonosítója/összefoglalója — "milyen szabály futott le rá". */
  suggestedRuleId: string | null;
  suggestedRuleSummary: string | null;
  /**
   * A győztes szabály `productNamePattern`/`vatPattern` feltétele csak
   * RÉSZLEGES (substring) egyezéssel talált rá erre a tételre — a
   * `suggestedInexactMatchValue` a tétel tényleges, szó szerint még a
   * mintában nem szereplő értéke. `null`, ha a győztes szabály nem ilyen
   * feltétellel talált, vagy a pontos érték már szó szerint benne van a
   * mintában — ld. docs/tervezes.md 9.4.2.
   */
  suggestedInexactMatchField: "productNamePattern" | "vatPattern" | null;
  suggestedInexactMatchValue: string | null;
  approvedGlaCode: string | null;
  approvedVatCode: string | null;
  approvedVatGlaCode: string | null;
  /** null = még nincs jóváhagyva, ilyenkor beküldéskor "original"-ként kezelendő. */
  approvedAmountSign: AmountSign | null;
  /**
   * Adójogi megfelelőségi figyelmeztetések erre a sorra — ld.
   * `invoiceCompliance.ts` `checkLineCompliance`, docs/tervezes.md 19.
   * fejezet. Üres/`null`, ha nincs probléma. FIGYELMEZTETÉS jellegű (mint
   * az árfolyam-eltérés), NEM blokkolja a beküldést — csak felülvizsgálatra
   * kényszerít (`needs_review` marad, tömeges jóváhagyásból kimarad).
   */
  complianceWarnings: string[] | null;
}

export function invoiceIsFullyClassified(lines: InvoiceLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.approvedGlaCode && l.approvedVatCode);
}

/** `true`, ha legalább egy tételsornak van megfelelőségi figyelmeztetése — ld. `checkLineCompliance`. */
export function invoiceHasComplianceWarning(lines: InvoiceLine[]): boolean {
  return lines.some((l) => l.complianceWarnings && l.complianceWarnings.length > 0);
}

/**
 * A partner magánszemély-e — a Billingo `tax_type` EXPLICIT besorolása
 * alapján (`"NO_TAX_NUMBER"`, ld. docs/tervezes.md 25. fejezet), NEM a
 * hiányzó adószámból való következtetésből: egy vállalkozásnál a hiányzó
 * adószám lehet egyszerű Billingo-oldali adathiány is, nem feltétlenül
 * magánszemély — a `tax_type` ezt megbízhatóan megkülönbözteti. Ha a
 * `taxType` még nincs kitöltve (régebbi, e mező bevezetése előtti
 * szinkronból származó adat), a korábbi heurisztikára (nincs adószám)
 * esik vissza.
 */
export function isPartnerPrivateIndividual(
  partner: { taxType?: string | null; taxNumber: string | null } | null
): boolean {
  if (!partner) return false;
  if (partner.taxType) return partner.taxType === "NO_TAX_NUMBER";
  return !partner.taxNumber;
}

/**
 * Egy partner "elég kész"-e a beküldéshez — ld. docs/tervezes.md 6.
 * fejezet, 2026.08.16-i pontosítás (könyvelői visszajelzés): ha a
 * partnerhez már van ISMERT IMA azonosító (`imaPartnerCode`, akár kézi,
 * akár automatikus adószám-/névalapú párosításból, ld. Partnerek oldal),
 * a beküldés a `partner_id`-s utat használja (ld. `submitInvoiceToIma`),
 * aminek NINCS szüksége teljes Billingo-oldali adószámra/számlázási címre
 * — ezért ilyenkor a hiányos Billingo-adat NEM ok a `needs_review`
 * státuszra/tömeges jóváhagyás blokkolására. Ha nincs ismert IMA-partner,
 * a `partner: {...}` objektumos automatikus feloldás/létrehozás fut,
 * aminek a TELJES CÍM mindig kell — az adószám viszont csak akkor, ha a
 * partner NEM magánszemély (ld. `isPartnerPrivateIndividual`,
 * 2026.09.17-i pontosítás, könyvelői visszajelzés: "itt a partner típus a
 * fontos... az adószám csak vállalkozások esetén megadandó adat" — az IMA
 * payload-nak ténylegesen sincs szüksége adószámra az automatikus
 * létrehozáshoz, csak a címre).
 */
export function isPartnerReadyForSubmission(
  partner: {
    imaPartnerCode?: string | null;
    taxNumber: string | null;
    taxType?: string | null;
    postalCode: string | null;
    city: string | null;
    addressStreet: string | null;
  } | null
): boolean {
  if (!partner) return false;
  if (partner.imaPartnerCode) return true;
  const hasFullAddress = Boolean(partner.postalCode && partner.city && partner.addressStreet);
  if (!hasFullAddress) return false;
  return isPartnerPrivateIndividual(partner) || Boolean(partner.taxNumber);
}
