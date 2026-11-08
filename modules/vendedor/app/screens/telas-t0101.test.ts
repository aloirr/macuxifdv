import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as telas importam react-native e não rodam no Node: confere no fonte (mesmo padrão de slot-em-nome.test.ts)
const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8');

describe('T-0101: tela de Pedidos', () => {
  const s = fonte('orders-screen.tsx');
  it('Y11: o número usa trechosDoNumero e fonte mono, sem map inline de destacarTrecho(o.number', () => {
    expect(s).toContain('trechosDoNumero(o.number, busca)');
    expect(s).toContain('fonts.mono');
    expect(s).not.toContain('destacarTrecho(o.number');
    expect(s).toContain('order-numero-destaque');
    expect(s).toContain('order-numero-${o.number}');
  });
  it('Y11: destaque com tokens do kit, legível ao sol', () => {
    expect(s).toMatch(/destaque: \{ backgroundColor: colors\.accentSoft, color: colors\.accentInk \}/);
  });
  it('R1: a situação efetiva e o placeholder do Gestão continuam na tela', () => {
    expect(s).toContain('situacaoEfetiva');
    expect(s).toContain('Cliente ou nº');
  });
});

describe('T-0101 (RN-VEN-35): seletor de clientes do novo pedido', () => {
  const s = fonte('new-order-screen.tsx');
  it('usa o CampoBusca do kit e a lib seletor-em-nome', () => {
    expect(s).toContain('<CampoBusca valor={q}');
    expect(s).toContain('testID="picker-search"');
    expect(s).toContain('seletorEmNome(');
    expect(s).toContain('rotuloAcessivelDaOpcao');
    expect(s).not.toContain('SearchBox');
  });
  it('a linha de outra carteira é desabilitada e sem chevron', () => {
    expect(s).toContain('disabled={!o.selecionavel}');
    expect(s).toContain('accessibilityState={o.selecionavel ? undefined : { disabled: true }}');
    expect(s).toContain('{o.selecionavel ? <Icon name="chevron"');
  });
  it('mantém os testIDs das linhas selecionáveis', () => {
    expect(s).toContain('testID={`pick-${c.trade_name}`}');
  });
});
