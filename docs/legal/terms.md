# HostelFlow — Termini di servizio / Terms of Service

> **TEMPLATE** — the text HostelFlow used, as an example. Whoever runs a copy of HostelFlow
> is the provider: fill in [PROVIDER NAME], [COMPANY ID], [ADDRESS], [CITY] and the support address,
> have it checked by a lawyer, then `npm run build:legal` (writes public/privacy.html and public/terms.html).

---

## Italiano

Ultimo aggiornamento: 28 ottobre 2026

### 1. Le parti e il servizio
Questi termini regolano l'uso di HostelFlow (hostelflow.it), fornito da [PROVIDER NAME], imprenditore individuale ([COMPANY ID], registro delle imprese individuali della Repubblica Ceca), [ADDRESS],
Repubblica Ceca («HostelFlow»), alla struttura ricettiva che crea un account («Cliente»).

HostelFlow offre: check-in degli ospiti con lettura automatica dei documenti tramite intelligenza
artificiale, comunicazione degli alloggiati ad Alloggiati Web (Polizia di Stato), dashboard con note e
linee guida per il personale, gestione del team. Alcune funzioni possono essere offerte in anteprima
(«beta»): sono fornite così come sono e possono cambiare o essere ritirate. Il codice di HostelFlow è
pubblicato come software libero (licenza GNU AGPL) su github.com/itsbobik-pixel/hostelflow-open.

### 2. Account e team
Il Cliente è responsabile degli account che crea o a cui invita persone, dei ruoli assegnati (titolare,
staff, volontario) e della riservatezza di password e credenziali. Deve avvisare subito HostelFlow in caso
di accesso non autorizzato.

### 3. Gratuità e scansioni dei documenti
- HostelFlow è **gratuito**: nessun abbonamento e nessun pagamento a HostelFlow.
- La lettura automatica dei documenti usa Claude di Anthropic e ha un costo. Un certo numero di scansioni è
  incluso e pagato da HostelFlow (attualmente 20 per struttura; 200 per le strutture registrate il 28 o il
  29 ottobre 2026 e 500 per quelle registrate prima del 28 ottobre 2026), salvo accordi diversi. HostelFlow può cambiare questo numero avvisando con almeno 30 giorni
  di anticipo.
- Il Cliente può collegare il proprio account Claude (Impostazioni → Scansione al check-in). Le scansioni e
  l'assistente Flowy di quella struttura usano allora il credito del Cliente presso Anthropic, senza limiti da
  parte di HostelFlow. Pagamenti, credito e condizioni di quell'account sono un rapporto diretto tra il Cliente
  e Anthropic. La chiave API è conservata cifrata, usata solo per questo e cancellata quando il Cliente la
  scollega.
- Finite le scansioni incluse e senza un account Claude proprio, i dati degli ospiti si possono sempre
  inserire a mano: l'invio ad Alloggiati Web resta disponibile.

### 4. Responsabilità per la comunicazione alla Questura
L'obbligo di comunicare gli alloggiati (art. 109 T.U.L.P.S.) **resta della struttura**. HostelFlow è uno
strumento che lo semplifica: il Cliente deve controllare i dati letti automaticamente prima dell'invio,
verificare l'esito di ogni invio e, se HostelFlow o il portale Alloggiati Web non fossero disponibili,
comunicare gli ospiti nei termini di legge tramite il portale ufficiale. HostelFlow avvisa nell'app degli
ospiti non ancora inviati, ma non risponde di sanzioni derivanti da comunicazioni mancate, tardive o
errate.

### 5. Uso corretto
Il Cliente usa HostelFlow solo per la propria attività ricettiva e nel rispetto della legge; non carica
dati di persone che non alloggiano nella struttura, non tenta di accedere a dati di altri clienti e non
usa il servizio per inviare comunicazioni non richieste.

