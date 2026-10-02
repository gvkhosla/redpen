import { stripVTControlCharacters } from 'node:util';

// Keep prose, not terminal commands or bidirectional display overrides.
export function terminalText(value) {
  return stripVTControlCharacters(String(value))
    .replace(/[\r\n\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}

export function markdownText(value) {
  return terminalText(value).replace(/\s+/g, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#!|~]/g, '\\$&')
    // Break GFM autolink recognition before entity decoding, preserving visible prose.
    .replace(/\b(https?|ftp):/gi, '$1&#58;')
    .replace(/\bwww\./gi, 'www&#46;')
    .replace(/@/g, '&#64;');
}

export function mapStrings(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(v => mapStrings(v, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, transform)]));
  return value;
}

// Preserve machine-readable values while making raw JSON safe to print.
export function serialize(value) {
  return JSON.stringify(value, null, 2).replace(/[\u202a-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}
