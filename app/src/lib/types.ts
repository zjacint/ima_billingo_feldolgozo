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
  suggestedRuleSource: "learned_invoiceanalytics" | "manual" | "vat_mapping" | "advance_reference" | null;
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
}

export function invoiceIsFullyClassified(lines: InvoiceLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.approvedGlaCode && l.approvedVatCode);
}

/**
 * Egy partner "elég kész"-e a beküldéshez — ld. docs/tervezes.md 6.
 * fejezet, 2026.08.16-i pontosítás (könyvelői visszajelzés): ha a
 * partnerhez már van ISMERT IMA azonosító (`imaPartnerCode`, akár kézi,
 * akár automatikus adószám-/névalapú párosításból, ld. Partnerek oldal),
 * a beküldés a `partner_id`-s utat használja (ld. `submitInvoiceToIma`),
 * aminek NINCS szüksége teljes Billingo-oldali adószámra/számlázási címre
 * — ezért ilyenkor a hiányos Billingo-adat NEM ok a `needs_review`
 * státuszra/tömeges jóváhagyás blokkolására. Csak akkor kötelező a teljes
 * adószám+cím, ha nincs ismert IMA-partner (ilyenkor a `partner: {...}`
 * objektumos automatikus feloldás/létrehozás fut, aminek ez tényleg kell).
 */
export function isPartnerReadyForSubmission(
  partner: {
    imaPartnerCode?: string | null;
    taxNumber: string | null;
    postalCode: string | null;
    city: string | null;
    addressStreet: string | null;
  } | null
): boolean {
  if (!partner) return false;
  if (partner.imaPartnerCode) return true;
  return Boolean(partner.taxNumber && partner.postalCode && partner.city && partner.addressStreet);
}
