import { describe, expect, it } from 'vitest';
import { buildLink, parseLink } from '../../src/domain/link';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('parseLink', () => {
  it('takes a bare token', () => {
    expect(parseLink(TOKEN)).toBe(TOKEN);
    expect(parseLink(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('takes a whole link, whichever way it was copied', () => {
    expect(parseLink(`https://sydrouxba5.github.io/imprint/#/handler/${TOKEN}`)).toBe(TOKEN);
    expect(parseLink(`https://example.test/imprint/#/trainer/${TOKEN}`)).toBe(TOKEN);
    expect(parseLink(`http://localhost:5173/#/handler/${TOKEN}?utm=x`)).toBe(TOKEN);
    expect(parseLink(`Imprint handler link: https://example.test/#/handler/${TOKEN} thanks!`)).toBe(TOKEN);
    expect(parseLink(`#/trainer/${TOKEN}`)).toBe(TOKEN);
  });

  it('lower-cases a token that was typed or pasted in capitals', () => {
    expect(parseLink(TOKEN.toUpperCase())).toBe(TOKEN);
  });

  it('refuses anything that is not a 32-character token', () => {
    for (const bad of ['', '   ', 'hello', TOKEN.slice(1), `${TOKEN}0`, `https://example.test/#/handler/${TOKEN.slice(1)}`,
      'g'.repeat(32), `https://example.test/#/teams`]) {
      expect(parseLink(bad), bad).toBeNull();
    }
  });
});

describe('buildLink', () => {
  it('puts the role and token in the fragment, on the app’s own address', () => {
    expect(buildLink('handler', TOKEN, 'https://sydrouxba5.github.io', '/imprint/'))
      .toBe(`https://sydrouxba5.github.io/imprint/#/handler/${TOKEN}`);
    expect(buildLink('trainer', TOKEN, 'http://localhost:5173', '/'))
      .toBe(`http://localhost:5173/#/trainer/${TOKEN}`);
  });

  it('is read back by parseLink', () => {
    expect(parseLink(buildLink('trainer', TOKEN, 'https://x.test', '/imprint/'))).toBe(TOKEN);
  });
});
