/**
 * Hiányzó számlaszám-ellenőrzés — ld. docs/tervezes.md 14. fejezet,
 * könyvelői kérés (2026.08.16): "teszteltem a rendszert, de nem lett
 * 100%-os a számlák mennyisége... legyen egy [vizsgálat], nincs-e hiányzó
 * számlaszám a lekérdezést követően". A Billingo számlaszám jellemzően
 * `<prefix><sorszám>` alakú (pl. "2026-2379", vagy egyedi számlatömb-
 * prefixszel "CAD-2026-000124") — a sorszám prefixenként (számlatömbönként)
 * FOLYAMATOSNAK kell lennie, ezért a hiányzó sorszám jó jelzés arra, hogy a
 * szinkron kihagyott egy bizonylatot (VAGY ténylegesen törölt/stornózott
 * bizonylatról van szó — ld. `findInvoiceNumberGaps` doksztringje, ez a
 * vizsgálat ezt nem tudja megkülönböztetni, csak jelez).
 */

/** `<prefix><számjegyek>` — a prefix az utolsó számjegy-blokk ELŐTTI rész (üres is lehet). */
const NUMBER_SUFFIX_PATTERN = /^(.*?)(\d+)$/;

/** Egy csoporton (prefixen) belüli tartomány felső korlátja — ha ennél nagyobb, kihagyjuk (valószínűleg rossz párosítású prefix, nem valódi sorozat). */
const MAX_RANGE_PER_GROUP = 20000;

export interface InvoiceNumberGapGroup {
  /** A számlaszám prefixe (pl. "2026-", vagy "CAD-2026-") — ez különbözteti meg a számlatömböket/éveket. */
  prefix: string;
  minNumber: number;
  maxNumber: number;
  missingNumbers: number[];
}

/**
 * A megadott számlaszámokat prefix szerint csoportosítja (a végén álló
 * számjegy-blokk előtti rész), majd csoportonként megkeresi a
 * legkisebb-legnagyobb sorszám közötti, ténylegesen HIÁNYZÓ sorszámokat.
 * Csak azokat a csoportokat adja vissza, ahol TALÁLT hiányt — és csak
 * legalább 2 elemű csoportokat vizsgál (egyetlen számnál nincs értelme
 * "hiányról" beszélni). Egy pár száz/ezres tartományt meghaladó csoportot
 * (`MAX_RANGE_PER_GROUP`) kihagy — az valószínűleg rosszul illeszkedő
 * prefix (két különböző számlatömb véletlen egyezése), nem valódi sorozat.
 *
 * ⚠️ FONTOS KORLÁT: a hiányzó sorszám NEM feltétlenül szinkronizálási hiba
 * — lehet ténylegesen törölt vagy stornózott bizonylat is (a stornó
 * bizonylatokat a rendszer jelenleg egyáltalán nem szinkronizálja, ld.
 * docs/tervezes.md 12. fejezet), ami mindig "hiányként" fog megjelenni
 * itt. Ez a vizsgálat csak JELEZ, a könyvelőnek kell eldöntenie soronként,
 * hogy valódi kihagyásról van-e szó.
 */
export function findInvoiceNumberGaps(documentNumbers: string[]): InvoiceNumberGapGroup[] {
  const byPrefix = new Map<string, Set<number>>();
  for (const raw of documentNumbers) {
    const trimmed = raw.trim();
    const match = trimmed.match(NUMBER_SUFFIX_PATTERN);
    if (!match) continue;
    const prefix = match[1]!;
    const num = Number(match[2]);
    if (!Number.isFinite(num)) continue;
    const set = byPrefix.get(prefix) ?? new Set<number>();
    set.add(num);
    byPrefix.set(prefix, set);
  }

  const groups: InvoiceNumberGapGroup[] = [];
  for (const [prefix, numberSet] of byPrefix) {
    if (numberSet.size < 2) continue;
    const sorted = [...numberSet].sort((a, b) => a - b);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    if (max - min > MAX_RANGE_PER_GROUP) continue;

    const missing: number[] = [];
    for (let n = min; n <= max; n++) {
      if (!numberSet.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
      groups.push({ prefix, minNumber: min, maxNumber: max, missingNumbers: missing });
    }
  }
  return groups.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

export interface MissingNumberRange {
  start: number;
  end: number;
}

/**
 * Egymást követő hiányzó sorszámokat összefüzza tartományokká — a
 * "Hiányzó számlák lekérése Billingo-ból" (ld. docs/tervezes.md 16.
 * fejezet) így kevesebb Billingo API hívással tudja lekérdezni őket
 * (egy tartomány = egy hívás, a `start_number`/`end_number` szűrővel),
 * mint számonként egyesével.
 */
export function groupConsecutiveNumbers(numbers: number[]): MissingNumberRange[] {
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges: MissingNumberRange[] = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) {
      last.end = n;
    } else {
      ranges.push({ start: n, end: n });
    }
  }
  return ranges;
}

/**
 * Az első 4 egymást követő számjegyet (évszámnak feltételezett) keresi a
 * prefixben — a Billingo `start_year`/`end_year` szűrőjéhez kell (ld.
 * `fetchBillingoDocumentsByNumberRange`, billingoApiClient.ts). `null`, ha
 * nem talál — ilyenkor a hívónak (ld. `runGapFillBatch`) nincs mit tennie,
 * a csoportot kihagyja.
 */
export function extractYearFromPrefix(prefix: string): number | null {
  const match = prefix.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}
