/**
 * Fizetési szolgáltatói (pl. Stripe) tranzakcióazonosítók felismerése a
 * Billingo számla fejléc- vagy tétel-megjegyzésében — ld. docs/tervezes.md
 * 13. fejezet, könyvelői döntés (2026.08.16): a felismert azonosító NEM
 * kerül ki az IMA beküldésben (a számla tételadatait nem módosítja),
 * kizárólag egy KÜLÖN kiegyenlítési export CSV forrása
 * (ld. settlementExport.ts). Az egyeztetés maga (a Stripe kivonat elleni
 * tényleges párosítás) könyvelői feladat, ezt a rendszer nem végzi el.
 *
 * A minta a Stripe objektum-azonosító formátumát követi (`<prefix>_<token>`,
 * pl. "ch_3TrXrd01K0BjEwpQ1xbhzzw6") — élő Stripe kivonat-mintákból
 * (`transfers_2026.07.*.xlsx`) megerősítve: `Charge`/`Refund`/`Adjustment`/
 * `Stripe Fee` sortípusok rendre `ch_`/`ch_`/`ad_`/`finvp_` prefixű
 * azonosítót hordoznak. Az ismert Stripe-prefixek halmaza NEM kimerítő —
 * ha egy prefix nem szerepel benne, az azonosítót akkor is felismerjük
 * ("ismeretlen" szolgáltatóként), hogy más (pl. PayPal) formátumra is
 * bővíthető legyen később, bejelentés nélkül elveszett jelzés nélkül.
 */

const KNOWN_STRIPE_PREFIXES = new Set([
  "ch", "pi", "py", "in", "sub", "cus", "re", "po", "txn", "tr", "evt", "src", "card", "ba", "cs", "seti", "pm", "ad", "finvp",
]);

/** `<prefix>_<14+ karakteres alfanumerikus token>` — kis/nagybetű-független. */
const TRANSACTION_ID_PATTERN = /\b([a-zA-Z]{2,6})_([A-Za-z0-9]{14,})\b/;

export interface DetectedPaymentTransaction {
  processor: string;
  transactionId: string;
}

/** Egyetlen szövegben (megjegyzésben) keres tranzakcióazonosítót. `null`, ha nincs találat. */
export function detectPaymentTransactionId(text: string | null | undefined): DetectedPaymentTransaction | null {
  if (!text) return null;
  const match = text.match(TRANSACTION_ID_PATTERN);
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return {
    processor: KNOWN_STRIPE_PREFIXES.has(prefix) ? "stripe" : "ismeretlen",
    transactionId: match[0],
  };
}

/**
 * Egy teljes számla fejléc- ÉS tétel-megjegyzéseit vizsgálja, az első
 * találatot adja vissza — ld. docs/tervezes.md 13. fejezet ("billingo
 * számla megjegyzés és tétel megjegyzés felismerések"). A fejléc-megjegyzés
 * elsőbbséget élvez, mert jellemzően ott rögzítik a tranzakcióazonosítót,
 * de egy tétel-szintű megjegyzésben lévő találatot sem hagyunk figyelmen
 * kívül.
 */
export function detectInvoicePaymentTransaction(
  headerComment: string | null | undefined,
  lineComments: (string | null | undefined)[]
): DetectedPaymentTransaction | null {
  const header = detectPaymentTransactionId(headerComment);
  if (header) return header;
  for (const comment of lineComments) {
    const found = detectPaymentTransactionId(comment);
    if (found) return found;
  }
  return null;
}
