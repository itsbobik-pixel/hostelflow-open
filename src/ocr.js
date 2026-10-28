// Reads an identity document photo with Claude and returns guest fields.
// The prompt comes from the Costello app, where it has been in daily use;
// structured outputs replace its "reply with raw JSON" instruction.

import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_PRICES, tokenCostMicro } from './claude-prices.js';
import { resolveComune } from './registration/it/alloggiati.js';
import { mrzSex } from './mrz.js';

export const OCR_MODEL = 'claude-sonnet-5';
// USD per million tokens, for the cost shown in Settings (prices: claude-prices.js).
export const OCR_PRICE = CLAUDE_PRICES[OCR_MODEL];
export const priceOf = model => CLAUDE_PRICES[model] || OCR_PRICE;
// A scan's cost in millionths of a dollar.
export const costMicro = (model, usage = {}) => tokenCostMicro(priceOf(model), usage);
// What a reading must have before the cheaper model's result is enough on its own.
// The document type is not among them: the form starts on "passport" and staff
// change it with one click — not worth a second, dearer reading.
export const REQUIRED_READ = ['surname', 'given', 'sex', 'dob', 'nationality', 'docNumber'];

const SYSTEM = `You read identity documents (passports, national ID cards) from a photo and extract guest check-in data for a hostel. Accuracy matters a lot — this data goes into an official police/government registration system, so a wrong character can cause real problems.

Read carefully:
- Use the printed/typed fields on the document as your primary source (Surname, Given names, Date of birth, Passport/Document No., Date of expiry, etc.).
- Cross-check against the MRZ (machine-readable zone — the two or three lines of text with "<" characters, usually at the bottom of a passport bio page) when present. If the printed text and MRZ disagree, prefer the clearer, more legible one and note the discrepancy in "notes".
- Sex: the printed field (Sex / Sesso / Sexe / Geschlecht / Sexo / Pohlaví…, often bilingual like "M/M" or "F/F") or, always unambiguous, the MRZ: in the line with the date of birth, the single letter right after the birth date and its check digit is M or F ("<" = not stated). Read it from the MRZ when the printed field is small or hard to read. First say in "sexSource" where you read it: "printed", "mrz", or "not_visible". Never work the sex out from the name, the photo or anything else — names like Andrea, Nicola or Simone are men in Italy and women elsewhere. If you cannot actually see the letter, sexSource is "not_visible" and sex is empty.
- Do not swap surname and given name. Do not swap date of birth and date of expiry.
- If any field is unclear, blurry, or you are not confident, leave it empty rather than guessing, and mention it in "notes".
- Dates are DD.MM.YYYY. Country codes are ISO 3166-1 alpha-3 as in the MRZ (MRZ "D" = DEU).
- Italian documents: the issuing comune is printed as "COMUNE DI <NAME>" (ID cards) — put just the name in issuePlace. Place of birth is often printed as "<COMUNE> (<XX>)": put the comune in birthPlace and the two-letter province in birthProvince. The Italian electronic ID card (CIE, a plastic card with a chip) is docType "electronic_id"; the older paper ID card is "id_card".
- Italian ID cards also print where the holder lives ("RESIDENZA", "INDIRIZZO DI RESIDENZA", often on the back): put the comune in residencePlace and its two-letter province in residenceProvince. Never the street or house number.
- Italians born abroad: Italian documents print the place of birth as "<CITY> (<COUNTRY>)" or "<CITY> <COUNTRY>" (e.g. "BUENOS AIRES (ARG)"): put the city in birthPlace, the country's ISO3 code in birthCountry, and leave birthProvince empty. Fill birthCountry whenever the country of birth is printed or clear from the place; leave it empty only for someone born in the country that issued the document.
- Italian passports: the issuing authority "QUESTURA DI <CITY>" means issuePlace <CITY>. A passport issued by an Italian consulate or embassy abroad ("CONSOLATO ...", "AMBASCIATA ...", "MAE"/foreign city): put the country where it is (ISO3) in issuePlace.
- Italian driving licence (patente, docType "driving_licence"): field 3 is date and place of birth, field 4c the issuing authority. "MIT-UCO" is the ministry office in Rome: issuePlace "ROMA". For "MCTC-XX", "UCO-XX" or "PREFETTO DI <CITY>" put that city in issuePlace (the city, not the office) and XX in issueProvince.

If the image is not an identity document, or is unreadable, return empty fields, confidence "low", and a short note explaining why.`;

const str = description => ({ type: 'string', description });

