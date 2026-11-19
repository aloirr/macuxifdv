import { describe, expect, it } from 'vitest';
import { PedidoPush } from '../../contracts';
import { alertasDoPedido, impedeEnviarPorAlertas, soOrcamentoPorAlertas } from '../../domain/alertas-pedido';
import { disponivelParaAlerta } from '../../domain/credito-pedido';
import { financeiroParaAprovacao, modeloDoCredito, type FinanceiroDaConsulta } from './credito-cliente';
import { montarPedido, prepararPedido, rascunhoVazio } from './pedidos';
import { politicaApi } from './pull';
import { validarSemLancar } from './validar-rascunho';

const produto = { id: 'a', erp_code: 'A', description: 'Produto a', unit: 'UN', price_cents: 10_000, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false } as never;
const base = {
  cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never,
  catalogo: [produto],
  politica: politicaApi({}),
  eu: { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 },
  filaDoClienteCents: 0,
  rascunho: { ...rascunhoVazio('c1'), lines: { a: 1 } },
};
// total do pedido = R$ 100,00 (10.000 centavos), sem desconto: dentro da alçada
const fin = (o: Partial<NonNullable<Parameters<typeof prepararPedido>[0]['financeiro']>> = {}) => ({ prazo_medio_dias: 28, limite_informado: true, disponivel_cents: 10_000, maior_atraso_dias: 0, limite_dias: 5, ...o });

describe('RN-VEN-12 (T-0184, critérios 1 a 3 e 6): o app manda para aprovação em vez de bloquear', () => {
  it('RN-VEN-12: crédito disponível um centavo abaixo do total, a prazo: vai para aprovação com o motivo crédito', () => {
    const { v, display } = prepararPedido({ ...base, financeiro: fin({ disponivel_cents: 9_999 }) });
    expect(v.outcome).toBe('pending_approval');
    expect(v.issues.find((i) => i.code === 'credit_exceeded')).toMatchObject({ blocking: false, needs_approval: true });
    expect(display.expected).toBe('pending_approval');
  });
  it('RN-VEN-12: crédito igual ao total não vai para aprovação', () => {
    expect(prepararPedido({ ...base, financeiro: fin() }).v.outcome).toBe('ok');
  });
  it('RN-VEN-12: pedido à vista (prazo médio 0) não vai por crédito', () => {
    expect(prepararPedido({ ...base, financeiro: fin({ prazo_medio_dias: 0, disponivel_cents: 0 }) }).v.outcome).toBe('ok');
  });
  it('RN-VEN-12 (P4 A): cliente sem limite informado, a prazo, vai para aprovação com o motivo crédito', () => {
    const { v } = prepararPedido({ ...base, financeiro: fin({ limite_informado: false, disponivel_cents: 0 }) });
    expect(v.outcome).toBe('pending_approval');
    expect(v.issues.some((i) => i.code === 'credit_exceeded')).toBe(true);
  });
  it('RN-VEN-13 (P1 A): inadimplente vai para aprovação, também à vista, com o motivo inadimplência', () => {
    const { v } = prepararPedido({ ...base, financeiro: fin({ prazo_medio_dias: 0, maior_atraso_dias: 12 }) });
    expect(v.outcome).toBe('pending_approval');
    expect(v.issues.map((i) => i.code)).toEqual(['overdue_receivables']);
  });
  it('RN-VEN-13: crédito e inadimplência juntos geram os dois avisos e um único encaminhamento', () => {
    const { v } = prepararPedido({ ...base, financeiro: fin({ disponivel_cents: 0, maior_atraso_dias: 12 }) });
    expect(v.issues.map((i) => i.code)).toEqual(['credit_exceeded', 'overdue_receivables']);
    expect(v.outcome).toBe('pending_approval');
  });
  it('RN-VEN-12: sem dados financeiros no aparelho (consulta indisponível) o app não decide: segue como antes', () => {
    expect(prepararPedido({ ...base }).v.outcome).toBe('ok');
    expect(prepararPedido({ ...base, financeiro: null }).v.outcome).toBe('ok');
  });
  it('RN-VEN-12: a validação é por pedido de cliente; alçada e crédito somam sem sobrepor (desconto 8% e crédito)', () => {
    const { v } = prepararPedido({ ...base, rascunho: { ...base.rascunho, discount_pct: 8 }, financeiro: fin({ disponivel_cents: 0 }) });
    expect(v.issues.map((i) => i.code).sort()).toEqual(['credit_exceeded', 'discount_above_limit']);
  });
});

