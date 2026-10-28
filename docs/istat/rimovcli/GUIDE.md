# HostelFlow → RiMovCli (Liguria): how to send your daily guest numbers

For properties in **Liguria** that report ISTAT C/59 movements to the regional portal
RIMOVCLI. HostelFlow builds the XML files from your check-ins; **you upload them by hand**
on the portal (there is no automatic sending for RIMOVCLI — the Region has no web service).
Status: Regione Liguria confirmed on 20 Oct 2026 that our files are valid and that
HostelFlow goes on its list of compatible software. Nothing has to be filed by the property.

> Draft for the clients (Italian version to be made before sending).

## Before you start (once)

1. **Get the Region to enable RiMovCli for your property.** You then receive your
   **regional property code** (a number like `123456789` — *not* the CITR). New
   properties start in **ONLINE** mode (typing the numbers on the portal): ask the Region
   (assistenzac59.laspezia@regione.liguria.it) to switch you to **XML** mode.
2. In HostelFlow open **Settings → Reports → Italy → RiMovCli**.
3. Type the **regional property code** and press **Save**.
4. Check **rooms and beds** — RiMovCli uses the same numbers as Ross1000 (if empty,
   HostelFlow counts them from Settings → Property).

## Every day, or every week (at the latest in the first days of the next month)

1. Check in all guests in HostelFlow as usual. Every guest needs a **country of
   residence**, and Italian residents a **province**.
2. Open **Settings → Reports → RiMovCli**, pick **From** and **To** (one day = one XML
   file; several days = one zip with a file per day) and press **Download XML files**.
3. If the message says guests are left out, fix their residence in Check-in and download
   again (see "Good to know").
4. Unzip if needed, sign in on the RIMOVCLI portal with **SPID, CIE or CNS**, and
   upload the files **one after another, oldest first**. The file name doesn't matter.

## The first day with HostelFlow (important)

Every daily file carries the situation of the night before. The portal **refuses a file
whose "present" numbers don't follow from the previous day** (present = yesterday's present
+ arrivals − departures). So on the first day you use HostelFlow:

- everyone **already staying** that day must be entered in HostelFlow too (with their
  real arrival date and nights), otherwise the numbers won't match what the old program
  or the portal already has;
- the easiest start is a day when the house is empty, or the first of a month;
- the days before that stay in the old program — upload those from there.

## What is in the file

- Per day: guests who arrived, left and stayed that night, grouped by place of residence
  (Italian province or foreign country) — **no names, no document numbers**.
- Your rooms and beds and `HostelFlow` as the software name.
- A day with guests staying but nobody arriving or leaving is still reported; a day with
  an empty house has no movement rows.

## Good to know

- **Only guests registered in HostelFlow are counted.**
- A guest with no country (or an Italian with no province) is **left out** of the file.
  That's why HostelFlow warns you — fix it before uploading.
- If you change a guest (nights, residence) **after** you uploaded that day, the next
  days no longer follow from it: download and upload the affected days again.
- Day guests (arrive and leave the same day) are not written — HostelFlow stays are at
  least one night.

## Problems

- *"N guests are left out"* → open those guests and fill in country (and province for Italians).
- *Portal refuses the file* → check the first-day rule above and that you uploaded the
  days in order with nothing missing in between; if it still fails, send the file and the
  portal's message to support@hostelflow.it.
