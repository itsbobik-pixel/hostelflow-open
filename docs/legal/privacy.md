# HostelFlow — Informativa sulla privacy / Privacy policy

> **TEMPLATE** — the text HostelFlow used, as an example. Whoever runs a copy of HostelFlow
> is the provider: fill in [PROVIDER NAME], [COMPANY ID], [ADDRESS], [CITY] and the support address,
> have it checked by a lawyer, then `npm run build:legal` (writes public/privacy.html and public/terms.html).

---

## Italiano

Ultimo aggiornamento: 28 ottobre 2026

### 1. Chi siamo
HostelFlow (hostelflow.it) è un software online per strutture ricettive: check-in degli ospiti con lettura
automatica dei documenti, comunicazione alla Polizia di Stato (Alloggiati Web) e, in prova, alla polizia
ceca (Ubyport) e le schede di polizia francesi; statistiche ISTAT (Ross1000); note e organizzazione del
personale.

Fornitore del servizio: [PROVIDER NAME], imprenditore individuale, [COMPANY ID], [ADDRESS], Repubblica Ceca. Contatto privacy: support@hostelflow.it.

### 2. Due ruoli diversi
- **Dati degli ospiti della struttura** (quelli dei documenti d'identità): il **titolare del trattamento è la
  struttura ricettiva** che usa HostelFlow. HostelFlow li tratta **per conto della struttura, come
  responsabile del trattamento** (art. 28 GDPR), secondo l'accordo sul trattamento dei dati contenuto nei
  Termini di servizio. Gli ospiti che vogliono esercitare i propri diritti si rivolgono alla struttura;
  HostelFlow la aiuta a rispondere.
- **Dati degli utenti di HostelFlow** (titolare della struttura e personale con un account): il titolare del
  trattamento è il fornitore di HostelFlow indicato al punto 1.

### 3. Dati degli ospiti: cosa, perché, per quanto
**Cosa:** foto del documento d'identità; cognome, nome, sesso, data e luogo di nascita, cittadinanza, tipo,
numero e luogo di rilascio del documento; data di arrivo e numero di notti; paese, provincia e comune di
residenza (per l'ISTAT). Solo dove la legge del paese della struttura lo chiede: numero del visto e
indirizzo di residenza (Repubblica Ceca); indirizzo, telefono ed e-mail (Francia).

**Perché:** permettere alla struttura di adempiere all'obbligo di legge di comunicare le persone alloggiate
alla Questura tramite Alloggiati Web (art. 109 T.U.L.P.S.) e, se la struttura lo usa, l'obbligo statistico
ISTAT (Ross1000); per le strutture in altri paesi, l'obbligo equivalente di quel paese (Ubyport in
Repubblica Ceca, scheda individuale di polizia in Francia). La base giuridica, per la struttura, è l'obbligo
di legge (art. 6.1.c GDPR).

**Per quanto (conservazione minima):**
- le **foto dei documenti** vengono cancellate **subito dopo l'invio** dell'ospite alla Questura e comunque
  automaticamente **entro 48 ore**, anche se l'ospite non è stato inviato;
- gli **ospiti non inviati** vengono cancellati dopo **3 giorni** (oltre questo termine la comunicazione
  non sarebbe più possibile);
- **dopo l'invio alla Questura** HostelFlow **cancella i dati personali** e conserva solo quanto serve alle
  statistiche ISTAT: cittadinanza, residenza, data di arrivo, notti, tipo di alloggiato, più un'impronta
  cifrata del numero di documento (non reversibile senza la chiave del sistema) che serve solo a evitare
  di inviare due volte lo stesso documento;
- **in Italia**, per le statistiche regionali (Ross1000) restano anche sesso, data, luogo e paese di
  nascita, comune di residenza e il collegamento al capogruppo: vengono cancellati **90 giorni dopo
  l'invio**;
- **in Francia** la legge chiede alla struttura di conservare le schede di polizia: HostelFlow le conserva
  **cifrate per 6 mesi**, poi le cancella automaticamente. La struttura le stampa se la polizia o la
  gendarmeria le chiedono.

La ricevuta ufficiale delle comunicazioni resta sul portale della polizia usato dalla struttura.

### 4. Dati degli utenti
Nome, e-mail, password (conservata solo come hash PBKDF2, mai in chiaro), ruolo nella struttura, note e
attività nell'app (es. chi ha spuntato un compito, turni); preferenze dell'account (schede mostrate,
immagine dell'intestazione caricata); messaggi inviati al supporto; credenziali dei portali della struttura
(polizia, Ross1000: cifrate con AES-GCM, mai mostrate di nuovo); la chiave API di Claude, se la struttura
collega il proprio account (cifrata, mai mostrata di nuovo). Base giuridica: esecuzione del contratto
(art. 6.1.b). Conservazione: fino alla chiusura dell'account.

### 5. A chi vengono comunicati i dati (sub-responsabili e destinatari)
| Chi | Per cosa | Dati |
|---|---|---|
| **Polizia di Stato – Alloggiati Web** | comunicazione obbligatoria degli alloggiati (destinatario per legge) | dati degli ospiti |
| **Regione – Ross1000** (solo se la struttura lo usa) | statistiche ISTAT obbligatorie (destinatario per legge) | dati statistici degli ospiti, senza nomi né documenti |
| **Policie ČR – Ubyport** (solo strutture in Repubblica Ceca) | comunicazione obbligatoria degli stranieri alloggiati (destinatario per legge) | dati degli ospiti stranieri |
| **Cloudflare, Inc.** | hosting dell'app e del database (server in Europa occidentale) | tutti i dati dell'app |
| **Anthropic, PBC** | lettura automatica della foto del documento e assistente Flowy (intelligenza artificiale, via API; con l'account Claude della struttura, se collegato) | foto del documento; domande fatte a Flowy |
| **Resend** | invio di e-mail di servizio (reimpostazione password, inviti) | e-mail e nome dell'utente |
| **Channex** (solo se la struttura usa il channel manager) | collegamento con Booking.com, Hostelworld, Airbnb… | dati delle prenotazioni |

Secondo i termini commerciali di Anthropic, i dati inviati tramite la sua API non vengono usati per addestrare
i modelli e vengono cancellati dai suoi sistemi entro 30 giorni (conservati solo per la sicurezza del servizio,
salvo contenuti segnalati come violazione delle sue regole d'uso). Per i fornitori con sede fuori dall'UE il trasferimento avviene sulla base delle Clausole
Contrattuali Standard della Commissione Europea e/o dell'EU-US Data Privacy Framework.

HostelFlow non vende dati, non fa profilazione e non usa i dati degli ospiti per marketing.

### 6. Cookie
HostelFlow usa **un solo cookie tecnico** (`hf_session`) per mantenere l'accesso, e la memoria locale del
browser per preferenze come lingua e tema. **Nessun cookie di profilazione o
di statistica**, nessun tracciamento: per questo non serve un banner per il consenso. Sulle pagine pubbliche del
sito (non nell'app) contiamo le visite con **Cloudflare Web Analytics**, senza cookie e senza dati che
identifichino il visitatore.

### 7. Sicurezza
Connessione sempre cifrata (HTTPS, HSTS), password solo come hash, credenziali del portale cifrate, sessioni
con token casuali di cui si conserva solo l'impronta, accesso ai dati limitato agli utenti della struttura
secondo il ruolo (titolare, staff, volontario), intestazioni di sicurezza restrittive nel browser.

### 8. Diritti
Gli interessati hanno diritto di accesso, rettifica, cancellazione, limitazione, opposizione e portabilità
(artt. 15–22 GDPR). Per i dati degli utenti: support@hostelflow.it. Per i dati degli ospiti: la struttura
ricettiva. È sempre possibile proporre reclamo al **Garante per la protezione dei dati personali**
(garanteprivacy.it).

### 9. Modifiche
Eventuali modifiche saranno pubblicate su questa pagina con la data di aggiornamento; le modifiche
importanti saranno comunicate agli utenti via e-mail.

---

## English

Last updated: 28 October 2026

### 1. Who we are
HostelFlow (hostelflow.it) is online software for accommodation providers: guest check-in with automatic
document reading, reporting to the Italian State Police (Alloggiati Web) and, in beta, the Czech police
(Ubyport) and French police forms; ISTAT statistics (Ross1000); notes and team organisation.

Provider: [PROVIDER NAME], sole trader, Company ID [COMPANY ID], [ADDRESS], Czech Republic. Privacy contact: support@hostelflow.it.

### 2. Two different roles
- **Guests' data** (from identity documents): the **controller is the accommodation provider** using
  HostelFlow. HostelFlow processes it **on the provider's behalf as a processor** (Art. 28 GDPR), under the
  data processing agreement in the Terms of Service. Guests exercise their rights with the provider;
  HostelFlow helps it answer.
- **HostelFlow users' data** (owner and staff with an account): the controller is the provider named in 1.

### 3. Guests' data: what, why, how long
**What:** photo of the identity document; surname, given names, sex, date and place of birth, citizenship,
document type, number and place of issue; arrival date and nights; country, province and municipality of
residence (ISTAT). Only where the law of the provider's country asks for it: visa number and home address
(Czechia); home address, phone and e-mail (France).

**Why:** so the provider can meet its legal duty to report lodged guests to the Questura via Alloggiati Web
(Art. 109 T.U.L.P.S.) and, if used, the ISTAT statistical duty (Ross1000); for providers in other
countries, that country's equivalent duty (Ubyport in Czechia, the fiche individuelle de police in France).
Legal basis for the provider: legal obligation (Art. 6(1)(c) GDPR).

**How long (kept to a minimum):**
- **document photos** are deleted **as soon as the guest is sent** to the Questura, and in any case
  automatically **within 48 hours**, even if the guest is never sent;
- **guests not sent** are deleted after **3 days** (after that they could no longer be reported);
- **once reported**, HostelFlow **deletes the personal data** and keeps only what ISTAT statistics need:
  citizenship, residence, arrival date, nights, guest type, plus an encrypted fingerprint of the document
  number (not reversible without the system key), used only to avoid sending the same document twice;
- **in Italy**, for the regional statistics (Ross1000), sex, date, place and country of birth, municipality
  of residence and the link to the group leader are also kept, and deleted **90 days after reporting**;
- **in France** the law asks the provider to keep the police forms: HostelFlow keeps them **encrypted for
  6 months**, then deletes them automatically. The provider prints them when the police or gendarmerie ask.

The official receipt of each report stays in the provider's police portal account.

### 4. Users' data
Name, e-mail, password (stored only as a PBKDF2 hash, never in plain text), role, notes and activity in the
app (e.g. ticked tasks, shifts); account preferences (tabs shown, uploaded header picture); messages sent to
support; the provider's portal credentials (police, Ross1000: AES-GCM encrypted, never shown again); the Claude
API key, if the property connects its own account (encrypted, never shown again). Legal basis: performance of
the contract (Art. 6(1)(b)). Kept until the account is closed.

### 5. Recipients and sub-processors
| Who | What for | Data |
|---|---|---|
| **Italian State Police – Alloggiati Web** | mandatory guest reporting (recipient by law) | guests' data |
| **Region – Ross1000** (only if the provider uses it) | mandatory ISTAT statistics (recipient by law) | guests' statistical data, no names or documents |
| **Czech Police – Ubyport** (only providers in Czechia) | mandatory reporting of foreign guests (recipient by law) | foreign guests' data |
| **Cloudflare, Inc.** | hosting of the app and database (servers in Western Europe) | all app data |
| **Anthropic, PBC** | automatic reading of document photos and the Flowy assistant (AI, via API; with the property's own Claude account, if connected) | document photos; questions asked to Flowy |
| **Resend** | service e-mails (password reset, invitations) | user's e-mail and name |
| **Channex** (only if the channel manager is used) | connection to Booking.com, Hostelworld, Airbnb… | reservation data |

Under Anthropic's commercial terms, data sent through its API is not used to train models and is deleted
from its systems within 30 days (kept only for the safety of the service, except content flagged as breaking
its usage policy). Transfers to
providers outside the EU rely on the European Commission's Standard Contractual Clauses and/or the
EU-US Data Privacy Framework.

HostelFlow does not sell data, does not profile anyone and does not use guests' data for marketing.

### 6. Cookies
HostelFlow uses **one technical cookie** (`hf_session`) to keep you signed in, and the browser's local
storage for preferences such as language and theme. **No profiling or analytics cookies**,
no tracking — so no consent banner is needed. On the public pages of the site (not in the app) we count
visits with **Cloudflare Web Analytics**, without cookies and without data that identifies the visitor.

### 7. Security
Always-encrypted connections (HTTPS, HSTS), passwords only as hashes, portal credentials encrypted, sessions
with random tokens of which only a fingerprint is stored, access limited to the provider's users by role
(owner, staff, volunteer), strict browser security headers.

### 8. Your rights
Access, rectification, erasure, restriction, objection and portability (Arts. 15–22 GDPR). Users' data:
support@hostelflow.it. Guests' data: the accommodation provider. You can always complain to the Italian Data
Protection Authority (**Garante per la protezione dei dati personali**, garanteprivacy.it).

### 9. Changes
Changes are published on this page with the update date; important changes are e-mailed to users.