const SCHEMA = {
  type: 'object',
  properties: {
    // First, so the fields below can be checked against it; the sex is taken from it in code (mrz.js).
    mrz: str('the MRZ lines exactly as printed, "<" included, one line per row; empty if the photo shows no MRZ'),
    surname: str('surname(s)'),
    given: str('given name(s)'),
    docNumber: str('document number'),
    nationality: str('nationality as printed'),
    nationalityCode: str('ISO3 code of the nationality, or empty'),
    dob: str('date of birth DD.MM.YYYY, or empty'),
    // Before sex, so the model says where it saw it before it answers (see readDocument).
    sexSource: { type: 'string', enum: ['printed', 'mrz', 'not_visible'] },
    sex: { type: 'string', enum: ['M', 'F', ''] },
    expiry: str('date of expiry DD.MM.YYYY, or empty'),
    country: str('issuing country name'),
    countryCode: str('ISO3 code of the issuing country, or empty'),
    docType: { type: 'string', enum: ['passport', 'id_card', 'electronic_id', 'driving_licence', ''] },
    birthPlace: str('place of birth (for Italy: the comune only), or empty'),
    birthCountry: str('ISO3 code of the country of birth if printed or clear from the place of birth, else empty'),
    birthProvince: str('Italian two-letter province of birth, e.g. SP, or empty'),
    issuePlace: str('Italian documents: the issuing comune (from "COMUNE DI ..."), else empty'),
    issueProvince: str('Italian two-letter province of the issuing comune if printed, else empty'),
    residencePlace: str('Italian ID cards: the comune of residence (no street), else empty'),
    residenceProvince: str('Italian ID cards: two-letter province of residence, else empty'),
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: str('short note if something was unclear or printed text disagreed with the MRZ, else empty'),
  },
  required: ['mrz', 'surname','given', 'docNumber', 'nationality', 'nationalityCode', 'dob', 'sexSource', 'sex', 'expiry',
    'country', 'countryCode', 'docType', 'birthPlace', 'birthCountry', 'birthProvince', 'issuePlace', 'issueProvince',
    'residencePlace', 'residenceProvince', 'confidence', 'notes'],
  additionalProperties: false,
};

// image: { mediaType: 'image/jpeg', data: <base64> }.
// Returns { fields, confidence, notes, usage }.
// model: another one to try (the shadow comparison below); Haiku 5.5 thinks
// adaptively, so there it is kept low with effort instead of switched off.
export async function readDocument(env, image, client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), model = OCR_MODEL) {
  const haiku = /haiku-5/.test(model);
  const response = await client.messages.create({
    model,
    // Haiku's thinking counts against this too: 2000 once ran out before the
    // answer (24. 10., after the MRZ field). Only tokens used are billed.
    max_tokens: 4000,
    // Reading a document is transcription, not reasoning: thinking tokens
    // (billed as output) made most of the cost without improving results.
    ...(haiku ? {} : { thinking: { type: 'disabled' } }),
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA }, ...(haiku ? { effort: 'low' } : {}) },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: 'Extract the guest data from this identity document photo.' },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('the document could not be read');
  const text = response.content.find(b => b.type === 'text');
  // The stop reason tells a reply cut short (max_tokens, e.g. spent on thinking) from an empty one.
  if (!text) throw new Error(`no answer from the reader (stop: ${response.stop_reason})`);
  // JSON.parse quotes the start of a bad answer in its error — what was read off
  // the document — and errors end up in logs and alert e-mails.
  let out;
  try { out = JSON.parse(text.text); } catch { throw new Error(`the reader's answer was not complete (stop: ${response.stop_reason})`); }
  // A sex whose MRZ line passes its check digits is certain: it wins over the
  // model's own answer, and no second, dearer reading is needed for it.
  const sexFromMrz = mrzSex(out.mrz);

  // One field per concept for staff to edit: the ISO3 code wins where the
  // model gave one (the registration modules resolve both codes and names).
  const fields = {
    surname: out.surname,
    given: out.given,
    // Haiku filled in a wrong sex rather than leaving it empty (13.–20. 10.), so the
    // main model was never asked: a sex not seen on the document is dropped, which
    // makes it a gap the main model fills (guests.js).
    sex: sexFromMrz || (out.sexSource === 'not_visible' ? '' : out.sex),
    dob: out.dob,
    nationality: out.nationalityCode || out.nationality,
    docType: out.docType,
    docNumber: out.docNumber,
    country: out.countryCode || out.country,
    birthPlace: out.birthPlace,
    birthCountry: out.birthCountry,
    birthProvince: out.birthProvince,
    issuePlace: out.issuePlace,
    issueProvince: out.issueProvince,
    // For ISTAT (Alloggiati never asks): the residence printed on Italian ID cards.
    residencePlace: out.residencePlace,
    residenceProvince: out.residenceProvince,
    expiry: out.expiry,
  };
  // Not printed (or not on this photo): an Italian ID card is issued by the comune
  // the holder lives in, so its province is the best guess — staff can change it.
  // Costello 23. 10.: born in Uruguay, card from Pisa, no province for ISTAT.
  if (!fields.residenceProvince && (out.docType === 'id_card' || out.docType === 'electronic_id') && out.issuePlace) {
    const c = resolveComune(out.issuePlace, out.issueProvince);
    if (c) fields.residenceProvince = c.prov;
  }
  for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
  return { fields, confidence: out.confidence, notes: out.notes, usage: response.usage, ...(sexFromMrz ? { sexFromMrz: true } : {}) };
}
