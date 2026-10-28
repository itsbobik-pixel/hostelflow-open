// The sex from the machine-readable zone (the "<<<" lines), checked without AI.
// The reader copies the MRZ; the sex letter sits between the date of birth and
// the date of expiry on every format (passports TD3, ID cards TD1/TD2), each
// date followed by its ICAO check digit. When both dates check out, the line
// was copied right, and so was the letter between them. Written here instead of
// a library: this one letter is all we take from it.

const value = ch => (ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : 0);
export function checkDigit(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += value(s[i]) * [7, 3, 1][i % 3];
  return String(sum % 10);
}

const date = s => +s.slice(2, 4) >= 1 && +s.slice(2, 4) <= 12 && +s.slice(4, 6) >= 1 && +s.slice(4, 6) <= 31;

// 'M', 'F', or '' (no MRZ, a check digit that does not match, or "<" = not stated).
export function mrzSex(text) {
  const lines = String(text || '').toUpperCase().replace(/[ \t]/g, '').split(/[\r\n]+/);
  for (const line of lines) {
    const re = /(?=(\d{6})(\d)([MF<])(\d{6})(\d))/g;
    for (const [, dob, dobCheck, sex, expiry, expiryCheck] of line.matchAll(re)) {
      if (date(dob) && date(expiry) && checkDigit(dob) === dobCheck && checkDigit(expiry) === expiryCheck) return sex === '<' ? '' : sex;
    }
  }
  return '';
}
