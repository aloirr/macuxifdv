import { describe, expect, it } from 'vitest';

import { limparRascunhosExpirados } from '../../domain/rascunhos';
import type { Rascunho } from './pedidos';
import { linhasDosRascunhos, TEXTOS_RASCUNHOS, textoDaAlteracao } from './rascunhos-lista';
import { abaInicialDoRascunho } from './textos-pedido';

const TZ = 'America/Manaus';
const base = { discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null } as const;
const r = (extra: Partial<Rascunho>): Rascunho => ({ ...base, customer_id: 'c1', lines: { p1: 1, p2: 2, p3: 1 }, updated_at: '2026-11-09T09:51:00.000Z', ...extra });
const clientes = [
  { id: 'c1', trade_name: 'Atacadinho Cachoeirinha', erp_code: 'C5007' },
  { id: 'c2', trade_name: 'Mercadinho São Jorge', erp_code: 'C5002' },
];
// 09:51 UTC = 05:51 em Manaus (UTC-4)
const agora = new Date('2026-11-09T13:00:00.000Z');
const total = (rr: Rascunho) => (rr.customer_id === 'c1' ? 6996 : 1990);
const lista = (rascunhos: Record<string, Rascunho>, pedidos: Array<{ id: string; number: string; tipo?: 'pedido' | 'orcamento' }> = [], totalDoRascunho: (x: Rascunho) => number | null = total) =>
  linhasDosRascunhos({ rascunhos, clientes, pedidos, totalDoRascunho, agora, tz: TZ });

describe('RN-VEN-39: tela Rascunhos (T-0141 F.2)', () => {
  it('RN-VEN-39 / T-0171 RD-0214: cliente, total e um único fato ("Alterado hoje às 05:51"), do mais recente ao mais antigo', () => {
    const l = lista({ c1: r({}), c2: r({ customer_id: 'c2', lines: { p1: 1 }, updated_at: '2026-11-09T11:00:00.000Z' }) });
    expect(l.map((x) => x.cliente)).toEqual(['Mercadinho São Jorge', 'Atacadinho Cachoeirinha']);
    expect(l[1]).toMatchObject({ chave: 'c1', total_cents: 6996, fato: 'Alterado hoje às 05:51', someEm: null, foraDaCarteira: false });
    expect(l[0]!.fato).toBe('Alterado hoje às 07:00');
    // sem o código do cliente nem o nº de itens na linha
    for (const x of l) expect(Object.values(x).join(' ')).not.toMatch(/cód\.|\bitens?\b/);
  });
  it('RN-VEN-39: ontem e dd/mm; "Some em" só nas últimas 3 h (relógio injetado)', () => {
    expect(textoDaAlteracao('2026-11-08T12:10:00.000Z', agora, TZ)).toBe('Alterado ontem às 08:10');
    expect(textoDaAlteracao('2026-11-07T12:10:00.000Z', agora, TZ)).toBe('Alterado 07/11 às 08:10');
    expect(lista({ c1: r({ updated_at: '2026-11-08T14:00:00.000Z' }) })[0]!.someEm).toBe('Some em 1 h');
    expect(lista({ c1: r({ updated_at: '2026-11-08T15:30:00.000Z' }) })[0]!.someEm).toBe('Some em 2 h');
    expect(lista({ c1: r({ updated_at: '2026-11-08T13:40:00.000Z' }) })[0]!.someEm).toBe('Some em 40 min');
    expect(lista({ c1: r({ updated_at: '2026-11-08T22:00:00.000Z' }) })[0]!.someEm).toBeNull();
  });
  it('RN-VEN-39: o que passou de 24 h não aparece', () => {
    expect(lista({ c1: r({ updated_at: '2026-11-08T12:59:00.000Z' }) })).toEqual([]);
  });
  it('RN-VEN-39: edição de registro salvo traz só o número, pode ter 0 itens e também some 24 h depois da última alteração (sem exceção)', () => {
    const pedidos = [{ id: 'o1', number: '000012', tipo: 'orcamento' as const }];
    const viva = '2026-11-08T13:01:00.000Z'; // 23 h 59 min antes de "agora"
    const l = lista({ 'edit:o1': r({ edit_order_id: 'o1', tipo: 'orcamento', lines: {}, updated_at: viva }) }, pedidos, () => 0);
    expect(l[0]).toMatchObject({ chave: 'edit:o1', fato: 'Edição do orçamento 000012', someEm: 'Some em 1 min', total_cents: 0 });
    const p = lista({ 'edit:o2': r({ edit_order_id: 'o2' }) }, [{ id: 'o2', number: '000013', tipo: 'pedido' }]);
    expect(p[0]!.fato).toBe('Edição do pedido 000013');
    // 24 h + 1 min: a edição some da lista e a limpeza a remove; o registro salvo (fora do mapa de rascunhos) continua intacto
    const velha = r({ edit_order_id: 'o1', tipo: 'orcamento', lines: {}, updated_at: '2026-11-08T12:59:00.000Z' });
    expect(lista({ 'edit:o1': velha }, pedidos, () => 0)).toEqual([]);
    const limpeza = limparRascunhosExpirados({ 'edit:o1': velha }, agora);
    expect(limpeza.removidos).toEqual(['edit:o1']);
    expect(limpeza.mantidos).toEqual({});
    expect(pedidos).toEqual([{ id: 'o1', number: '000012', tipo: 'orcamento' }]);
  });
  it('RN-VEN-39: cliente fora da carteira vira linha sem toque com a frase no lugar da data', () => {
    expect(lista({ x: r({ customer_id: 'zz' }) })[0]).toMatchObject({ foraDaCarteira: true, fato: 'Cliente fora da sua carteira' });
  });
  it('RN-VEN-39: textos da spec e total sem tabela fica nulo', () => {
    expect(TEXTOS_RASCUNHOS.titulo).toBe('Rascunhos');
    expect(TEXTOS_RASCUNHOS.vazio).toEqual({ titulo: 'Nenhum rascunho', apoio: 'O pedido que você deixa sem enviar fica aqui por 24 h.', acao: 'Voltar a Pedidos' });
    expect(TEXTOS_RASCUNHOS.erro).toEqual({ titulo: 'Não foi possível abrir os rascunhos', apoio: 'Puxe a tela para tentar de novo.' });
    expect(lista({ c1: r({}) }, [], () => null)[0]!.total_cents).toBeNull();
  });
  it('RN-VEN-39: tocar retoma na aba em que parou; o "Apenas salvar" abre no Resumo; sem nada, Venda', () => {
    expect(abaInicialDoRascunho({ aba: 'itens' })).toBe('itens');
    expect(abaInicialDoRascunho({ aba: 'entrega', salvo_em: '2026-11-09T10:00:00Z' })).toBe('resumo');
    expect(abaInicialDoRascunho({ salvo_em: '2026-11-09T10:00:00Z' })).toBe('resumo');
    expect(abaInicialDoRascunho({})).toBe('venda');
  });
});
