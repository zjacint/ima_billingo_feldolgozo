/**
 * Számlatétel nettó/áfa/bruttó összegek garantáltan konzisztensé tétele —
 * ld. docs/tervezes.md 21. fejezet, könyvelői jelzés (2026.09.14): "a
 * számla tételek összesen és a számla fejlécének adatai nem egyezőek... a
 * sorok nettó és áfa összegének ki kell adnia a bruttó sor értékeket. A
 * sorok nettó értékeinek a számla összesen nettóját [kell kiadnia]."
 * Jogszabályi elvárás is (áfa tv.): egy bizonylat tételsorán a nettó + áfa
 * = bruttó összefüggésnek MINDIG teljesülnie kell.
 *
 * Két lépésben dolgozik (mindkettőt a hívó alkalmazza, ebben a
 * sorrendben):
 * 1. `reconcileLineAmounts` — EGYETLEN sor saját nettó+áfa=bruttó
 *    konzisztenciáját garantálja (a Billingo API néhol egymástól
 *    függetlenül kerekített nettó/áfa/bruttó mezőket ad vissza egy
 *    tételen, ami ritkán, kerekítési határeseteknél 1 egységnyi eltérést
 *    okozhat — élő esetben megfigyelve).
 * 2. `reconcileLinesToHeaderTotal` — a (már egyenként konzisztens) SOROK
 *    összegét igazítja a bizonylat FEJLÉCÉBEN szereplő, FIX/irányadó
 *    összesítőhöz — könyvelői pontosítás (2026.09.14): "nem a sorokból
 *    számolunk, hanem a fejléc adatával kell azonosnak lenni a
 *    soroknak... a sorokat lehet mozgatni." A fejléc-összesítő (Billingo
 *    `summary.net_amount`/`summary.vat_amount`/`gross_total`) SOHA nem
 *    változik — csak a sorok (az utolsó sor) igazodik hozzá.
 */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ReconciledLineAmounts {
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  /** `true`, ha a bemeneti áfa érték nem egyezett a nettó+áfa=bruttó összefüggéssel, tehát korrigálni kellett. */
  corrected: boolean;
}

/**
 * A nettó és a bruttó értéket tekinti irányadónak (ezek szerepelnek
 * legegyértelműbben/legfontosabb összegként a bizonylaton — a bruttó a
 * ténylegesen fizetendő végösszeg), az áfa értéket ebből származtatja
 * (bruttó - nettó) — így a hármas MINDIG pontosan konzisztens lesz,
 * függetlenül attól, hogy a forrás (Billingo) API mit adott vissza
 * ténylegesen az áfa mezőre. Csak akkor tér el érdemben az eredetitől, ha
 * a bemenet ténylegesen inkonzisztens volt — a `corrected` jelzi ezt,
 * hogy hívó oldalon naplózható/követhető legyen, ha ez gyakran előfordulna
 * (ami egy nagyobb, a kerekítésen túlmutató adathibára utalna).
 */
export function reconcileLineAmounts(netAmount: number, vatAmount: number, grossAmount: number): ReconciledLineAmounts {
  const net = round2(netAmount);
  const gross = round2(grossAmount);
  const vat = round2(gross - net);
  const corrected = Math.abs(vat - round2(vatAmount)) > 0.005;
  return { netAmount: net, vatAmount: vat, grossAmount: gross, corrected };
}

export interface LineAmounts {
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

export interface ReconcileToHeaderResult<T> {
  lines: T[];
  corrected: boolean;
  netDelta: number;
  vatDelta: number;
  grossDelta: number;
}

/**
 * A tételsorok (MÁR egyenként nettó+áfa=bruttó konzisztensre hozott, ld.
 * `reconcileLineAmounts`) összegét a bizonylat FEJLÉCÉBEN szereplő, FIX/
 * irányadó nettó/áfa/bruttó összesítőhöz igazítja — könyvelői pontosítás
 * (2026.09.14): "nem a sorokból számolunk, hanem a fejléc adatával kell
 * azonosnak lenni a soroknak. Tehát az összesen adat, ami a számla fejből
 * érkezik, az a fix. A sorokat lehet mozgatni." A Billingo API-ban ez a
 * fejléc-összesítő a dokumentum `summary.net_amount`/`summary.vat_amount`/
 * `gross_total` mezőiből jön (ld. `billingoApiClient.ts` `BillingoDocument`).
 *
 * A maradék különbséget (jellemzően csak néhány fillér/forintos kerekítési
 * eltérés a soronkénti és a fejléc-szintű kerekítés között) az UTOLSÓ
 * tételsorra tolja rá — ez a szokásos könyvelési gyakorlat ("kerekítési
 * különbözet"). A három maradék (nettó/áfa/bruttó) MATEMATIKAI okból mindig
 * konzisztens egymással (nettó-maradék + áfa-maradék = bruttó-maradék,
 * feltéve hogy MIND a fejléc, MIND az egyenként már konzisztensre hozott
 * sorok teljesítik a nettó+áfa=bruttó összefüggést) — ezért a korrigált
 * utolsó sor is megtartja a saját nettó+áfa=bruttó konzisztenciáját.
 *
 * Üres `lines` tömbnél nem csinál semmit (nincs mire ráterhelni a
 * különbözetet) — a hívónak kell eldöntenie, mit kezd egy tételsor nélküli
 * bizonylattal.
 */
export function reconcileLinesToHeaderTotal<T extends LineAmounts>(
  lines: T[],
  header: { netAmount: number; vatAmount: number; grossAmount: number }
): ReconcileToHeaderResult<T> {
  if (lines.length === 0) {
    return { lines, corrected: false, netDelta: 0, vatDelta: 0, grossDelta: 0 };
  }

  const sumNet = round2(lines.reduce((sum, l) => sum + l.netAmount, 0));
  const sumVat = round2(lines.reduce((sum, l) => sum + l.vatAmount, 0));
  const sumGross = round2(lines.reduce((sum, l) => sum + l.grossAmount, 0));

  const netDelta = round2(header.netAmount - sumNet);
  const vatDelta = round2(header.vatAmount - sumVat);
  const grossDelta = round2(header.grossAmount - sumGross);

  if (netDelta === 0 && vatDelta === 0 && grossDelta === 0) {
    return { lines, corrected: false, netDelta: 0, vatDelta: 0, grossDelta: 0 };
  }

  const adjusted = lines.map((l) => ({ ...l }));
  const last = adjusted[adjusted.length - 1]!;
  last.netAmount = round2(last.netAmount + netDelta);
  last.vatAmount = round2(last.vatAmount + vatDelta);
  last.grossAmount = round2(last.grossAmount + grossDelta);

  return { lines: adjusted, corrected: true, netDelta, vatDelta, grossDelta };
}
