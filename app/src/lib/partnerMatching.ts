/**
 * Közös partner-párosítási segédfüggvények — adószám (megbízhatóbb) és
 * pontos névegyezés (adószám nélküli, jellemzően magánszemély partnerekhez)
 * alapján. Ugyanazt a logikát használja a kézi "Automatikus párosítás"
 * (Partnerek oldal) ÉS a beküldés utáni, újonnan létrejött IMA partner
 * visszaírása is — ld. docs/tervezes.md 8.1/12.1.
 */

export function normalizeTaxNumber(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/[^0-9]/g, "");
  return digits || null;
}

export function normalizeName(v: string | null): string | null {
  if (!v) return null;
  const normalized = v.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}

/**
 * Egyetlen, EGYÉRTELMŰ egyezést keres egy `Partner`-hez az IMA partnerek
 * között — előbb adószám alapján, csak adószám NÉLKÜLI partnernél esik
 * vissza pontos névegyezésre (ugyanaz az elv, mint a kézi automatikus
 * párosításnál, ld. `partners/auto-match/route.ts`). Kétértelmű (több
 * találat) vagy hiányzó egyezésnél `null`-t ad — SOSEM tippel.
 */
export function findUniqueImaPartnerMatch(
  partner: { name: string; taxNumber: string | null },
  imaPartners: { id: number; name: string; taxNumber: string | null }[]
): number | null {
  const taxKey = normalizeTaxNumber(partner.taxNumber);
  if (taxKey) {
    const taxMatches = imaPartners.filter((p) => normalizeTaxNumber(p.taxNumber) === taxKey);
    return taxMatches.length === 1 ? taxMatches[0]!.id : null;
  }
  const nameKey = normalizeName(partner.name);
  if (!nameKey) return null;
  const nameMatches = imaPartners.filter((p) => normalizeName(p.name) === nameKey);
  return nameMatches.length === 1 ? nameMatches[0]!.id : null;
}