describe('RN-VEN-12 (critério 4): offline o app avisa e não bloqueia o envio', () => {
  it('RN-VEN-12: o pedido em aprovação por crédito monta o push válido, para subir na reconexão sem decidir pelo servidor', () => {
    const { v } = prepararPedido({ ...base, financeiro: fin({ disponivel_cents: 0 }) });
    const p = montarPedido({ id: '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99', cliente: base.cliente, rascunho: base.rascunho, v, semSinal: true, agora: '2026-11-19T12:00:00.000Z' });
    expect(PedidoPush.safeParse(p).success).toBe(true);
  });
  it('RN-VEN-12: o alerta de crédito aparece, mas não impede o envio nem força orçamento', () => {
    const a = alertasDoPedido({ cliente: { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] }, disponivel_cents: 0, total_cents: 10_000, vencidos: { titulos: 1, valor_cents: 500, dias: 12 } });
    expect(a.map((x) => x.texto)).toEqual(['Limite de crédito excedido', 'Título vencido']);
    expect(impedeEnviarPorAlertas(a)).toBe(false);
    expect(soOrcamentoPorAlertas(a)).toBe(false);
  });
  it('RN-VEN-12: à vista não mostra o alerta de crédito; sem limite informado, a prazo, mostra', () => {
    expect(disponivelParaAlerta({ prazo_medio_dias: 0, limite_informado: false, disponivel_cents: 0 })).toBeNull();
    const a = alertasDoPedido({ cliente: { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] }, disponivel_cents: disponivelParaAlerta({ prazo_medio_dias: 28, limite_informado: false, disponivel_cents: 0 }), total_cents: 10_000 });
    expect(a.map((x) => x.id)).toEqual(['credito']);
  });
});

describe('RN-VEN-12 (critério 1): o disponível do aparelho é limite − saldo em aberto − aprovados não faturados', () => {
  const f = (o: Partial<FinanceiroDaConsulta> = {}): FinanceiroDaConsulta => ({ limite_cents: 100_000, saldo_aberto_cents: 30_000, credito_disponivel_erp_cents: null, bloqueado: false, motivo_bloqueio: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0, atualizado_erp_em: null, ...o });
  it('RN-VEN-12: limite informado quando há limite ou disponível do ERP; zero sem disponível do ERP = não informado (P4 A)', () => {
    expect(modeloDoCredito(f(), [])).toMatchObject({ limite_informado: true, disponivel_cents: 70_000 });
    expect(modeloDoCredito(f({ limite_cents: 0, saldo_aberto_cents: 0 }), [])).toMatchObject({ limite_informado: false });
    expect(modeloDoCredito(f({ limite_cents: 0, saldo_aberto_cents: 0, credito_disponivel_erp_cents: 5_000 }), [])).toMatchObject({ limite_informado: true, disponivel_cents: 5_000 });
  });
});

describe('RN-VEN-12 e RN-VEN-13: ligação do aparelho com a regra', () => {
  const linhas = [{ product_id: 'a', quantity: 1, unit_price_cents: 10_000 }];
  it('RN-VEN-12: validarSemLancar manda para aprovação com crédito estourado e não decide sem dados', () => {
    const args = { sellerId: 'v', discountPct: 0, lines: linhas, politica: politicaApi({}) };
    expect(validarSemLancar({ ...args, financeiro: fin({ disponivel_cents: 9_999 }) }).outcome).toBe('pending_approval');
    expect(validarSemLancar({ ...args, financeiro: fin() }).outcome).toBe('ok');
    expect(validarSemLancar(args).outcome).toBe('ok');
  });
  it('RN-VEN-12: Core sem resposta = null (não decide); sem linha financeira = limite não informado (P4 A)', () => {
    expect(financeiroParaAprovacao(null, 28, 5)).toBeNull();
    expect(financeiroParaAprovacao(undefined, 28, 5)).toBeNull();
    expect(financeiroParaAprovacao({ tipo: 'vazio' }, 28, 5)).toMatchObject({ limite_informado: false });
    expect(financeiroParaAprovacao({ tipo: 'dados', limite_cents: 1, disponivel_cents: 1, limite_informado: true, alerta: { titulos: 1, valorCents: 1, dias: 9 } }, 0, 5)).toMatchObject({ maior_atraso_dias: 9, prazo_medio_dias: 0, limite_dias: 5 });
  });
});
