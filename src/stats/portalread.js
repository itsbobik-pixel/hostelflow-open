// Report → RiMovCli → Manual edit for the first entry: instead of copying the
// portal's last day by hand, the owner uploads a screenshot of the portal and
// Claude reads the date and the countries off it — either the home page's
// "Ultimo giorno caricato" box (the usual one, Bob 29. 10. 2026) or a day being
// filled in by hand ("Situazione al …", with "Pres. notte prec.").
// Nothing is saved here: the form is filled in, staff check it and press Save
// (a number read wrong would put every later file out of step).
//
// On the property's own Claude key without a limit; on HostelFlow's key at most
// READS_ON_OUR_KEY times per property — it is needed once (Bob, 29. 10. 2026).

import Anthropic from '@anthropic-ai/sdk';
import { HttpError, json, readJson } from '../http.js';
import { requireUser, requirePermission } from '../auth.js';
import { claudeEnv, keyProblem, noteKeyProblem } from '../claudekey.js';
import { OCR_MODEL } from '../ocr.js';
import { parseImage } from '../guests.js';
import { parseStart } from './rimovcli.js';

export const READS_ON_OUR_KEY = 5;

const SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'the day in "Ultimo giorno caricato: DD/MM/YYYY" or "Situazione al DD/MM/YYYY", as YYYY-MM-DD; empty if not visible' },
    confirmed: { type: 'boolean', description: 'true for "Ultimo giorno caricato" or a day already confirmed; false when the page still offers to confirm that day (a "Conferma il …" button)' },
    totalPresent: { type: 'integer', description: 'the TOTALE/TOTALI row number in the column used (Presenti/Pres. for a confirmed day, Pres. notte prec. otherwise); -1 if not visible' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          place: { type: 'string', description: 'the "Residenza" / "Nazione" (or Italian "Provincia") of the row, as written' },
          previous: { type: 'integer', description: 'the "Pres. notte prec." number; 0 if the table has no such column' },
          present: { type: 'integer', description: 'the "Presenti" / "Pres." number' },
        },
        required: ['place', 'previous', 'present'],
        additionalProperties: false,
      },
    },
  },
  required: ['date', 'confirmed', 'totalPresent', 'rows'],
  additionalProperties: false,
};

const SYSTEM = 'You read screenshots of the Italian tourist statistics portal (ISTAT C/59). '
  + 'Several screenshots are the same table scrolled: list each row once. '
  + 'Copy the table exactly: one row per country or province, without the TOTALE/TOTALI row. Read only what is on the screenshots.';

// Up to MAX_SHOTS screenshots of one table (it scrolls on the portal), read in one go.
const MAX_SHOTS = 4;

async function readScreenshot(env, images) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      ...images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
      { type: 'text', text: 'Read the day and the table from these screenshots.' },
    ] }],
  });
  const text = response.content.find(b => b.type === 'text');
  if (!text) throw new Error(`no answer from the reader (stop: ${response.stop_reason})`);
  return JSON.parse(text.text);
}

const dayBefore = iso => new Date(Date.parse(`${iso}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);

// The portal's page -> what the form wants: the last day already on the portal and
// who was there that night. A day not yet confirmed isn't on the portal: the night
// before it is (its "Pres. notte prec." column). missing: guests in the TOTALE
// row but in no row read (a row cut off the screenshot — Bob's first one was).
export function startFromPage(page) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(page.date || '') ? page.date : '';
  const lastDay = date && !page.confirmed ? dayBefore(date) : date;
  const lines = [];
  let sum = 0;
  for (const r of page.rows || []) {
    const n = page.confirmed ? r.present : r.previous;
    if (!(n > 0)) continue;
    sum += n;
    // "Svizzera (incluso Liechtenstein)" -> "Svizzera".
    lines.push(`${String(r.place).replace(/\s*\(.*?\)\s*/g, ' ').trim()} ${n}`);
  }
  const text = lines.join('\n');
  const missing = page.totalPresent > sum ? page.totalPresent - sum : 0;
  return { date: lastDay, text, unread: parseStart(text).bad, missing };
}

export async function readPortalDay(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requirePermission(env.DB, user.id, propertyId, 'police');
  const body = await readJson(request);
  const shots = Array.isArray(body.images) ? body.images : [body.image];
  if (!shots.length || shots.length > MAX_SHOTS) throw new HttpError(400, 'choose 1 to 4 screenshots');
  const images = shots.map(parseImage);
  const property = await env.DB.prepare('SELECT id, claude_credentials, portal_reads FROM properties WHERE id = ?').bind(propertyId).first();
  const claude = await claudeEnv(env, property);
  if (!claude.env.ANTHROPIC_API_KEY && !env.readPortalDay) throw new HttpError(400, 'to read a screenshot, the owner connects Claude in Settings → Check-in scan');
  if (!claude.own && property.portal_reads >= READS_ON_OUR_KEY) {
    throw new HttpError(400, 'the screenshot was read 5 times already — fill in by hand, or the owner connects Claude in Settings → Check-in scan');
  }
  let page;
  try {
    page = await (env.readPortalDay || readScreenshot)(claude.env, images); // env.readPortalDay: test stand-in
  } catch (err) {
    const problem = claude.own && keyProblem(err);
    if (problem) { await noteKeyProblem(env, propertyId, problem); throw new HttpError(400, problem); }
    console.error('portal screenshot not read', err.name); // not the message: it may quote the answer
    throw new HttpError(502, 'the screenshot could not be read — try again, or fill in by hand');
  }
  if (!claude.own) await env.DB.prepare('UPDATE properties SET portal_reads = portal_reads + 1 WHERE id = ?').bind(propertyId).run();
  return json(startFromPage(page));
}
