# GCP telepítés — beállítási útmutató (sablon)

> Ez a dokumentum a `docs/tervezes.md` 11. fejezet 0. lépését ("Infra-alap")
> részletezi: egy önálló GCP projekt felállítása és az admin app első
> telepítése Cloud Run + Cloud SQL-re. A parancsokat **te futtatod Google
> Cloud Shell-ben** (https://shell.cloud.google.com).
>
> **Ez egy sablon** — minden `<...>` jelölésű érték a te saját, konkrét
> adatoddal helyettesítendő (GCP projekt azonosító, régió, domain, stb.).
> Az itt szereplő figyelmeztetések valós telepítés(ek) során felmerült
> hibákból származnak, érdemes végigolvasni őket, mielőtt nekiállsz.

## Előzetes döntések, amiket neked kell meghoznod

| Kérdés | Javaslat / szempontok |
|---|---|
| GCP projekt | Célszerű ennek a repónak külön, önálló GCP projektet indítani (ne osszd meg más alkalmazással) |
| Régió | Válaszd a felhasználóidhoz/adatvédelmi szabályozáshoz legközelebbit (pl. `europe-west1`) |
| OTP email küldés | Egy dedikált mailboxod (pl. `noreply@<a-te-domained>.hu`) app-jelszóval, `smtp.gmail.com:587`-en keresztül — vagy egy tranzakciós email szolgáltató, ld. 6. lépés |
| Google OAuth kliens | Hozz létre **saját, dedikált** OAuth 2.0 klienst ehhez a projekthez — NE próbálj újrahasznosítani egy másik projekt/alkalmazás meglévő kliensét (ld. 6. lépés figyelmeztetése, miért nem működik megbízhatóan) |

## Erőforrás-azonosítók — töltsd ki a sajátoddal

> Minden új Cloud Shell munkamenet elején exportáld újra ezeket — a Cloud
> Shell nem tartja meg a shell-változókat munkamenetek között.

```bash
export PROJECT_ID="<a-te-gcp-projekt-azonosítód>"     # pl. cegnev-billingo-ima
export REGION="europe-west1"                          # vagy a hozzád legközelebbi régió
```

## 0. Előfeltételek

- Cloud Shell-ben `gcloud` már be van jelentkezve a saját fiókoddal.
- Legyen kéznél egy Google Cloud számlázási fiók azonosító (`gcloud billing
  accounts list` — ha még nincs, a Cloud Console-ban kell egyet létrehozni/
  hozzárendelni, ez nem szkriptelhető gcloud-dal).

## 1. Projekt létrehozása és számlázás bekötése

```bash
export PROJECT_ID="<a-te-gcp-projekt-azonosítód>"
export REGION="europe-west1"
export BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"   # gcloud billing accounts list

gcloud projects create "$PROJECT_ID" --name="Billingo IMA Admin"
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
```

## 2. API-k engedélyezése

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com
```

## 3. Artifact Registry (Docker image tár)

```bash
gcloud artifacts repositories create billingo-ima-admin \
  --repository-format=docker \
  --location="$REGION" \
  --description="Billingo -> IMA admin app image-ei"
```

## 4. Cloud SQL (PostgreSQL) instance + adatbázis

```bash
export DB_INSTANCE="billingo-ima-db"
export DB_PASSWORD="$(openssl rand -base64 24)"
echo "Mentsd el biztonságosan: $DB_PASSWORD"

gcloud sql instances create "$DB_INSTANCE" \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region="$REGION" \
  --root-password="$DB_PASSWORD"

gcloud sql databases create billingo_ima_admin --instance="$DB_INSTANCE"

gcloud sql users create billingo_ima_admin \
  --instance="$DB_INSTANCE" \
  --password="$DB_PASSWORD"
```

> A `db-f1-micro` a legkisebb, legolcsóbb tier — egy alacsony forgalmú
> belső admin appnak elég induláshoz, később `gcloud sql instances patch
> --tier=...` paranccsal felskálázható.
>
> ⚠️ **Gyakori hiba:** `--edition` nélkül a projekt alapértelmezetten
> `ENTERPRISE_PLUS` kiadást próbál létrehozni, ami NEM engedi a
> `db-f1-micro` tier-t (csak a drágább `db-perf-optimized-N-*` custom
> tier-eket) — `HTTPError 400: Invalid Tier` hibával elutasítja. Az
> explicit `--edition=ENTERPRISE` a fix, ez továbbra is támogatja az
> olcsó shared-core tier-eket.

## 5. Secret Manager

```bash
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export INSTANCE_CONNECTION_NAME="$PROJECT_ID:$REGION:$DB_INSTANCE"

# DATABASE_URL — Cloud Run-natív Unix socket formátumban. FONTOS: az "@"
# után KÖTELEZŐ a "localhost" placeholder, üresen hagyva Prisma "empty
# host" hibát dob.
printf 'postgresql://billingo_ima_admin:%s@localhost/billingo_ima_admin?host=/cloudsql/%s&schema=public' \
  "$DB_PASSWORD" "$INSTANCE_CONNECTION_NAME" | \
  gcloud secrets create database-url --data-file=-

openssl rand -base64 32 | gcloud secrets create nextauth-secret --data-file=-

# A 6. lépésben létrehozott OAuth kliens Client Secret-je — illeszd be a
# saját vágólapodról, NE a shell historyjába gépeld be nyíltan:
gcloud secrets create google-client-secret --data-file=-
# << illeszd be a Client Secret értékét, majd Ctrl+D

# SMTP jelszó (OTP email küldéshez, ld. 6. lépés):
gcloud secrets create smtp-password --data-file=-
# << illeszd be az app-jelszót, majd Ctrl+D
```

## 6. Google OAuth kliens

> ⚠️ **Ne hasznosíts újra egy másik alkalmazás/projekt meglévő OAuth
> kliensét ehhez az apphoz** — a gyakorlatban ez tartósan `invalid_client
> (The provided client secret is invalid.)` hibával hasalhat el, ami a
> NextAuth `[OAUTH_CALLBACK_ERROR]` logjában látszik (`error=OAuthCallback`).
> Lehetséges okok: propagációs késleltetés a Google oldalán, vagy hogy a
> secret nem pontosan ahhoz a klienshez lett hozzáadva, amit a
> `GOOGLE_CLIENT_ID` mutat. **A megbízható megoldás**: hozz létre
> teljesen saját, dedikált OAuth consent screen-t (Internal user type —
> csak a saját Workspace-domained fiókjai, nincs Google-féle app-review)
> + OAuth 2.0 Client ID-t ebben a projektben.
>
> Ha a secret-et interaktívan illeszted be (`--data-file=-`), könnyen
> belekerülhet egy záró sortörés — `printf '%s' "$SECRET" | gcloud secrets
> versions add ...` ezt biztosan kizárja, `wc -c`-vel ellenőrizhető a
> pontos hossz.

A Cloud Console-ban (nem gcloud-dal szkriptelhető), a saját projektedben:

1. **APIs & Services → OAuth consent screen** → User Type: **Internal** →
   alapadatok kitöltése (App name, support/contact email) → mentés.
2. **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client
   ID** → Application type: **Web application** → **Authorized redirect
   URIs**:
   ```
   https://<a-cloud-run-szolgáltatásod-URL-je>/api/auth/callback/google
   ```
   (Az első deploy előtt még nem ismert a végleges URL — a 9. lépés után
   pótolható/frissíthető.)
3. Create — a Client ID és Client Secret egy felugró ablakban teljes
   egészében megjelenik, onnan másold ki (később csak maszkolva látszik
   vissza, de "+ ADD SECRET"-tel bármikor kapható melléje új is).

**OTP email (SMTP) beállítás**: az egyik legegyszerűbb működő megoldás egy
dedikált Workspace postafiók (pl. `noreply@<a-te-domained>.hu`) 2FA +
app-jelszó kombinációja, `smtp.gmail.com:587` címmel — ez nem igényel
statikus kimenő IP-t. A "valódi" Workspace SMTP relay
(`smtp-relay.gmail.com`) IP-allowlistet vár, ami Cloud Run-on csak Cloud
NAT + statikus IP mellett oldható meg (drágább, több lépés).

## 7. IAM — Cloud Run szolgáltatásfiók jogosultságai

```bash
export RUN_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA" --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor"
```

## 8. Docker image build

```bash
git clone <a-te-repód-URL-je>
cd <repo-mappaneve>/app
git checkout <a-deploy-olni-kívánt-branch>

gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/billingo-ima-admin/billingo-ima-admin:latest"
```

## 9. Cloud Run szolgáltatás létrehozása

```bash
export GOOGLE_CLIENT_ID="<a 6. lépésben létrehozott OAuth kliens Client ID-ja>"
export ALLOWED_DOMAIN="<a-te-google-workspace-domained>.hu"
export SMTP_USER="noreply@<a-te-domained>.hu"

gcloud run deploy billingo-ima-admin \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/billingo-ima-admin/billingo-ima-admin:latest" \
  --region="$REGION" \
  --add-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
  --set-secrets=DATABASE_URL=database-url:latest,NEXTAUTH_SECRET=nextauth-secret:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,SMTP_PASSWORD=smtp-password:latest \
  --set-env-vars=GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID",ALLOWED_GOOGLE_WORKSPACE_DOMAIN="$ALLOWED_DOMAIN",SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USER="$SMTP_USER",SMTP_FROM="Billingo/IMA admin <$SMTP_USER>" \
  --allow-unauthenticated
```

Az első deploy után írd fel a kiírt szolgáltatás-URL-t, majd:

```bash
export SERVICE_URL="<a fenti deploy kimenetéből>"

gcloud run services update billingo-ima-admin --region="$REGION" \
  --update-env-vars=NEXTAUTH_URL="$SERVICE_URL"
```

> ⚠️ **KRITIKUS különbség:** a `--set-env-vars` NEM hozzáadja/frissíti,
> hanem **teljesen lecseréli** a szolgáltatás összes környezeti változóját
> a megadott listára. Ha csak a `NEXTAUTH_URL`-t adod meg
> `--set-env-vars`-szal egy már futó szolgáltatáson, az **letörli** a 9.
> lépésben beállított `GOOGLE_CLIENT_ID`, `ALLOWED_GOOGLE_WORKSPACE_DOMAIN`,
> `SMTP_*` változókat is — emiatt a Google bejelentkezés gomb némán nem
> csinál semmit (üres Client ID-vel a szerver oldalon). A helyes,
> ADDITÍV parancs a `--update-env-vars` (csak a megadott kulcsokat
> frissíti/adja hozzá, a többit érintetlenül hagyja) — minden **utólagos**
> env var módosításnál ezt használd, sose `--set-env-vars`-t, kivéve ha
> tudatosan az ÖSSZES változót újra meg akarod adni egyszerre (mint a 9.
> lépés első, teljes deploy parancsában).

...és pótold a pontos redirect URI-t a 6. lépésben leírt helyen
(`$SERVICE_URL/api/auth/callback/google`), ha még nem egyezett.

## 10. Adatbázis séma létrehozása (Prisma migrációk)

Cloud Shell-ben (a `cloud-sql-proxy` bináris sok Cloud Shell image-ben
előre telepített — ha nincs, letölti):

```bash
if command -v cloud-sql-proxy >/dev/null 2>&1; then
  PROXY_BIN="cloud-sql-proxy"
else
  curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64
  chmod +x cloud-sql-proxy
  PROXY_BIN="./cloud-sql-proxy"
fi

"$PROXY_BIN" --port 5432 "$INSTANCE_CONNECTION_NAME" &

cd ~/<repo-mappaneve>/app
npm install
DATABASE_URL="postgresql://billingo_ima_admin:$DB_PASSWORD@127.0.0.1:5432/billingo_ima_admin?schema=public" \
  npx prisma migrate deploy
```

> ⚠️ **Kétféle gyakori hiba:**
> 1. Ha csak `which cloud-sql-proxy || { curl ...; }` mintát használsz, de
>    utána feltétel nélkül `./cloud-sql-proxy`-t (relatív útvonalat)
>    próbálsz futtatni: ha a bináris már telepítve van (PATH-ban), a
>    letöltés kimarad, de a relatív útvonal az aktuális könyvtárban nem
>    létezik → `No such file or directory`. A fenti, `PROXY_BIN` változós
>    verzió ezt kezeli: PATH-beli találat esetén bare parancsnévvel,
>    letöltés esetén `./`-lal hívja.
> 2. Ha az `app` mappában még nem futott `npm install`, az `npx prisma` a
>    globális/legfrissebb Prisma-t próbálja letölteni és használni a
>    projektbe pinnelt verzió (jelenleg 5.20.x) helyett — egy újabb major
>    verzió más séma-konfigurációs formátumot várhat (pl. Prisma 7:
>    `prisma.config.ts`), ezért `Error: Prisma schema validation -
>    (get-config wasm)` hibával elhasalhat a `datasource.url` mezőn. Az
>    `npm install` a `npx prisma` elé mindig kötelező, hogy a helyi,
>    `package.json`-ban pinnelt verziót használja.
>
> ⚠️ **Cloud Shell konzol-újraindítás után rossz ADC quota project:** a
> `cloud-sql-proxy` az Application Default Credentials (ADC) alapján
> hitelesít, aminek **saját, a `gcloud config set project`-től FÜGGETLEN**
> "quota project" beállítása van. Egy Cloud Shell újraindítás után ez
> visszaállhat egy alapértelmezett (pl. egy Gemini/AI Studio
> próbaprojekthez tartozó) értékre, még ha a `gcloud config` helyesen a
> saját projektedet is mutatja. Ilyenkor a proxy `googleapi: Error 403:
> Cloud SQL Admin API has not been used in project ...` hibával elhasal,
> hiába jó az `INSTANCE_CONNECTION_NAME`. **Fix**: minden migrációs lépés
> elején (nem csak első alkalommal) futtasd le:
> ```bash
> gcloud auth application-default set-quota-project "$PROJECT_ID"
> ```
> — ez tartósan (session-újraindítás után is) beállítja az ADC quota
> projectjét, a proxy ezután a helyes projektet terheli/ellenőrzi.
>
> Ha a `set-quota-project` maga `ERROR: ... Application default
> credentials have not been set up. Run $ gcloud auth
> application-default login` hibával hasal el (nincs még ADC-fájl a
> Cloud Shell-munkamenetben), a `cloud-sql-proxy` ettől függetlenül a
> Cloud Shell saját, beépített hitelesítésén keresztül ekkor is
> működhet — nem feltétlenül blokkoló. Ha mégis a fenti 403-as hibát
> kapod, a tartalék a teljes bejelentkeztetés:
> ```bash
> gcloud auth application-default login
> gcloud auth application-default set-quota-project "$PROJECT_ID"
> ```

## 11. Első felhasználók rögzítése

```bash
DATABASE_URL="postgresql://billingo_ima_admin:$DB_PASSWORD@127.0.0.1:5432/billingo_ima_admin?schema=public" \
SEED_ACCOUNTANT_EMAIL="<a saját Google Workspace fiókod>" \
SEED_ACCOUNTANT_NAME="<teljes név>" \
  npm run seed
```

Ezután `kill %1`-lel állítsd le a háttérben futó `cloud-sql-proxy`-t.

## 12. Ellenőrzés

Nyisd meg a `$SERVICE_URL`-t, jelentkezz be Google-lal a seedelt fiókoddal.
Ha a bejelentkezés `redirect_uri_mismatch` hibával elutasít, a 6. lépésben
felvett redirect URI nem egyezik pontosan a tényleges `$SERVICE_URL`-lel —
ellenőrizd a Cloud Console Credentials oldalán.

## Frissítés (kódváltozás után) — SOSEM felejtsd el a migrációt

> ⚠️ Egy sémát is érintő kódváltoztatás után (új Prisma mező/tábla) ha
> csak az image-et build-eled/deploy-olod újra, de az éles Cloud SQL-en a
> migrációt NEM futtatod le — az app `500`-zal elhasal minden oldalon:
> `PrismaClientKnownRequestError ... The column ... does not exist in the
> current database.` Minden ilyen frissítésnél **mindkét lépés kötelező,
> ebben a sorrendben**:

> Cloud Shell konzol-újraindítás után a `PROJECT_ID`/`REGION`/
> `INSTANCE_CONNECTION_NAME`/`DB_PASSWORD` shell-változók (és gyakran az
> ADC quota project is, ld. 10. lépés) elvesznek — az alábbi, önmagában
> futtatható blokk ezért mindent újra kitölt/lekér, `DB_PASSWORD`-öt is a
> már elmentett `database-url` secret-ből, nem kell kézzel begépelni:

```bash
export PROJECT_ID="<a-te-gcp-projekt-azonosítód>"
export REGION="europe-west1"
export DB_INSTANCE="billingo-ima-db"
export INSTANCE_CONNECTION_NAME="$PROJECT_ID:$REGION:$DB_INSTANCE"

gcloud config set project "$PROJECT_ID"
gcloud auth application-default set-quota-project "$PROJECT_ID"

cd ~/<repo-mappaneve>/app
git pull origin <a-deploy-olni-kívánt-branch>

# 1) Image build + deploy
gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/billingo-ima-admin/billingo-ima-admin:latest"
gcloud run deploy billingo-ima-admin \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/billingo-ima-admin/billingo-ima-admin:latest" \
  --region="$REGION"

# 2) Migráció az éles adatbázison (ha a séma is változott)
export DB_PASSWORD="$(gcloud secrets versions access latest --secret=database-url --project="$PROJECT_ID" \
  | sed -E 's#^postgresql://[^:]+:([^@]+)@.*#\1#')"

if command -v cloud-sql-proxy >/dev/null 2>&1; then
  PROXY_BIN="cloud-sql-proxy"
else
  curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64
  chmod +x cloud-sql-proxy
  PROXY_BIN="./cloud-sql-proxy"
fi

"$PROXY_BIN" --port 5432 "$INSTANCE_CONNECTION_NAME" &
sleep 2
npm install
DATABASE_URL="postgresql://billingo_ima_admin:$DB_PASSWORD@127.0.0.1:5432/billingo_ima_admin?schema=public" \
  npx prisma migrate deploy
kill %1
```

## Következő lépések (nem ennek a dokumentumnak a része)

- Cégenkénti Billingo/IMA API kulcsok beállítása a Beállítások oldalon
  (ezek DB-ben, `Company` rekordonként tárolódnak — ld. `docs/tervezes.md`
  4. fejezet — nem kell/nem szabad env változóként vagy kódba égetve
  tárolni őket).
- Cloud Scheduler + Cloud Run Job az időzített `sync:billingo`/
  `learn:invoiceanalytics` szkriptekhez (ld. `docs/tervezes.md` 11.
  fejezet).
- Fejlesztői/stabil környezet szétválasztása, ha szükségessé válik: külön
  adatbázis ugyanazon az instance-on, `:dev` image tag, külön Cloud Run
  szolgáltatás — ugyanaz a minta, mint a fenti éles telepítésnél.
