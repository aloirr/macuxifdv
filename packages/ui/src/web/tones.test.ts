import { describe, expect, it } from 'vitest';
import { coverageTone, integratedTone, projectionTone } from './tones';

describe('cores dos faróis', () => {
  it.each([
    [81, 'success'],
    [70, 'success'],
    [69.9, 'accent'],
    [55, 'accent'],
    [54, 'danger'],
  ] as const)('positivação %d%% → %s', (pct, tone) => expect(coverageTone(pct)).toBe(tone));

  it.each([
    [121, 'success'],
    [100, 'success'],
    [98, 'ink'],
    [90, 'ink'],
    [89, 'danger'],
  ] as const)('projeção %d%% → %s', (pct, tone) => expect(projectionTone(pct)).toBe(tone));

  it('integrado sem intervenção vs meta', () => {
    expect(integratedTone(96, 95)).toBe('success');
    expect(integratedTone(88, 95)).toBe('warning');
    expect(integratedTone(76.2, 95)).toBe('danger');
  });
});
