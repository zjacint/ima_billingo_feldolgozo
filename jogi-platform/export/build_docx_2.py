# 2. kör kérdéslista Word-dokumentum. Futtatás: python3 build_docx_2.py
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.table import WD_TABLE_ALIGNMENT

Q = [
("Szolgáltatói szerkezet (ez blokkol mindent)", [
 ("Melyik cég legyen a weboldal üzemeltetője, az ÁSZF szerinti szolgáltató, adatkezelő és számlakiállító: Dzabakusz, S.L.A Bt vagy más? Javaslat: egyetlen üzemeltető cég, az ügyvédi kiegészítőket és ellenjegyzést az iroda saját megbízással és saját számlával végzi.", "ÁSZF, számlázás, GDPR, GCP-számla, fizetési szolgáltatói szerződés."),
 ("Rendben van, hogy a sablonokat az iroda licenc alapján adja az üzemeltetőnek, és az AI-ellenőrzésért az üzemeltető felel (korlátozva az ÁSZF-ben)?", "Felelősségi lánc."),
 ("Ki készíti el az ÁSZF-et, az adatkezelési tájékoztatót és az AI-hozzájárulási szöveget? Dr Bor megírja, vagy a partner oldaláról kapja jóváhagyásra?", "Indulás előtti kötelező szövegek."),
]),
("Jogi pontok (Dr Bor jóváhagyása)", [
 ("17. kérdés pontosítása: a „Nem” azt jelenti, hogy a Google Vertex AI (EU-régió) nem fogadható el, vagy azt, hogy külön hozzájárulás nélkül nem? Ha nem fogadható el: marad-e AI-funkció másik megoldással, vagy csak ügyfél-hozzájárulással?", "Az AI-ellenőrzés és a chat technikai alapja."),
 ("Magánszemélynek bruttó árat kell mutatni (5 900 Ft + 27% ÁFA = 7 493 Ft). Cégeknek nettót. Jó így?", "Fogyasztóvédelmi előírás."),
 ("Elállási jog: a vásárló a fizetés előtt külön pipával elfogadja, hogy a letöltéssel elveszíti az elállási jogát. Jóváhagyod ezt a megoldást és a szövegét?", "Fizetési folyamat."),
 ("Mennyi ideig kell megőrizni a Pmt.-azonosítási anyagokat és az ellenjegyzéses ügy iratait? Ez eltér a 7 napos törléstől.", "Megőrzési szabályok."),
 ("Mely jogi állításokat használhatunk a weboldalon (pl. „ügyvéd által jóváhagyott sablon”, az iroda neve)? A hirdetési tilalom miatt kell egy szöveg-szabály.", "Weboldal- és marketingszövegek."),
 ("Az idő előtti felmondás egyösszegű díját kártyára terheljük, vagy számlázzuk?", "Pénzügyi folyamat."),
]),
("Termékdöntések", [
 ("Végrendelet: javaslat két termék: (1) önkiszolgáló sablon aláírási útmutatóval, (2) ellenjegyzett változat ügyként, árajánlattal. Elfogadod? Mennyi legyen az önkiszolgáló végrendelet ára (5 900 Ft vagy magasabb)? Meg tudod írni a kérdőív-vázat?", "Termék- és árképzés."),
 ("A havi keret (5 generálás, 2/5 AI-ellenőrzés) át nem vitt, vagyis a hónap végén elvész? Az Emeltben a havi 1 ügyvédi ellenőrzés vagy konzultáció elmarad, ha nem használják?", "UsageCounter logika."),
 ("A cégek az előfizetésért is kártyával fizetnek havonta (ismétlődő terhelés)? Vagy cégeknél számla + átutalás is maradhat?", "Fizetési szolgáltató kiválasztása."),
 ("Mi történik az előfizetés 12 hónap után: automatikus megújulás, vagy lejár?", "Szerződési feltételek."),
 ("Kell-e a cégeknek dokumentum-archívum (a generált szerződések tárolása), vagy a 7 napos törlés rájuk is vonatkozik?", "Adatmegőrzési modell."),
 ("Lesz-e kedvezmény vagy ingyenes próba a pilot idejére?", "Pilot indítása."),
]),
("Tartalom és üzemeltetés", [
 ("Ki a kapcsolattartó a partner oldalán az adó-tudástartalomhoz (név, szakterület)? Hány cikkel indulunk?", "Tudástár tartalom."),
 ("Jogszabályfigyelésnél mi a minimum: a tudástár cikkeihez kötött jogszabályok változásának jelzése (njt.hu), vagy automatikus cikk-javaslat is kell?", "Hatókör és költség."),
 ("A chat havi felhasználási korlátot kapjon (javaslat: tisztességes használat, pl. 100 üzenet/hó/cég) a költségkontroll miatt?", "Költségkorlát."),
 ("Ki készíti el a 12 + 1 sablon .docx fájlját, és mikorra? Küldjünk egy sablon-kitöltési útmutatót ({{változó}} jelölések)?", "Ütemezés."),
]),
("Technikai és arculati", [
 ("Márkanév és domain: van három javaslatod? Kérsz tőlünk javaslatot?", "Domain, arculat."),
 ("Melyik cég nevén jöjjön létre a GCP-szervezet és a számlázási fiók? Ki legyen a tulajdonos és a rendszergazda?", "Infrastruktúra indítása."),
 ("Fizetési szolgáltató: elfogadod a javaslatot (Stripe vagy Barion, számlázás Billingóval)? Van már meglévő szerződésetek valamelyikkel?", "Integráció."),
 ("Pilot: kik az első 3–5 próbaügyfél (cégek), és mikor szeretnéd indítani?", "Ütemezés."),
]),
]