### 6. Disponibilità e assistenza
HostelFlow si impegna a mantenere il servizio disponibile e sicuro, ma non garantisce un funzionamento
senza interruzioni (manutenzione, guasti di fornitori come l'hosting o il portale della Polizia).
Assistenza via support@hostelflow.it in italiano, inglese e ceco, nei giorni lavorativi.

### 7. Limitazione di responsabilità
Il servizio è gratuito. Nei limiti consentiti dalla legge, la responsabilità complessiva di HostelFlow verso il
Cliente è limitata a 100 €. HostelFlow non risponde di danni indiretti
(es. mancato guadagno). Restano salvi i casi di dolo o colpa grave.

### 8. Dati e privacy
Per i dati degli ospiti il Cliente è titolare del trattamento e HostelFlow responsabile del trattamento: si
applica l'**Accordo sul trattamento dei dati** in allegato (art. 28 GDPR). Per tutto il resto vale
l'Informativa sulla privacy.

### 9. Durata e fine del rapporto
Il contratto dura finché l'account è attivo. Il Cliente può chiudere l'account in qualsiasi momento;
HostelFlow può chiuderlo con 30 giorni di preavviso, o subito in caso di violazione grave di questi
termini. Alla chiusura i dati del Cliente vengono cancellati entro 30 giorni, salvo quelli che la legge
obbliga a conservare.

HostelFlow può cedere questo contratto, insieme al servizio, a un altro fornitore (ad es. in caso di vendita
dell'attività), avvisando il Cliente almeno 30 giorni prima. Il nuovo fornitore assume gli stessi obblighi,
compresi quelli sui dati degli ospiti come responsabile del trattamento; il Cliente può chiudere l'account
prima della cessione, se non è d'accordo.

### 10. Modifiche dei termini
Le modifiche sono pubblicate con la data di aggiornamento e comunicate via e-mail almeno 30 giorni prima
se importanti. Continuare a usare il servizio dopo tale data vale come accettazione.

### 11. Legge e foro
Questi termini sono regolati dalla legge della Repubblica Ceca. Per ogni controversia è competente il
tribunale di [CITY], salvo diverse norme inderogabili.

---

## Allegato — Accordo sul trattamento dei dati (art. 28 GDPR)

1. **Oggetto e durata.** HostelFlow tratta i dati degli ospiti per conto del Cliente al solo fine di
   fornire il servizio (check-in, comunicazione ad Alloggiati Web, statistiche ISTAT), per la durata del
   contratto.
2. **Natura e finalità.** Raccolta (foto e lettura del documento), conservazione temporanea, trasmissione
   alla Polizia di Stato su istruzione del Cliente, minimizzazione dopo l'invio, cancellazione.
3. **Categorie di dati e interessati.** Ospiti della struttura: dati identificativi e del documento,
   cittadinanza, luogo e data di nascita, residenza, date del soggiorno; foto del documento. Nessuna
   categoria particolare di dati (art. 9) è richiesta.
4. **Istruzioni.** HostelFlow tratta i dati solo su istruzione documentata del Cliente (l'uso dell'app vale
   come istruzione) e lo informa se ritiene che un'istruzione violi la legge.
5. **Riservatezza.** Le persone autorizzate a trattare i dati sono vincolate alla riservatezza.
6. **Sicurezza (art. 32).** Cifratura delle connessioni, password solo come hash, credenziali cifrate,
   accesso per ruolo, cancellazione delle foto subito dopo l'invio (comunque entro 48 ore) e degli ospiti non inviati dopo 3
   giorni, rimozione dei dati personali dopo l'invio.
7. **Sub-responsabili.** Il Cliente autorizza i sub-responsabili elencati nell'Informativa (Cloudflare,
   Anthropic, Resend e, se usato, Channex). HostelFlow comunica in anticipo eventuali nuovi
   sub-responsabili; il Cliente può opporsi e, in tal caso, recedere. Se il Cliente collega il proprio account
   Claude, le foto dei documenti sono inviate ad Anthropic con quell'account, secondo l'accordo tra il Cliente e
   Anthropic.
8. **Assistenza al Cliente.** HostelFlow aiuta il Cliente a rispondere alle richieste degli interessati e
   negli adempimenti degli artt. 32–36 GDPR, nei limiti di quanto è nelle sue possibilità.
9. **Violazioni.** HostelFlow notifica al Cliente ogni violazione dei dati personali senza ingiustificato
   ritardo e comunque entro 48 ore da quando ne viene a conoscenza.
10. **Fine del trattamento.** Alla fine del contratto HostelFlow cancella i dati degli ospiti entro 30
    giorni (molti sono già cancellati automaticamente molto prima), salvo obblighi di legge.
11. **Verifiche.** HostelFlow mette a disposizione le informazioni necessarie a dimostrare il rispetto di
    questo accordo.

---

## English

Last updated: 28 October 2026

### 1. Parties and service
These terms govern the use of HostelFlow (hostelflow.it), provided by [PROVIDER NAME], sole trader (Company ID / [COMPANY ID], Czech Trade Licensing Register), [ADDRESS],
Czech Republic ("HostelFlow"), to the accommodation provider that creates an account ("Customer").

HostelFlow offers guest check-in with AI document reading, reporting of guests to Alloggiati Web (Italian
State Police), a dashboard with notes and guidelines for staff, and team management. Some features may be
offered as previews ("beta"): they are provided as is and may change or be withdrawn. HostelFlow's code is
published as free software (GNU AGPL licence) at github.com/itsbobik-pixel/hostelflow-open.

### 2. Accounts and team
The Customer is responsible for the accounts it creates or invites people to, the roles it assigns (owner,
staff, volunteer) and the secrecy of passwords and credentials, and tells HostelFlow at once about any
unauthorised access.

### 3. Free of charge; document scans
- HostelFlow is **free**: no subscription and nothing to pay HostelFlow.
- Automatic document reading uses Anthropic's Claude and has a cost. A number of scans is included and paid by
  HostelFlow (currently 20 per property; 200 for properties that signed up on 28 or 29 October 2026 and 500 for those that signed up before 28 October 2026), unless
  agreed otherwise. HostelFlow may change this number with at least 30 days' notice.
- The Customer may connect its own Claude account (Settings → Check-in scan). That property's scans and the
  Flowy assistant then use the Customer's own credit at Anthropic, with no limit from HostelFlow. Payments,
  credit and the terms of that account are directly between the Customer and Anthropic. The API key is stored
  encrypted, used only for this and deleted when the Customer disconnects it.
- Once the included scans are used and without its own Claude account, the Customer can always type in guests'
  details by hand: sending to Alloggiati Web stays available.

### 4. Responsibility for police reporting
The duty to report lodged guests (Art. 109 T.U.L.P.S.) **remains the accommodation provider's**. HostelFlow
is a tool that makes it easier: the Customer checks automatically read data before sending, checks the
result of every submission and, if HostelFlow or the Alloggiati Web portal is unavailable, reports guests
within the legal deadline through the official portal. HostelFlow flags guests not yet sent, but is not
liable for penalties from missing, late or wrong reports.

### 5. Fair use
The Customer uses HostelFlow only for its own accommodation business and lawfully; it does not upload data
of people not staying at the property, does not try to access other customers' data and does not use the
service for unsolicited messages.

### 6. Availability and support
HostelFlow works to keep the service available and secure but does not guarantee uninterrupted operation
(maintenance, failures of providers such as hosting or the police portal). Support at support@hostelflow.it in Italian,
English and Czech, on working days.

### 7. Limitation of liability
The service is free. To the extent the law allows, HostelFlow's total liability to the Customer is limited
to €100. HostelFlow is not liable for indirect damages (e.g. lost profit).
Wilful misconduct and gross negligence are excepted.

### 8. Data and privacy
For guests' data the Customer is the controller and HostelFlow the processor: the **Data Processing
Agreement** in the annex applies (Art. 28 GDPR). Everything else is covered by the Privacy Policy.

### 9. Term and termination
The contract lasts while the account is active. The Customer may close the account at any time;
HostelFlow may close it with 30 days' notice, or at once for a serious breach of these terms. On closure
the Customer's data is deleted within 30 days, except what the law requires to keep.

HostelFlow may transfer this contract, together with the service, to another provider (e.g. if the business
is sold), telling the Customer at least 30 days in advance. The new provider takes on the same obligations,
including those on guests' data as processor; the Customer may close the account before the transfer if it
does not agree.

### 10. Changes
Changes are published with the update date and, if important, e-mailed at least 30 days in advance.
Continuing to use the service after that date means accepting them.

### 11. Law and courts
These terms are governed by Czech law. Disputes go to the courts of [CITY], unless mandatory rules say
otherwise.

---

## Annex — Data Processing Agreement (Art. 28 GDPR)

1. **Subject and duration.** HostelFlow processes guests' data on the Customer's behalf solely to provide
   the service (check-in, Alloggiati Web reporting, ISTAT statistics), for the term of the contract.
2. **Nature and purpose.** Collection (document photo and reading), temporary storage, transmission to the
   State Police on the Customer's instruction, minimisation after sending, deletion.
3. **Data and data subjects.** The property's guests: identity and document data, citizenship, place and
   date of birth, residence, stay dates; document photo. No special categories (Art. 9) are required.
4. **Instructions.** HostelFlow processes data only on the Customer's documented instructions (using the
   app counts as an instruction) and tells the Customer if it believes an instruction is unlawful.
5. **Confidentiality.** People authorised to process the data are bound to confidentiality.
6. **Security (Art. 32).** Encrypted connections, passwords only as hashes, encrypted credentials,
   role-based access, deletion of photos as soon as the guest is sent (in any case within 48 hours) and of unsent guests after 3 days,
   removal of personal data after sending.
7. **Sub-processors.** The Customer authorises the sub-processors listed in the Privacy Policy (Cloudflare,
   Anthropic, Resend and, if used, Channex). HostelFlow announces new sub-processors in advance; the
   Customer may object and, in that case, terminate. If the Customer connects its own Claude account, document
   photos go to Anthropic under that account, on the terms between the Customer and Anthropic.
8. **Assistance.** HostelFlow helps the Customer answer data subjects' requests and with Arts. 32–36 GDPR,
   as far as it reasonably can.
9. **Breaches.** HostelFlow notifies the Customer of any personal data breach without undue delay and in
   any case within 48 hours of becoming aware of it.
10. **End of processing.** At the end of the contract HostelFlow deletes guests' data within 30 days (much
    of it is deleted automatically far earlier), unless the law requires otherwise.
11. **Audits.** HostelFlow makes available the information needed to show compliance with this agreement.
