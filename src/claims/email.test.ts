import { describe, expect, it } from 'vitest';
import { validateEmail } from './email';

describe('email validation', () => {
  it.each(['winner@example.com', 'User+gift@sub.example.co.uk', "o'connor@example.fr", 'x@xn--bcher-kva.de'])('accepts %s', (email) => {
    expect(validateEmail(email)).toBe(email);
  });
  it('trims outer whitespace and normalizes only the domain', () => {
    expect(validateEmail('  Winner+Tag@EXAMPLE.COM  ')).toBe('Winner+Tag@example.com');
  });
  it.each([null, undefined, 123, '', ' ', 'plain', 'a@@example.com', '@example.com', 'a@', 'a@localhost', '.a@example.com',
    'a.@example.com', 'a..b@example.com', 'a b@example.com', 'a\nb@example.com', 'a@example..com', 'a@-example.com',
    'a@example-.com', 'a@example.com.', 'a@exam_ple.com', 'a@example.123', 'a@éxample.fr', 'é@example.fr',
    '"quoted"@example.com', 'a'.repeat(65) + '@example.com', 'a@' + 'b'.repeat(64) + '.com',
  ])('rejects invalid or unsupported input: %j', (value) => { expect(validateEmail(value)).toBeNull(); });
  it('accepts 254 characters and rejects the next character', () => {
    const max = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(max).toHaveLength(254);
    expect(validateEmail(max)).toBe(max);
    expect(validateEmail(max + 'e')).toBeNull();
  });
});
