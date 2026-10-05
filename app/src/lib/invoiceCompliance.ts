/**
 * Adójogi megfelelőségi ellenőrzések számlatételekre — ld. docs/tervezes.md
 * 19. fejezet, könyvelői kérés (2026.09.13): "a könyvelés során több olyan
 * pont van, amit a kimenő számlák kapcsán ellenőrizni kell... ezt szeretném
 * megfogni, egy ellenőrzési pontot betenni a számlák feldolgozása,
 * kontírozása és az IMA felé történő feladása előtt." Könyvelői döntés:
 * FIGYELMEZTETÉS jellegű (ugyanaz a súlyosság, mint az árfolyam-eltérés
 * ellenőrzésnél, ld. exchangeRate.ts) — NEM blokkolja a beküldést, csak
 * felülvizsgálatra kényszerít (a számla `needs_review` marad, tömeges
 * jóváhagyásból kimarad).
 *
 * Ez a modul SZÁNDÉKOSAN néhány önálló, egymástól független ellenőrző
 * függvényből áll, NEM egy általános, konfigurálható szabály-motorból — a
 * könyvelő jelezte, hogy idővel több hasonló ellenőrzés jön még (pl.
 * pénzforgalmi áfás jelzés kötelezettsége), de azokat is inkább újabb,
 * hasonlóan egyszerű, önálló függvényként érdemes hozzáadni, nem egy
 * előre túltervezett, általános kereten keresztül.
 */

/**
 * A Billingo `Vat` mező PUSZTA "0%" értéke (nem AAM/TAM/EU/EUK/MAA/ÁKK/
 * F.AFA/FAD/K.AFA/AM vagy egyéb elismert NAV-kód, ld. docs/tervezes.md 2.1)
 * — sokan egyszerűen "0%"-ot írnak a számlára attól függetlenül, hogy
 * alanyi adómentes, tárgyi adómentes vagy egyéb okból nem tartalmaz áfát a
 * tétel. Ez önmagában nem feltétlenül hiba, de a pontos jogcímet
 * (kódot) tisztázni kellene a NAV adatszolgáltatás miatt.
 */
export function isAmbiguousZeroPercent(vatValue: string): boolean {
  return vatValue.trim().replace(/\s+/g, "") === "0%";
}

export interface LineComplianceContext {
  vatPercentOrCode: string;
  /** ld. `VatCodeMapping.isReverseCharge` — a Billingo áfa érték fordított áfás kulcsnak van-e jelölve. */
  isReverseCharge: boolean;
  /** A partner magánszemély (nincs adószáma) — ld. `isPartnerReadyForSubmission`/partners/auto-match ugyanezen konvenciója. */
  partnerIsPrivateIndividual: boolean;
  /** A tétel előlegszámlán van-e (`documentType === "advance"`). */
  isAdvanceDocument: boolean;
}

/**
 * Egy tételsorra vonatkozó megfelelőségi figyelmeztetéseket adja vissza —
 * üres tömb, ha nincs probléma. Több figyelmeztetés is egyszerre
 * felmerülhet ugyanarra a sorra.
 */
export function checkLineCompliance(context: LineComplianceContext): string[] {
  const warnings: string[] = [];

  if (context.isReverseCharge && context.partnerIsPrivateIndividual) {
    warnings.push("Fordított áfás kulcs magánszemély partnerhez nem állítható be — ellenőrizd az áfa kulcsot vagy a partner adatait.");
  }
  if (context.isReverseCharge && context.isAdvanceDocument) {
    warnings.push("Előlegszámlán nem szerepelhet fordított áfás kulcs — ellenőrizd az áfa kulcsot.");
  }
  if (isAmbiguousZeroPercent(context.vatPercentOrCode)) {
    warnings.push(
      "„0%” szerepel áfa értékként — tisztázandó, hogy alanyi adómentes, tárgyi adómentes vagy egyéb okból nem tartalmaz áfát a tétel, és a pontos NAV-kódot kell használni."
    );
  }

  return warnings;
}
