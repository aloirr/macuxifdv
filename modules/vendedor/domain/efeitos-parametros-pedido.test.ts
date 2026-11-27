import { describe, expect, it } from 'vitest';
import { efeitosDosParametrosDoPedido } from './aprovacao';

const financeiroSemSaldo = { limite_informado: true, disponivel_cents: 1000, maior_atraso_dias: 0, limite_dias: 5 };
const base = { parametros: {}, tipo: 'pedido' as const, total_cents: 50_000, prazo_medio_dias: 28, falta_estoque: false, financeiro: financeiroSemSaldo };

describe('efeitosDosParametrosDoPedido (RN-VEN-12, RN-VEN-20, RN-VEN-22)', () => {
  it('RN-VEN-12: crédito excedido com o padrão abre a aprovação de crédito no nível de Alçadas e não bloqueia', () => {
    const r = efeitosDosParametrosDoPedido({ ...base, parametros: { 'aprovacao.credito_nivel': 'analista' } });
    expect(r.aprovacoes.map((a) => [a.motivo, a.nivel])).toEqual([['credito', 'analista']]);
    expect(r.credito_so_orcamento).toBe(false);
  });
  it('RN-VEN-12: com a ação orcamento o crédito excedido só permite orçamento e não abre aprovação; avisar não faz nada', () => {
    const o = efeitosDosParametrosDoPedido({ ...base, parametros: { credito_excedido_acao: 'orcamento' } });
    expect(o.credito_so_orcamento).toBe(true);
    expect(o.aprovacoes).toEqual([]);
    const a = efeitosDosParametrosDoPedido({ ...base, parametros: { credito_excedido_acao: 'avisar' } });
    expect(a).toMatchObject({ credito_so_orcamento: false, aprovacoes: [] });
  });
  it('RN-VEN-12: sem consulta financeira (indisponível) não há efeito de crédito', () => {
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, parametros: { credito_excedido_acao: 'orcamento' } })).toMatchObject({ credito_so_orcamento: false, aprovacoes: [] });
  });
  it('RN-VEN-20: item sem estoque: padrão bloqueia (só orçamento); aprovacao abre a aprovação de estoque; avisar segue', () => {
    const fin = { ...base, financeiro: undefined, falta_estoque: true };
    expect(efeitosDosParametrosDoPedido(fin)).toMatchObject({ itens_sem_estoque_bloqueiam: true, aprovacoes: [] });
    const ap = efeitosDosParametrosDoPedido({ ...fin, parametros: { estoque_insuficiente_acao: 'aprovacao', 'aprovacao.estoque_nivel': 'supervisor' } });
    expect(ap.itens_sem_estoque_bloqueiam).toBe(false);
    expect(ap.aprovacoes.map((x) => [x.motivo, x.nivel])).toEqual([['estoque', 'supervisor']]);
    expect(efeitosDosParametrosDoPedido({ ...fin, parametros: { estoque_insuficiente_acao: 'avisar' } })).toMatchObject({ itens_sem_estoque_bloqueiam: false, aprovacoes: [] });
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined })).toMatchObject({ itens_sem_estoque_bloqueiam: false });
  });
  it('RN-VEN-20: orçamento não abre aprovação de estoque, mas o bloqueio de converter segue valendo', () => {
    const r = efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, tipo: 'orcamento', falta_estoque: true, parametros: { estoque_insuficiente_acao: 'aprovacao' } });
    expect(r.aprovacoes).toEqual([]);
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, tipo: 'orcamento', falta_estoque: true }).itens_sem_estoque_bloqueiam).toBe(true);
  });
  it('RN-VEN-22: abaixo do mínimo devolve o mínimo; igual passa; sem mínimo e orçamento devolvem 0', () => {
    const p = { pedido_minimo_cents: 60_000 };
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, parametros: p }).abaixo_do_minimo_cents).toBe(60_000);
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, parametros: { pedido_minimo_cents: 50_000 } }).abaixo_do_minimo_cents).toBe(0);
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined }).abaixo_do_minimo_cents).toBe(0);
    expect(efeitosDosParametrosDoPedido({ ...base, financeiro: undefined, tipo: 'orcamento', parametros: p }).abaixo_do_minimo_cents).toBe(0);
  });
});
