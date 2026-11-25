import { describe, expect, it } from 'vitest';
import {
  buildMailtoUrl,
  buildWhatsappUrl,
  normalizeIndianPhone
} from '../../src/lib/shareLinks.js';

describe('invoice share links', () => {
  it.each([
    ['98765 43210', '919876543210'],
    ['+91 98765 43210', '919876543210'],
    ['919876543210', '919876543210'],
    ['12345', null],
    ['abc9876543210', null],
    [null, null]
  ])('normalizes %s', (phone, expected) => {
    expect(normalizeIndianPhone(phone)).toBe(expected);
  });

  it('builds encoded WhatsApp and email links', () => {
    expect(buildWhatsappUrl({ phone: '98765 43210', text: 'Invoice INV/1' }))
      .toBe('https://wa.me/919876543210?text=Invoice%20INV%2F1');
    expect(buildWhatsappUrl({ phone: null, text: 'Invoice' }))
      .toBe('https://wa.me/?text=Invoice');
    expect(buildMailtoUrl({ subject: 'Tax invoice', body: 'Ready now' }))
      .toBe('mailto:?subject=Tax%20invoice&body=Ready%20now');
  });
});
