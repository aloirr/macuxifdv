import { describe, expect, it } from 'vitest';
import { CondicaoAlerta, type MembroEquipe } from '../contracts';
import { avaliarAlertas, resolverRegras } from './alertas';
import { checkin, CLIENTE_A, ev, meta, pedidoCriado, statusAlterado, u, VENDEDOR } from './fixtures';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const MEMBROS: MembroEquipe[] = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true }];
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const SEG_SEX = { calendario_metas: { dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [] } };
const avaliar = (estado: ReturnType<typeof montar>, agora: string, extra: { params?: Parameters<typeof avaliarAlertas>[0]['params']; nomes_clientes?: Record<string, string> } = {}) =>
  avaliarAlertas({ estado, membros: MEMBROS, agora, modulos: TODOS, regras: resolverRegras(), params: extra.params, nomes_clientes: extra.nomes_clientes });
const clienteSemNome = (extra: Record<string, unknown> = {}) =>
  ev('core.cliente.atualizado@1', '2026-09-01T10:00:00Z', { cliente_id: CLIENTE_A, campos: ['vendedor_id'], origem: 'erp', vendedor_id: VENDEDOR, ativo: true, frequencia_visita: 'semanal', ...extra });

describe('UX-22: texto dos alertas em pt-BR com uma casa decimal (RN-GES-03, ritmo da meta)', () => {
  it('RN-CORE-26: ritmo abaixo da meta mostra o percentual com vírgula e uma casa ("69,2%"), e o valor do contrato segue com duas', () => {
    const vende = [pedidoCriado({ pedido: u(1900), total: 900_000, em: '2026-10-15T15:00:00Z' }), statusAlterado({ pedido: u(1900), para: 'aprovado', em: '2026-10-15T15:00:00Z' })];
    const s = montar([meta(VENDEDOR, '2026-10', 2_200_000, '2026-10-01T08:00:00Z'), ...vende]);
    const c = avaliar(s, '2026-10-20T20:00:00Z', { params: SEG_SEX }).find((x) => x.tipo === 'ritmo_abaixo_meta')!;
    expect(c.valor).toBe(69.23);
    expect(c.mensagem).toBe('Vera está com 69,2% do ritmo esperado da meta (mínimo 80%).');
  });

  it('RN-GES-03: pedido parado mostra as horas úteis em hora inteira ("10 horas úteis"), e "Desde" é quando o prazo estourou', () => {
    const em = '2026-11-06T21:00:00Z';
    const s = montar([ev('vendedor.pedido.aprovacao_solicitada@1', em, { pedido_id: u(1001), vendedor_id: VENDEDOR, cliente_id: CLIENTE_A, solicitada_em: em, nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 11, total_cents: 100_000 })]);
    const c = avaliar(s, '2026-11-09T21:01:00Z').find((x) => x.tipo === 'pedido_aguardando_aprovacao')!;
    expect(c.mensagem).toContain('(10 horas úteis de espera)');
    expect(c.desde).toBe('2026-11-09T21:00:00.000Z');
    expect(CondicaoAlerta.parse(c)).toEqual(c);
  });
});

describe('RN-GES-01: "Desde" do alerta de cliente sem visita é quando o fato começou, e o nome vem do cadastro', () => {
  it('com visita anterior, "desde" é o check-in da última visita (não a hora da avaliação)', () => {
    const s = montar([clienteSemNome(), checkin({ visita: u(2001), cliente: CLIENTE_A, em: '2026-10-10T13:00:00Z' })]);
    const c = avaliar(s, '2026-10-30T20:00:00Z').find((x) => x.tipo === 'cliente_sem_visita')!;
    expect(c.desde).toBe('2026-10-10T13:00:00Z');
  });

  it('nunca visitado: "desde" é a entrada na carteira', () => {
    const s = montar([clienteSemNome({ na_carteira_desde: '2026-09-01T10:00:00Z' })]);
    const c = avaliar(s, '2026-10-30T20:00:00Z').find((x) => x.tipo === 'cliente_sem_visita')!;
    expect(c.desde).toBe('2026-09-01T10:00:00Z');
  });

  it('o nome do cliente chega à mensagem pelo cadastro do Core; sem ele cai em "Cliente"', () => {
    const s = montar([clienteSemNome(), checkin({ visita: u(2001), cliente: CLIENTE_A, em: '2026-10-10T13:00:00Z' })]);
    const com = avaliar(s, '2026-10-30T20:00:00Z', { nomes_clientes: { [CLIENTE_A]: 'Mercado Boa Vista' } }).find((x) => x.tipo === 'cliente_sem_visita')!;
    expect(com.mensagem).toMatch(/^Mercado Boa Vista está sem visita há 20 dias/);
    const sem = avaliar(s, '2026-10-30T20:00:00Z').find((x) => x.tipo === 'cliente_sem_visita')!;
    expect(sem.mensagem).toMatch(/^Cliente está sem visita/);
  });
});
