/**
 * T-0196 (v1.0.36; ADR 0076, RN-VEN-02 v3) — valor × rótulo da quantidade fracionária na gaveta do pedido do BKO
 * (`modules/vendedor/web/components/orders/order-drawer.tsx`). A gaveta usa `usePedido` (react-query + sessão), então o teste
 * prova a regra pela função REAL que ela chama (`quantidadeDoPdf` nas colunas "Qtd" e "Faturado"; a unidade está na coluna
 * "Emb.", ao lado, então o BKO mostra só o número, RD-3626) e confere no fonte que as duas colunas usam essa função.
 * A conferência no DOM com dados reais fica no roteiro manual da T-0196. Agente `testes`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { quantidadeDoPdf } from '../../modules/vendedor/domain/pdf-pedido';

const RAIZ = join(__dirname, '../..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

/** Oráculo pela regra (RN-VEN-02 v3): KG/M com vírgula e de 3 a 4 casas, sem a sigla (a unidade está em "Emb."). */
const esperadoQtd = (q: number) => {
  const [int, dec = ''] = q.toFixed(4).split('.');
  const casas = dec.replace(/0$/, '');
  return `${int},${casas}`;
};

describe('T-0196 — BKO, gaveta do pedido: quantidade fracionária (valor × rótulo)', () => {
  it('RN-VEN-02 v3: coluna Qtd de 1,25 kg mostra "1,250" (a unidade já está em Emb.)', () => {
    const item = { quantity: 1.25, unit_label: 'KG' };
    expect(quantidadeDoPdf(item)).toBe('1,250');
    expect(quantidadeDoPdf(item)).toBe(esperadoQtd(1.25));
  });

  it('Faturado "1,250 de 2,500": o texto que a gaveta monta com as duas chamadas', () => {
    const fat = { quantity: 1.25, unit_label: 'KG' };
    const base = { quantity: 2.5, unit_label: 'KG' };
    expect(`${quantidadeDoPdf(fat)} de ${quantidadeDoPdf(base)}`).toBe('1,250 de 2,500');
    expect(`${quantidadeDoPdf(fat)} de ${quantidadeDoPdf(base)}`).toBe(`${esperadoQtd(1.25)} de ${esperadoQtd(2.5)}`);
  });

  it('limites: 4 casas ficam (0,1255); inteiro em KG ganha 3 casas (2,000); metro também é fracionário (1,500)', () => {
    expect(quantidadeDoPdf({ quantity: 0.1255, unit_label: 'KG' })).toBe('0,1255');
    expect(quantidadeDoPdf({ quantity: 2, unit_label: 'KG' })).toBe('2,000');
    expect(quantidadeDoPdf({ quantity: 1.5, unit_label: 'M' })).toBe('1,500');
  });

  it('fora de KG/M nada muda: CX e UN inteiras seguem o número puro, como antes da v1.0.36', () => {
    expect(quantidadeDoPdf({ quantity: 12, unit_label: 'CX' })).toBe('12');
    expect(quantidadeDoPdf({ quantity: 3, unit_label: 'UN' })).toBe('3');
  });

  it('a gaveta usa quantidadeDoPdf nas colunas Qtd e Faturado (sem o número cru)', () => {
    const gaveta = ler('modules/vendedor/web/components/orders/order-drawer.tsx');
    expect(gaveta).toContain('<td className={tdNum}>{quantidadeDoPdf(it)}</td>');
    expect(gaveta).not.toContain('<td className={tdNum}>{it.quantity}</td>');
    expect(gaveta).toContain(
      '`${quantidadeDoPdf({ quantity: it.quantity_invoiced ?? 0, unit_label: it.unit_label })} de ${quantidadeDoPdf({ quantity: it.quantity_base ?? it.quantity, unit_label: it.unit_label })}`',
    );
    expect(gaveta).not.toContain('`${it.quantity_invoiced ?? 0} de ${it.quantity_base ?? it.quantity}`');
  });
});
