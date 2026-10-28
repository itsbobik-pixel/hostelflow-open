# RiMovCli (Liguria, ISTAT C/59) — XML import

Received 16. 10. 2026 from Regione Liguria, La Spezia office (
assistenzac59.laspezia@regione.liguria.it,
tel. 010 548 8786). They asked for a **test file** to check before HostelFlow
goes on the list of compatible software. First user: Ostello Costello,
**CITR 000000-OS-0000**.

Files here:
- `ModelloC59.xsd` — the schema the files are validated against (authoritative).
- `COD1_20130813-esempio.xml` — their example.
- `Specifiche Import Gestionali Alberghieri.pdf` — Datasiel spec v1.0, 17. 12. 2012.
- `province-istat.tsv` — Italian provinces: CODPROVINCIA (3 digits), name, sigla, region.
- `stati-esteri-istat.tsv` — foreign countries of residence and their 3-digit codes
  (ISTAT circolare n. 5, 27. 2. 2012). Some rows are groups ("other countries of …").

## The format

- **One file per day**, named like the example: `<idstruttura>_<YYYYMMDD>.xml`
  (assumption from the example's name `COD1_20130813.xml` — confirm).
- Root `<rm:c59 xmlns:rm="http://www.regione.liguria.it/turismo/rimovcli" idstruttura="…" data="YYYY-MM-DD">`.
- `<mensile numcameredisp numlettidisp softwaregestionale/>` — optional, monthly
  rooms/beds available; the last file of a month wins. Send it every day
  (rooms/beds from Settings → Reports / Property; softwaregestionale="HostelFlow").
- `<giornaliero numcamereoccupate="…">` — numcamereoccupate required only for
  hotels, locande, residenze d'epoca, RTA, alberghi diffusi (not hostels) → optional.
- `<rigac59 nazione="i|e" residenza="NNN" arrivati partiti presenti [diurni]/>`
  one row per place of residence:
  - nazione "i" = Italian resident → residenza = ISTAT **province** code (011 = La Spezia);
  - nazione "e" = foreign resident → residenza = **country** code from the table;
  - presenti = present that night (without day guests); diurni = arrived and left the same day.
- **Days without movement:** if guests stayed that night → rows for every residence of
  those present with arrivati/partiti/diurni 0 and presenti filled; if nobody → no rigac59 at all.

## Open questions for the region (ask with the test file)

1. The PDF calls the attribute `presenze`, the XSD and the example `presenti` — we use
   `presenti` (the XSD). Correct?
2. Sud Sardegna (SU, since 2016) and other newer provinces aren't in the province table —
   which code? (ISTAT's current code for SU is 111.)
3. Foreign countries not in the table (it lists ~55 + groups): which code for the rest —
   the group rows?
4. File name: `<CITR>_<YYYYMMDD>.xml`?
5. `idstruttura` = the CITR (`000000-OS-0000`)? We assume so.

**Answered 20. 10. 2026 (the regional office):** 1 `presenti` correct · 2 use 111 for Sud Sardegna
(he'll ask Liguria Digitale whether their system has it) · 3 country groups OK · 4 file name
irrelevant · 5 idstruttura = regional code (Costello 123456789), not the CITR. Also: the
two test files are valid. **Answered 20. 10. 2026, second mail:** HostelFlow goes on the list of compatible software (no form
for the property; the Region asks Genoa how, the tested files should suffice). Newly enabled properties
start in ONLINE mode; on request the Region switches them to XML mode. Upload is **manual only**
(no web service): the property signs in with SPID/CIE/CNS and uploads the files one after another,
daily or weekly, at the latest in the first days of the next month. Every file carries the night
before: **the portal refuses a file whose presenti don't follow from the previous day**, so the first
file with HostelFlow must start from the real situation (everyone present entered). See `GUIDE.md`.

## In the app (16. 10. 2026)

- `src/stats/rimovcli.js` — `dayFile()` builds one day's XML from `dailyMovement()`
  (`src/stats/istat.js`); `countryCode()` maps every Alloggiati Web state to the
  circolare's code (named countries; the rest to the "altri paesi …" group of the
  circolare's footnotes; overseas France → France 001, Liechtenstein → Switzerland 036,
  stateless → 777); `PROVINCE_CODES` = the province table + SU → 111.
- `GET /api/properties/:id/rimovcli?from=&to=` — one day → `<CITR>_<YYYYMMDD>.xml`,
  more days → a zip of those files (`&check=1` → guests left out). Settings → Statistics →
  "RiMovCli (Liguria, C/59)": regional property code (stored in `stats_settings.c59`; not the CITR — Regione Liguria assigns it at service activation, Costello: 123456789), rooms/beds are the
  Ross1000 ones (else counted from Settings → Property).
  **Hidden for now** (`hidden` on `#au-rimovcli` in `public/index.html`) until the region
  answers the open questions; the API works.
- Guests whose residence has no code (no country, an Italian resident without province)
  are left out and reported; `diurni` isn't written (HostelFlow stays are ≥ 1 night).
- `numcamereoccupate` isn't written (optional for hostels).
- Every file is checked against `ModelloC59.xsd` in `test/rimovcli.test.js` (xmllint).

## Test file for the region

`test/000000-OS-0000_20261014.xml` and `…_20261015.xml` — Costello's CITR, **made-up
guests** (`node scripts/rimovcli-sample.mjs [CITR] [from] [to] [rooms] [beds]`).
Costello: 4 rooms, 24 beds (`node scripts/rimovcli-sample.mjs 000000-OS-0000 2026-10-14 2026-10-15 4 24`).
A draft e-mail is in `test/EMAIL.md`.