d = Document()
s = d.sections[0]; s.left_margin = s.right_margin = Cm(2); s.top_margin = s.bottom_margin = Cm(2)
st = d.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(10.5)
d.add_heading("Ügyvédi előfizetéses platform – 2. kör: nyitott kérdések", 0)
d.add_paragraph("Köszönjük a válaszokat és az árlistát. Az 1. kör alapján eldöntött pontokat a döntésnapló (docs/dontesek.md) tartalmazza. Az alábbi kérdések az eddigi válaszokból következnek. Az első blokk (szolgáltatói szerkezet) a legfontosabb, mert az ÁSZF, a számlázás, a fizetés és az AI-hozzájárulás is ettől függ.")
d.add_heading("Összefoglaló: amit a válaszokból megértettünk", 1)
for t in [
 "Előfizetés csak cégeknek: Cég – Alap 9 900 Ft + ÁFA/hó (1 felhasználó), Cég – Emelt 29 900 Ft + ÁFA/hó (2 felhasználó), 12 hónapos időszak, idő előtti felmondásnál a hátralévő díjak egy összegben.",
 "Magánszemélyek és előfizetés nélküli cégek egyedi dokumentumot vásárolnak 5 900 Ft + ÁFA áron, kártyás foglalással, a generálás után azonnali megterheléssel.",
 "Szerződéstartalmat legfeljebb 7 napig őrzünk, utána törlünk. A számlákat és fizetési adatokat a jogszabály szerint megőrizzük.",
 "AI-ellenőrzés csak a saját sablonból generált dokumentumra, külön hozzájárulással. Az AI-ért nincs felelősség, az ügyvédi ellenőrzésért van.",
 "Nincs e-aláírás és nincs NAV-integráció az első verzióban. Pilot: elkészülés után 3 hónap.",
 "Ellenjegyzéshez kötött ügyletek nem önkiszolgálók: ajánlatkérés és ügyvédi megbízás.",
]: d.add_paragraph(t, style="List Bullet")
n = 1
for sec, items in Q:
    d.add_heading(sec, 1)
    tb = d.add_table(rows=1, cols=4); tb.style = "Light Grid Accent 1"; tb.alignment = WD_TABLE_ALIGNMENT.CENTER
    for c, h in zip(tb.rows[0].cells, ["#", "Kérdés", "Miért kérdezzük?", "Válasz"]): c.text = h
    for q, why in items:
        r = tb.add_row().cells
        r[0].text = str(n); r[1].text = q; r[2].text = why
        n += 1
    for row in tb.rows:
        for c, w in zip(row.cells, [Cm(0.9), Cm(7.6), Cm(3.6), Cm(5)]): c.width = w
d.save("ugyvedi_platform_kerdesek_2_kor.docx")
