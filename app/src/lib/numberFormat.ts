/**
 * Külső árfolyam-API válaszokban (MNB, napiarfolyam.hu) előforduló szám
 * szöveges alakja — lehet vesszős vagy pontos tizedesjel. Hiba esetén
 * dob, mert egy árfolyam-lekérdezésnél a hallgatólagos "0" vagy NaN
 * érték rosszabb, mint egy explicit hiba.
 */
export function parseHungarianOrPlainNumber(text: string): number {
  const value = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(value)) {
    throw new Error(`Nem sikerült számként értelmezni az árfolyam-választ: "${text}"`);
  }
  return value;
}
