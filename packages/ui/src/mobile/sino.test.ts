import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contraste } from '../comum/contraste';
import { ALVO_TOQUE } from './componentes';
import { coresDoSino, leituraDoSino, SINO, temNovoNoSino } from './sino';
import { colors } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');
const cor = (token: string): string => (colors as Record<string, string>)[token] ?? '';

describe('SinoNotificacoes (v1.0.17, R-20261120-055304 item 2)', () => {
  it('botão de 48 dp, ícone bell 22 e bolinha de 12', () => {
    expect(SINO.botao).toBe(ALVO_TOQUE);
    expect(SINO.botao).toBeGreaterThanOrEqual(48);
    expect(SINO.icone).toBe(22);
    expect(SINO.bolinha).toBe(12);
    expect(ler('./sino-rn.tsx')).toContain('<Icon name="bell" size={SINO.icone}');
  });

  it('só a bolinha, sem número, e só quando há novo', () => {
    expect(temNovoNoSino(0)).toBe(false);
    expect(temNovoNoSino(Number.NaN)).toBe(false);
    expect(temNovoNoSino(1)).toBe(true);
    expect(ler('./sino-rn.tsx')).not.toContain('<Text');
  });

  it('cores com contraste: ícone ≥ 4,5:1 no Pérola e ≥ 3:1 na faixa, bolinha ≥ 3:1', () => {
    const faixa = coresDoSino(true);
    expect(contraste(cor(faixa.icone), colors.faixa)).toBeGreaterThanOrEqual(3);
    expect(contraste(cor(faixa.bolinhaFundo), colors.faixa)).toBeGreaterThanOrEqual(3);
    const perola = coresDoSino(false);
    expect(contraste(cor(perola.icone), cor(perola.botaoFundo))).toBeGreaterThanOrEqual(4.5);
  });

  it('leitura do TalkBack', () => {
    expect(leituraDoSino(0)).toBe('Recados e tarefas');
    expect(leituraDoSino(2)).toBe('Recados e tarefas, há novos');
  });
});
