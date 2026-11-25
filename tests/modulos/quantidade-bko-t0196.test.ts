/**
 * T-0196 (v1.0.36; ADR 0076, RN-VEN-02 v3) — valor × rótulo da quantidade fracionária na gaveta do pedido do BKO
 * (`modules/vendedor/web/components/orders/order-drawer.tsx`). A gaveta usa `usePedido` (react-query + sessão), então o teste
 * prova a regra pelas funções REAIS que ela chama (`quantidadeDoPdf` na coluna "Qtd", ao lado da coluna "Emb." com a unidade;
 * `quantidadeComSigla` na coluna "Faturado", onde a unidade não está ao lado) e confere no fonte que as duas colunas usam
 * essas funções. A conferência no DOM com dados reais fica no roteiro manual da T-0196. Agente `testes`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatarQuantidade } from '@macuxi/comum/quantidade';
import { describe, expect, it } from 'vitest';
import { quantidadeComSigla, quantidadeDoPdf } from '../../modules/vendedor/domain/pdf-pedido';

const RAIZ = join(__dirname, '../..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

/** Oráculo pela regra (RN-VEN-02 v3): KG/M com vírgula e de 3 a 4 casas; a sigla minúscula só onde a unidade não está ao lado. */
const esperadoQtd = (q: number) => {
  const [int, dec = ''] = q.toFixed(4).split('.');
  const casas = dec.replace(/0$/, '');
  return `${int},${casas}`;
};

describe('T-0196 — BKO, gaveta do pedido: quantidade fracionária (valor × rótulo)', () => {
  it('RN-VEN-02 v3: coluna Qtd de 1,25 kg mostra "1,250" (a unidade já está em Emb.); coluna Faturado mostra "1,250 kg"', () => {
    const item = { quantity: 1.25, unit_label: 'KG' };
    expect(quantidadeDoPdf(item)).toBe('1,250');
    expect(quantidadeDoPdf(item)).toBe(esperadoQtd(1.25));
    expect(quantidadeComSigla(item)).toBe('1,250 kg');
    expect(quantidadeComSigla(item)).toBe(formatarQuantidade(1.25, 'KG'));
  });

  it('Faturado "0,500 kg de 1,250 kg": o texto que a gaveta monta com as duas chamadas', () => {
    const fat = { quantity: 0.5, unit_label: 'KG' };
    const base = { quantity: 1.25, unit_label: 'KG' };
    expect(`${quantidadeComSigla(fat)} de ${quantidadeComSigla(base)}`).toBe('0,500 kg de 1,250 kg');
  });

  it('limites: 4 casas ficam (0,1255 kg); inteiro em KG ganha 3 casas (2,000 kg); metro também é fracionário (1,500 m)', () => {
    expect(quantidadeComSigla({ quantity: 0.1255, unit_label: 'KG' })).toBe('0,1255 kg');
    expect(quantidadeDoPdf({ quantity: 0.1255, unit_label: 'KG' })).toBe('0,1255');
    expect(quantidadeComSigla({ quantity: 2, unit_label: 'KG' })).toBe('2,000 kg');
    expect(quantidadeDoPdf({ quantity: 2, unit_label: 'KG' })).toBe('2,000');
    expect(quantidadeComSigla({ quantity: 1.5, unit_label: 'M' })).toBe('1,500 m');
  });

  it('fora de KG/M nada muda: CX inteira segue o número puro, como antes da v1.0.36', () => {
    expect(quantidadeDoPdf({ quantity: 12, unit_label: 'CX' })).toBe('12');
    expect(quantidadeComSigla({ quantity: 12, unit_label: 'CX' })).toBe('12');
    expect(quantidadeComSigla({ quantity: 3, unit_label: 'UN' })).toBe('3');
  });

  it('a gaveta usa as duas funções nas colunas Qtd e Faturado (sem o número cru)', () => {
    const gaveta = ler('modules/vendedor/web/components/orders/order-drawer.tsx');
    expect(gaveta).toContain('<td className={tdNum}>{quantidadeDoPdf(it)}</td>');
    expect(gaveta).not.toContain('<td className={tdNum}>{it.quantity}</td>');
    expect(gaveta).toContain(
      '`${quantidadeComSigla({ quantity: it.quantity_invoiced ?? 0, unit_label: it.unit_label })} de ${quantidadeComSigla({ quantity: it.quantity_base ?? it.quantity, unit_label: it.unit_label })}`',
    );
    expect(gaveta).not.toContain('`${it.quantity_invoiced ?? 0} de ${it.quantity_base ?? it.quantity}`');
  });
});
