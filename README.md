# SEO &amp; GEO Dashboard

Automaatne igapäevane veebilehtede kvaliteedi jälgija — SEO, GEO (AI-otsingumootorite
nähtavus) ja tehnilised parameetrid kolmele lehele: hyba.ee, raha24.ee, moneyzen.eu.

Repo on **kasutusvalmis**: sees on tänase (28.07.2026) päris analüüsi tulemused ning
illustratiivne 12 kuu trend, mis näitab, kuidas paranemine ajas kajastub. Alates
esimesest töövoo käivitumisest asendub trend päris igapäevaste mõõtmistega.

## Struktuur

```
├── .github/workflows/daily-scan.yml   ← ajastatud töövoog (jookseb iga päev automaatselt)
├── crawler/
│   ├── analyzer.js                    ← SEO/GEO/tehniline crawler (Node.js)
│   └── package.json
├── data/
│   └── history.json                   ← täisajalugu (kõik leiud, kõik päevad)
└── dashboard/
    ├── index.html                     ← staatiline dashboard (avaneb otse brauseris)
    └── data.json                      ← kompaktne fail, mida index.html jooksvalt loeb
```

## Paigaldus (5 minutit)

1. **Loo GitHubis uus repo** (nt `seo-geo-dashboard`), tee see avalikuks (Pages tasuta
   versioon vajab avalikku repot, privaatne repo vajab GitHub Pro/Team).

2. **Lae see kaust üles**:
   ```bash
   cd seo-geo-dashboard   # kausta juurde, kuhu need failid pakkisid lahti
   git init
   git add .
   git commit -m "Initial setup"
   git branch -M main
   git remote add origin https://github.com/SINU-KASUTAJANIMI/seo-geo-dashboard.git
   git push -u origin main
   ```

3. **Luba GitHub Pages**:
   Repo → Settings → Pages → "Build and deployment" → Source: **Deploy from a branch**
   → Branch: `main`, kaust: **`/dashboard`** → Save.
   Mõne minuti pärast on dashboard aadressil:
   `https://SINU-KASUTAJANIMI.github.io/seo-geo-dashboard/`

4. **Kontrolli, et Actions töövoog on lubatud**:
   Repo → Actions vahekaart → kui küsitakse, luba workflows. Töövoog jookseb
   automaatselt iga päev kell 04:00 UTC, aga võid selle kohe käsitsi käivitada:
   Actions → "Daily SEO/GEO scan" → "Run workflow".

5. **Valmis.** Iga päev pärast töövoo käivitumist uueneb `data/history.json` ja
   `dashboard/data.json` automaatselt (bot teeb commiti), GitHub Pages avaldab
   uuendatud dashboardi automaatselt paari minuti jooksul.

## Uute lehtede lisamine

Ava `crawler/analyzer.js`, muuda `SITES` massiivi:

```js
const SITES = [
  { id: 'hyba', name: 'Hyba.ee', url: 'https://www.hyba.ee' },
  { id: 'raha24', name: 'Raha24.ee', url: 'https://www.raha24.ee' },
  { id: 'moneyzen', name: 'MoneyZen.eu', url: 'https://www.moneyzen.eu' },
  { id: 'uus-id', name: 'Uus Sait', url: 'https://www.uussait.ee' },   // ← lisa siia
];
```

Uue lehe `siteId` peab olema unikaalne ja ilma tühikuteta — dashboard kasutab seda
värvide ja graafikute võtmena. Kui lisad uue lehe, tasub `dashboard/index.html` failis
`COLORS` objekti lisada ka uus värv (`SITE_ORDER` massiivi uus id lisandub automaatselt).

## Kontrollitavad parameetrid (~25 tk)

- **SEO**: title-silt, meta description, H1, canonical, piltide alt-tekstid,
  struktureeritud andmed (Schema.org / JSON-LD), Open Graph sildid, HTML lang,
  robots.txt, sitemap.xml
- **GEO** (nähtavus AI-otsingumootoritele nagu ChatGPT, Perplexity, Google AI Overview):
  llms.txt, AI-robotite (GPTBot, Google-Extended, PerplexityBot, ClaudeBot, CCBot)
  ligipääs robots.txt kaudu, FAQ-schema, sisu jaotus H2-pealkirjadega, organisatsiooni/
  autori struktureeritud andmed, teksti/HTML suhe
- **Tehniline**: HTTPS, serveri vastuseaeg, HTML dokumendi suurus, gzip/brotli
  tihendamine, turvapäised (HSTS, CSP, X-Content-Type-Options), mobiili viewport,
  favicon

Uue kontrolli lisamiseks `analyzer.js`-is kasuta olemasolevat mustrit:
```js
addFinding(findings, 'SEO', 'Kontrolli nimi', 'pass'|'fail', 'critical'|'major'|'minor', 'Selgitav sõnum');
```

## Skoori arvutus

`stardiscore` = tuvastatud vigade arv (kuvatud dashboardil suure numbrina).
Lisaks arvutatakse 0–100 "tervise skoor": 100 miinus kaalutud mahaarvestus —
kriitiline viga −8, suur viga −4, väike viga −1. See annab ühe kokkuvõtva numbri,
samal ajal kui täpne vigade arv (stardiscore) jääb alati nähtavaks ja jälgitavaks.

## Miks staatiline HTML, mitte React-rakendus

`dashboard/index.html` on kirjutatud puhtas HTML/CSS/JS-is (ilma build-sammuta,
ilma npm-ita), sest GitHub Pages serveerib seda otse ilma, et oleks vaja
kompileerimist, serverit ega hostimiskulu. Fail loeb `data.json` iga lehe
avamisel jooksvalt, nii et dashboard peegeldab alati viimast bot'i tehtud commiti.
