const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "attekintes",
    title: "A munkafolyamat áttekintése",
    body: (
      <>
        <p>
          A rendszer minden Billingo-számlát automatikusan lekér, megpróbálja kontírozni (főkönyvi
          számot és áfa kulcsot javasolni hozzá tanult vagy kézzel felvitt szabályok alapján), majd
          a könyvelő jóváhagyása után beküldi (vagy exportálja) IMA felé. Egy számla az alábbi
          útvonalon halad végig:
        </p>
        <p style={{ fontFamily: "monospace" }}>
          Szinkronizálva → (Felülvizsgálandó) → Jóváhagyva → Beküldve → Könyvelve
        </p>
        <p>
          A zárójeles &bdquo;Felülvizsgálandó&rdquo; lépés csak akkor jelenik meg, ha a rendszer nem
          tudott minden tételsorhoz egyértelmű kontírt/áfa kulcsot javasolni — ilyenkor a könyvelőnek
          kézzel kell kiegészítenie a hiányzó adatokat, mielőtt jóváhagyná a számlát.
        </p>
      </>
    ),
  },
  {
    id: "allapotok",
    title: "Számla állapotok",
    body: (
      <ul>
        <li>
          <strong>Szinkronizálva</strong> — a Billingo-ból most érkezett számla, MINDEN tétele
          egyértelműen kontírozható volt a meglévő szabályok alapján. Egyenként vagy tömegesen
          rögtön jóváhagyható.
        </li>
        <li>
          <strong>Felülvizsgálandó</strong> — legalább egy tételsorhoz hiányzik a kontír vagy az áfa
          kulcs (nincs illő szabály, vagy több szabály is illene, ezért a rendszer nem tippel). Nyisd
          meg a számlát, töltsd ki a hiányzó mezőket (vagy állítsd be tömegesen a Számlák oldalon a
          &bdquo;Kontír/áfa beállítása&rdquo; gombbal), utána jóváhagyható.
        </li>
        <li>
          <strong>Jóváhagyva</strong> — a könyvelő véglegesítette a kontírt/áfa kulcsot minden
          soron. Innen indítható a beküldés IMA-nak (vagy a CSV export). Ha tévedés történt, a
          &bdquo;Jóváhagyás visszavonása&rdquo; gombbal visszaléptethető &bdquo;Felülvizsgálandó&rdquo;
          állapotba, egyenként vagy tömegesen — a korábban beírt kontír/áfa értékek megmaradnak,
          csak javítani kell rajtuk.
        </li>
        <li>
          <strong>Beküldve</strong> / <strong>Könyvelve</strong> — sikeresen elment IMA-nak.
        </li>
        <li>
          <strong>Hibás</strong> — a beküldés IMA-oldali hibába ütközött (a hibaüzenet a számlán
          látszik). Javítás után újra beküldhető, vagy CSV-vel exportálható.
        </li>
        <li>
          <strong>Elutasítva</strong> — a könyvelő kézzel kizárta a számlát a feldolgozásból (pl.
          téves adat, duplikátum) — indoklással együtt.
        </li>
      </ul>
    ),
  },
  {
    id: "jovahagyas",
    title: "Jóváhagyás — egyenként és tömegesen",
    body: (
      <>
        <p>
          Egy számla megnyitásakor soronként látszik a javasolt kontír/áfa (jelezve, hogy tanult vagy
          kézi szabályból jött-e). A &bdquo;Szerkesztés&rdquo; gombbal soronként felülírható, majd a
          &bdquo;Jóváhagyás&rdquo; gomb zárja le — ez csak akkor engedett, ha MINDEN sorhoz van kontír
          és áfa kulcs.
        </p>
        <p>
          A Számlák listán a &bdquo;Kijelöltek jóváhagyása&rdquo; gomb egyszerre több számlát is
          jóváhagy — ehhez a kijelölt számláknak (akár Szinkronizálva, akár Felülvizsgálandó
          állapotúak) teljesen ki kell tölteniük a kontírt/áfa kulcsot minden soron, a partnernek
          teljes adószámmal/számlázási címmel kell rendelkeznie, és nem lehet figyelmen kívül hagyott
          árfolyam-figyelmeztetés rajta — ami emiatt mégsem hagyható jóvá, azt a rendszer számlánként,
          konkrét okkal visszajelzi a művelet után.
        </p>
      </>
    ),
  },
  {
    id: "szabalyok",
    title: "Kontír / áfa szabályok",
    body: (
      <>
        <p>
          A rendszer két forrásból javasol kontírt/áfa kulcsot egy tételsorhoz:
        </p>
        <ul>
          <li>
            <strong>Tanult szabály</strong> — a &bdquo;Szabályok tanulása&rdquo; gomb (a Kontír/áfa
            szabályok oldalon) az IMA-ban már meglévő, korábbi könyvelési adatokból (mely partner,
            mely termék milyen főkönyvi számra és áfa kulcsra került eddig) automatikusan felépít
            szabályokat. Csak akkor javasol, ha egy adott partner+termék kombinációhoz EGYÉRTELMŰEN
            (mindig ugyanoda) került eddig a könyvelés — ha valaha eltérő volt, inkább nem tippel.
          </li>
          <li>
            <strong>Kézi szabály</strong> — a könyvelő maga vesz fel egy szabályt (partner, termék,
            megjegyzés, bizonylattípus vagy áfa alapján), vagy a rendszer automatikusan létrehoz/
            frissít egy kézi szabályt, amikor egy számla jóváhagyásakor a könyvelő eltér a javasolt
            értéktől — így a rendszer &bdquo;megjegyzi&rdquo; a döntést a következő hasonló számlához.
          </li>
        </ul>
        <p>
          Egy szabály több feltételt is tartalmazhat (pl. partner ÉS termék együtt) — minden
          kitöltött feltételnek illeszkednie kell. Ha egy tételsorra több szabály is illik, a
          rendszer a specifikusabbat (több feltételt kitöltőt) részesíti előnyben; ha ez nem
          egyértelmű, inkább nem javasol semmit, hogy ne kontírozzon félre.
        </p>
        <p>
          A szabályok listája csak olvasható — a &bdquo;Szerkesztés&rdquo; gombbal nyílik a
          szerkesztő panel soronként, illetve a kijelölt szabályokra &bdquo;Csoportos
          módosítás&rdquo; is elérhető (csak a ténylegesen kitöltött mezők változnak minden kijelölt
          szabályon).
        </p>
      </>
    ),
  },
  {
    id: "elolegszamla",
    title: "Előlegszámlák kontírozása",
    body: (
      <>
        <p>
          Egy előlegszámla (Billingo &bdquo;advance&rdquo; típus) MINDEN tétele, valamint egy
          végszámla/normál/sztornó számla azon tétele, amely a megjegyzésében egy már ismert
          (a rendszerben nyilvántartott) előlegszámlára hivatkozik — pl. &bdquo;(2026-3645)&rdquo; —,
          mindig az elsődleges előleg főkönyvi számra kontírozódik, függetlenül attól, hogy egyébként
          milyen szabály illene rá. Ezt a Beállítások oldalon, az &bdquo;Előlegszámlák
          kontírozása&rdquo; mezőben lehet beállítani; ha üresen hagyod, a rendszer megpróbálja
          levezetni a meglévő, előlegszámlákra tanult szabályokból.
        </p>
      </>
    ),
  },
  {
    id: "partnerek",
    title: "Partnerek",
    body: (
      <>
        <p>
          A Partnerek oldal a Billingo-ból szinkronizált vevőket listázza, jelezve, ha egy partnerhez
          hiányzik az adószám vagy a teljes számlázási cím — ez az, ami ténylegesen blokkolja a
          jóváhagyást/beküldést, NEM az, hogy van-e hozzá párosított IMA-azonosító.
        </p>
        <p>
          Az IMA-partner párosítás (a &bdquo;Számlatükör/áfa kulcsok/partnerek frissítése&rdquo;
          gombbal frissíthető IMA-partnerlista alapján) jelenleg megjelenítésre/ellenőrzésre szolgál —
          segít átlátni, mely partnerek léteznek már IMA oldalon. Az &bdquo;Automatikus párosítás&rdquo;
          gomb csak akkor párosít egy partnert automatikusan, ha az adószáma PONTOSAN EGY IMA-partnerre
          illik rá — kétértelmű vagy hiányzó adószámnál kézi párosítás szükséges.
        </p>
      </>
    ),
  },
  {
    id: "bekuldes",
    title: "Beküldés IMA-nak és CSV export",
    body: (
      <>
        <p>
          Jóváhagyott (vagy korábban hibás) számlák a &bdquo;Beküldés IMA-nak&rdquo; gombbal
          küldhetők be közvetlenül az IMA API-n keresztül, egyenként vagy tömegesen.
        </p>
        <p className="alert alert-warning" style={{ margin: 0 }}>
          ⚠️ Az API-s beküldés IMA-oldali szerverhibába ütközhet
          (&bdquo;import_batch_id&rdquo;) — ez akkor valószínűbb, ha a számla
          partnere még nincs párosítva a Partnerek oldalon (ld. ott). Amíg ezt nem
          sikerül teljesen kiküszöbölni, a &bdquo;CSV export&rdquo; gomb megbízható
          tartalék: ugyanazt a jóváhagyott/hibás kört egy IMA-import CSV fájlként
          tölti le, amit kézzel fel lehet tölteni IMA-ba. Ha egy számlán hiányzik
          valamelyik sorhoz a kontír/áfa, azt a rendszer kihagyja az exportból, és
          jelzi, melyik számla és miért maradt ki.
        </p>
        <p>
          Sikeres beküldés után a rendszer megpróbálja a Billingo számlaképét (PDF) is
          csatolni az IMA-s számlához — ez automatikus, de nem garantált (pl. ha a Billingo
          PDF még nem készült el). A Számla-részletezőn látszik, hogy sikerült-e, és onnan
          kézzel is újraindítható a &bdquo;Számlakép feltöltése&rdquo; gombbal.
        </p>
      </>
    ),
  },
  {
    id: "beallitasok",
    title: "Beállítások",
    body: (
      <ul>
        <li><strong>Billingo API kulcs</strong> — a Billingo fiók Beállítások → API kulcsok menüjéből.</li>
        <li>
          <strong>IMA API kulcs / felhasználó / cégazonosító</strong> — az IMA-tól kapott
          hitelesítő adatok.
        </li>
        <li>
          <strong>Árfolyam-ellenőrzés</strong> — devizás számláknál a Billingo-n szereplő árfolyamot
          nem cseréli le, csak ellenőrzi egy hivatalos jegyzés (MNB vagy választott bank) ellen; jelentős
          eltérésnél a számla felülvizsgálandó státuszba kerül.
        </li>
        <li>
          <strong>Előlegszámlák kontírozása</strong> — ld. fent.
        </li>
      </ul>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="stack-lg">
      <div className="card">
        <p style={{ margin: 0 }}>
          Rövid, munkafolyamat szerinti áttekintő a rendszer használatához. Technikai/fejlesztői
          részletek a projekt dokumentációjában találhatók, ide csak a napi használathoz szükséges
          tudnivalók kerültek.
        </p>
      </div>
      <div className="cluster" style={{ flexWrap: "wrap" }}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="btn btn-sm">
            {s.title}
          </a>
        ))}
      </div>
      {SECTIONS.map((s) => (
        <div key={s.id} id={s.id} className="card stack">
          <h2 style={{ margin: 0 }}>{s.title}</h2>
          {s.body}
        </div>
      ))}
    </div>
  );
}
