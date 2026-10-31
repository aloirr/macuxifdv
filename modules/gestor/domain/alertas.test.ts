import { describe, expect, it } from 'vitest';
import { CondicaoAlerta, RegraAlerta, TIPOS_ALERTA, type MembroEquipe } from '../contracts';
import { avaliarAlertas, REGRAS_PADRAO, reconciliarAlertas, resolverRegras, tiposAtivos, type AlertaExistente } from './alertas';
import { CLIENTE_A, CLIENTE_B, checkin, ev, pedidoCriado, PROMOTOR, statusAlterado, u, VENDEDOR } from './fixtures';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const MEMBROS: MembroEquipe[] = [
  { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true },
  { id: PROMOTOR, nome: 'Paula', perfil: 'promotor', superior_id: null, ativo: true },
];
const avaliar = (estado: ReturnType<typeof montar>, agora: string, extra: { modulos?: Set<string>; regras?: Parameters<typeof resolverRegras>[0]; membros?: MembroEquipe[] } = {}) =>
  avaliarAlertas({ estado, membros: extra.membros ?? MEMBROS, agora, modulos: extra.modulos ?? TODOS, regras: resolverRegras(extra.regras) });
const doTipo = (cs: ReturnType<typeof avaliar>, tipo: string) => cs.filter((c) => c.tipo === tipo);

const cliente = (id: string, vendedor: string | null = VENDEDOR, ativo = true) => ev('core.cliente.atualizado@1', '2026-10-01T10:00:00Z', { cliente_id: id, vendedor_id: vendedor, ativo, nome: 'Mercado ' + id.slice(-3) });

describe('regras de alerta: padrões e validação (RF-GES-07)', () => {
  it('uma regra padrão para cada tipo, todas ativas e válidas no contrato', () => {
    expect(Object.keys(REGRAS_PADRAO).sort()).toEqual([...TIPOS_ALERTA].sort());
    for (const r of Object.values(REGRAS_PADRAO)) {
      expect(RegraAlerta.parse(r)).toEqual(r);
      expect(r.ativa).toBe(true);
    }
    expect(REGRAS_PADRAO.cliente_sem_visita).toMatchObject({ limiar: 30 });
    expect(REGRAS_PADRAO.ritmo_abaixo_meta).toMatchObject({ limiar: 80, amostra_min: 3 });
    expect(REGRAS_PADRAO.pedido_aguardando_aprovacao).toMatchObject({ limiar: 24 });
    expect(REGRAS_PADRAO.ruptura_recorrente).toMatchObject({ limiar: 3, janela_dias: 14 });
    expect(REGRAS_PADRAO.visita_curta).toMatchObject({ janela_dias: 3 });
    expect(REGRAS_PADRAO.fotos_sem_gps).toMatchObject({ limiar: 20, janela_dias: 7, amostra_min: 10 });
  });

  it('o tenant ajusta limiar, janela e liga/desliga cada regra; o resto fica no padrão', () => {
    const r = resolverRegras({ cliente_sem_visita: { limiar: 15 }, fotos_sem_gps: { ativa: false } });
    expect(r.cliente_sem_visita).toMatchObject({ limiar: 15, ativa: true, severidade: 'atencao' });
    expect(r.fotos_sem_gps.ativa).toBe(false);
    expect(r.visita_curta).toEqual(REGRAS_PADRAO.visita_curta);
  });

  it('valores inválidos são recusados em português', () => {
    expect(() => resolverRegras({ cliente_sem_visita: { limiar: -1 } })).toThrow(/cliente_sem_visita/);
    expect(() => resolverRegras({ ruptura_recorrente: { janela_dias: 0 } })).toThrow(/ruptura_recorrente/);
  });

  it('regra só vale com o módulo de origem ativo e a regra ligada', () => {
    const regras = resolverRegras({ visita_curta: { ativa: false } });
    const t = tiposAtivos(regras, new Set(['core', 'promotor']));
    expect(t.has('cliente_sem_visita')).toBe(true); // Core
    expect(t.has('ruptura_recorrente')).toBe(true);
    expect(t.has('visita_curta')).toBe(false); // desligada
    expect(t.has('ritmo_abaixo_meta')).toBe(false); // sem Vendedor
    expect(t.has('pedido_aguardando_aprovacao')).toBe(false);
  });
});

describe('RF-GES-07: cliente da carteira sem visita há X dias', () => {
  const AGORA = '2026-10-30T20:00:00Z'; // 30/10 em Manaus

  it('30 dias exatos já alertam (limiar inclusivo); 29 não', () => {
    const s = montar([cliente(CLIENTE_A), cliente(CLIENTE_B), checkin({ visita: u(2000), cliente: CLIENTE_A, em: '2026-09-30T13:00:00Z' }), checkin({ visita: u(2001), cliente: CLIENTE_B, em: '2026-10-01T13:00:00Z' })]);
    const cs = doTipo(avaliar(s, AGORA), 'cliente_sem_visita');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ chave: `cliente_sem_visita:${CLIENTE_A}`, alvo_tipo: 'cliente', alvo_id: CLIENTE_A, responsavel_id: VENDEDOR, valor: 30, limiar: 30, severidade: 'atencao' });
    expect(CondicaoAlerta.parse(cs[0])).toEqual(cs[0]);
  });

  it('conta a última visita de QUALQUER usuário ao cliente, no dia do fuso do tenant', () => {
    // 01/10 02:00Z é 30/09 em Manaus → 30 dias até 30/10 → alerta; 01/10 05:00Z é 01/10 → 29 dias → não
    const a = montar([cliente(CLIENTE_A), checkin({ cliente: CLIENTE_A, usuario: PROMOTOR, em: '2026-10-01T02:00:00Z' })]);
    expect(doTipo(avaliar(a, AGORA), 'cliente_sem_visita')).toHaveLength(1);
    const b = montar([cliente(CLIENTE_A), checkin({ cliente: CLIENTE_A, usuario: PROMOTOR, em: '2026-10-01T05:00:00Z' })]);
    expect(doTipo(avaliar(b, AGORA), 'cliente_sem_visita')).toHaveLength(0);
  });

  it('cliente nunca visitado alerta com valor null (documentado); sem carteira ou inativo não alerta', () => {
    const s = montar([cliente(CLIENTE_A), cliente(CLIENTE_B, null), cliente(u(504), VENDEDOR, false)]);
    const cs = doTipo(avaliar(s, AGORA), 'cliente_sem_visita');
    expect(cs.map((c) => [c.alvo_id, c.valor])).toEqual([[CLIENTE_A, null]]);
  });

  it('limiar do tenant: com 15 dias, cliente visitado há 20 dias alerta', () => {
    const s = montar([cliente(CLIENTE_A), checkin({ cliente: CLIENTE_A, em: '2026-10-10T13:00:00Z' })]);
    expect(doTipo(avaliar(s, AGORA), 'cliente_sem_visita')).toHaveLength(0);
    expect(doTipo(avaliar(s, AGORA, { regras: { cliente_sem_visita: { limiar: 15 } } }), 'cliente_sem_visita')[0]!.valor).toBe(20);
  });

  it('vendedor da carteira inativo no cadastro não gera alerta', () => {
    const s = montar([cliente(CLIENTE_A)]);
    const membros = MEMBROS.map((x) => (x.id === VENDEDOR ? { ...x, ativo: false } : x));
    expect(doTipo(avaliar(s, AGORA, { membros }), 'cliente_sem_visita')).toHaveLength(0);
  });
});

describe('RF-GES-07: ritmo abaixo da meta', () => {
  const meta = ev('core.meta.definida@1', '2026-10-01T08:00:00Z', { usuario_id: VENDEDOR, mes: '2026-10', meta_cents: 2_200_000 });
  const vende = (total: number, em: string) => [pedidoCriado({ pedido: u(1000 + total), total, em }), statusAlterado({ pedido: u(1000 + total), para: 'aprovado', em })];

  it('ritmo 69,23% (< 80%) no 14º dia útil alerta; valor e limiar vão no alerta', () => {
    const s = montar([meta, ...vende(900_000, '2026-10-15T15:00:00Z')]);
    const cs = doTipo(avaliar(s, '2026-10-20T20:00:00Z'), 'ritmo_abaixo_meta');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ chave: `ritmo_abaixo_meta:${VENDEDOR}`, alvo_tipo: 'usuario', valor: 69.23, limiar: 80, responsavel_id: VENDEDOR });
  });

  it('ritmo igual ao limite (80%) não alerta; acima também não', () => {
    const s = montar([meta, ...vende(1_040_000, '2026-10-15T15:00:00Z')]); // esperado até 19/10 = 1.300.000 → 80%
    expect(doTipo(avaliar(s, '2026-10-20T20:00:00Z'), 'ritmo_abaixo_meta')).toHaveLength(0);
  });

  it('antes de 3 dias úteis decorridos a regra não vale (amostra mínima)', () => {
    const s = montar([meta]);
    expect(doTipo(avaliar(s, '2026-10-05T20:00:00Z'), 'ritmo_abaixo_meta')).toHaveLength(0); // 2 decorridos (01/10 e 02/10)
    expect(doTipo(avaliar(s, '2026-10-06T20:00:00Z'), 'ritmo_abaixo_meta')).toHaveLength(1); // 3 decorridos (01, 02 e 05/10)
  });

  it('sem meta ou sem módulo Vendedor não alerta', () => {
    expect(doTipo(avaliar(montar([]), '2026-10-20T20:00:00Z'), 'ritmo_abaixo_meta')).toHaveLength(0);
    expect(doTipo(avaliar(montar([meta]), '2026-10-20T20:00:00Z', { modulos: new Set(['core', 'promotor']) }), 'ritmo_abaixo_meta')).toHaveLength(0);
  });
});

describe('RF-GES-07: pedido aguardando aprovação há X horas', () => {
  const solicita = (n: number, em: string, vendedor = VENDEDOR) =>
    ev('vendedor.pedido.aprovacao_solicitada@1', em, { pedido_id: u(1000 + n), vendedor_id: vendedor, cliente_id: CLIENTE_A, solicitada_em: em, nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 11, total_cents: 100_000 });

  it('24 h exatas já alertam (inclusivo); 23,99 h não; a chave é o pedido', () => {
    const s = montar([solicita(1, '2026-10-29T12:00:00Z'), solicita(2, '2026-10-29T12:01:00Z')]);
    const cs = doTipo(avaliar(s, '2026-10-30T12:00:00Z'), 'pedido_aguardando_aprovacao');
    expect(cs.map((c) => [c.chave, c.valor])).toEqual([[`pedido_aguardando_aprovacao:${u(1001)}`, 24]]);
    expect(cs[0]).toMatchObject({ alvo_tipo: 'pedido', responsavel_id: VENDEDOR, severidade: 'critica' });
  });

  it('pedido decidido deixa de ser condição', () => {
    const s = montar([solicita(1, '2026-10-29T12:00:00Z'), statusAlterado({ pedido: u(1001), para: 'aprovado', em: '2026-10-30T09:00:00Z' })]);
    expect(doTipo(avaliar(s, '2026-10-30T12:00:00Z'), 'pedido_aguardando_aprovacao')).toHaveLength(0);
  });

  it('limiar em horas é parâmetro da regra', () => {
    const s = montar([solicita(1, '2026-10-30T08:00:00Z')]);
    expect(doTipo(avaliar(s, '2026-10-30T12:00:00Z', { regras: { pedido_aguardando_aprovacao: { limiar: 4 } } }), 'pedido_aguardando_aprovacao')).toHaveLength(1);
  });
});

describe('RF-GES-07: alertas do promotor (ruptura recorrente, visita curta, fotos sem GPS)', () => {
  const lj = (n: number, o: { cliente?: string; min?: number; em: string; fotos?: [number, number] }) =>
    ev('promotor.visita_loja.concluida@1', o.em, {
      visita_loja_id: u(3000 + n),
      visita_id: u(2000 + n),
      promotor_id: PROMOTOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      checkin_em: o.em,
      checkout_em: o.em,
      permanencia_min: o.min ?? 30,
      fotos_total: o.fotos?.[0] ?? null,
      fotos_sem_gps: o.fotos?.[1] ?? null,
    });
  const rup = (n: number, loja: number, st: 'presente' | 'ruptura_gondola' | 'ruptura_total', em: string, cliente = CLIENTE_A) =>
    ev('promotor.ruptura.registrada@1', em, { registro_id: u(6000 + n), visita_loja_id: u(3000 + loja), promotor_id: PROMOTOR, cliente_id: cliente, produto_id: u(7000 + n), status: st, registrado_em: em });
  const AGORA = '2026-10-30T20:00:00Z';

  it('ruptura recorrente: 3 visitas diferentes da loja com ruptura em 14 dias alertam (2 não)', () => {
    const base = [
      lj(1, { em: '2026-10-20T13:00:00Z' }),
      lj(2, { em: '2026-10-24T13:00:00Z' }),
      lj(3, { em: '2026-10-29T13:00:00Z' }),
      rup(1, 1, 'ruptura_total', '2026-10-20T13:10:00Z'),
      rup(2, 1, 'ruptura_gondola', '2026-10-20T13:11:00Z'), // 2 itens na mesma visita contam 1
      rup(3, 2, 'ruptura_total', '2026-10-24T13:10:00Z'),
    ];
    expect(doTipo(avaliar(montar(base), AGORA), 'ruptura_recorrente')).toHaveLength(0);
    const cs = doTipo(avaliar(montar([...base, rup(4, 3, 'ruptura_total', '2026-10-29T13:10:00Z')]), AGORA), 'ruptura_recorrente');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ chave: `ruptura_recorrente:${CLIENTE_A}`, alvo_tipo: 'cliente', valor: 3, limiar: 3, responsavel_id: PROMOTOR });
  });

  it('ruptura fora da janela, item presente e visita curta (RN-PRO-07) não contam', () => {
    const s = montar([
      lj(1, { em: '2026-10-10T13:00:00Z' }), // fora da janela de 14 dias (16/10 em diante)
      lj(2, { em: '2026-10-24T13:00:00Z' }),
      lj(3, { em: '2026-10-29T13:00:00Z', min: 5 }), // curta
      lj(4, { em: '2026-10-28T13:00:00Z' }),
      rup(1, 1, 'ruptura_total', '2026-10-10T13:10:00Z'),
      rup(2, 2, 'ruptura_total', '2026-10-24T13:10:00Z'),
      rup(3, 3, 'ruptura_total', '2026-10-29T13:10:00Z'),
      rup(4, 4, 'presente', '2026-10-28T13:10:00Z'),
    ]);
    expect(doTipo(avaliar(s, AGORA), 'ruptura_recorrente')).toHaveLength(0);
  });

  it('visita curta: abaixo de 10 min (RN-PRO-07) alerta por visita, dentro de 3 dias; 10 min não; mais antiga some', () => {
    const s = montar([lj(1, { em: '2026-10-30T13:00:00Z', min: 6 }), lj(2, { em: '2026-10-30T14:00:00Z', min: 10 }), lj(3, { em: '2026-10-26T14:00:00Z', min: 2 })]);
    const cs = doTipo(avaliar(s, AGORA), 'visita_curta');
    expect(cs.map((c) => [c.chave, c.valor, c.limiar])).toEqual([[`visita_curta:${u(3001)}`, 6, 10]]);
    expect(cs[0]).toMatchObject({ alvo_tipo: 'visita_loja', responsavel_id: PROMOTOR, severidade: 'info' });
  });

  it('visita curta usa a permanência mínima do tenant', () => {
    const s = montar([lj(1, { em: '2026-10-30T13:00:00Z', min: 12 })]);
    const cs = avaliarAlertas({ estado: s, membros: MEMBROS, agora: AGORA, modulos: TODOS, regras: resolverRegras(), params: { permanencia_min_min: 15 } });
    expect(doTipo(cs, 'visita_curta')).toHaveLength(1);
  });

  it('fotos sem GPS: acima do limite (>20%) com amostra mínima (10 fotos) em 7 dias', () => {
    const acima = montar([lj(1, { em: '2026-10-29T13:00:00Z', fotos: [12, 3] }), lj(2, { em: '2026-10-30T13:00:00Z', fotos: [8, 2] })]); // 5 de 20 = 25%
    const cs = doTipo(avaliar(acima, AGORA), 'fotos_sem_gps');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ chave: `fotos_sem_gps:${PROMOTOR}`, alvo_tipo: 'usuario', valor: 25, limiar: 20, responsavel_id: PROMOTOR });
  });

  it('fotos sem GPS: exatamente no limite (20%), amostra pequena ou fora da janela não alertam', () => {
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-29T13:00:00Z', fotos: [10, 2] })]), AGORA), 'fotos_sem_gps')).toHaveLength(0); // 20%
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-29T13:00:00Z', fotos: [4, 4] })]), AGORA), 'fotos_sem_gps')).toHaveLength(0); // 4 fotos < 10
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-20T13:00:00Z', fotos: [20, 20] })]), AGORA), 'fotos_sem_gps')).toHaveLength(0); // fora de 7 dias
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-29T13:00:00Z' })]), AGORA), 'fotos_sem_gps')).toHaveLength(0); // Promotor não informou as fotos
  });

  it('Promotor desativado: nenhum alerta de trade é gerado (RN-CORE-03)', () => {
    const s = montar([lj(1, { em: '2026-10-30T13:00:00Z', min: 6, fotos: [20, 20] })]);
    const cs = avaliar(s, AGORA, { modulos: new Set(['core', 'vendedor']) });
    expect(cs.filter((c) => ['visita_curta', 'fotos_sem_gps', 'ruptura_recorrente'].includes(c.tipo))).toEqual([]);
  });

  it('regra desligada não gera condição', () => {
    const s = montar([lj(1, { em: '2026-10-30T13:00:00Z', min: 6 })]);
    expect(doTipo(avaliar(s, AGORA, { regras: { visita_curta: { ativa: false } } }), 'visita_curta')).toHaveLength(0);
  });
});

describe('RF-GES-07: deduplicação e encerramento automático', () => {
  const cond = (tipo: 'cliente_sem_visita' | 'visita_curta', alvo: string, valor: number | null = 31): ReturnType<typeof avaliar>[number] => ({
    chave: `${tipo}:${alvo}`,
    tipo,
    alvo_tipo: tipo === 'visita_curta' ? 'visita_loja' : 'cliente',
    alvo_id: alvo,
    responsavel_id: VENDEDOR,
    valor,
    limiar: 30,
    severidade: 'atencao',
    mensagem: 'x',
  });
  const exist = (id: number, c: ReturnType<typeof cond>, status: AlertaExistente['status'] = 'aberto', aberto_em = '2026-10-20T10:00:00Z'): AlertaExistente => ({ id: u(id), chave: c.chave, tipo: c.tipo, status, valor: c.valor, mensagem: c.mensagem, severidade: c.severidade, aberto_em });
  const AGORA = '2026-10-30T20:00:00Z';
  const ativos = new Set<(typeof TIPOS_ALERTA)[number]>(['cliente_sem_visita', 'visita_curta']);

  it('condição nova abre alerta; condição que já tem alerta aberto NÃO abre outro (chave regra+alvo)', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A);
    expect(reconciliarAlertas([], [c], { agora: AGORA, tipos_ativos: ativos }).abrir).toEqual([c]);
    const r = reconciliarAlertas([exist(1, c)], [c], { agora: AGORA, tipos_ativos: ativos });
    expect(r).toEqual({ abrir: [], atualizar: [], encerrar: [] });
  });

  it('a mesma condição repetida na entrada abre só um alerta', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A);
    expect(reconciliarAlertas([], [c, { ...c }], { agora: AGORA, tipos_ativos: ativos }).abrir).toHaveLength(1);
  });

  it('valor mudou (31 → 35 dias): atualiza o alerta aberto em vez de abrir outro', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A, 35);
    const r = reconciliarAlertas([exist(1, cond('cliente_sem_visita', CLIENTE_A, 31))], [c], { agora: AGORA, tipos_ativos: ativos });
    expect(r.atualizar).toEqual([{ id: u(1), valor: 35, mensagem: 'x', severidade: 'atencao' }]);
    expect(r.abrir).toEqual([]);
  });

  it('condição deixou de valer: encerra sozinho com motivo e data', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A);
    const r = reconciliarAlertas([exist(1, c)], [], { agora: AGORA, tipos_ativos: ativos });
    expect(r.encerrar).toEqual([{ id: u(1), motivo: 'condicao_normalizada', encerrado_em: AGORA }]);
  });

  it('alerta dispensado pelo gestor não reabre enquanto a condição persiste; se a condição some, encerra; se voltar, abre um novo', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A);
    const dispensado = exist(1, c, 'dispensado');
    expect(reconciliarAlertas([dispensado], [c], { agora: AGORA, tipos_ativos: ativos })).toEqual({ abrir: [], atualizar: [], encerrar: [] });
    expect(reconciliarAlertas([dispensado], [], { agora: AGORA, tipos_ativos: ativos }).encerrar).toHaveLength(1);
    const encerrado = exist(1, c, 'encerrado');
    expect(reconciliarAlertas([encerrado], [c], { agora: AGORA, tipos_ativos: ativos }).abrir).toEqual([c]);
  });

  it('duplicados já gravados (duas linhas abertas na mesma chave): mantém a mais antiga e encerra as outras', () => {
    const c = cond('cliente_sem_visita', CLIENTE_A);
    const r = reconciliarAlertas([exist(2, c, 'aberto', '2026-10-25T10:00:00Z'), exist(1, c, 'aberto', '2026-10-20T10:00:00Z')], [c], { agora: AGORA, tipos_ativos: ativos });
    expect(r.encerrar).toEqual([{ id: u(2), motivo: 'duplicado', encerrado_em: AGORA }]);
  });

  it('regra desligada ou módulo desativado: encerra os alertas abertos do tipo com motivo regra_inativa', () => {
    const c = cond('visita_curta', u(3001), 6);
    const r = reconciliarAlertas([exist(1, c)], [], { agora: AGORA, tipos_ativos: new Set(['cliente_sem_visita']) });
    expect(r.encerrar).toEqual([{ id: u(1), motivo: 'regra_inativa', encerrado_em: AGORA }]);
  });

  it('é idempotente: aplicar o resultado e reconciliar de novo não gera operação', () => {
    const c1 = cond('cliente_sem_visita', CLIENTE_A);
    const r1 = reconciliarAlertas([], [c1], { agora: AGORA, tipos_ativos: ativos });
    const depois: AlertaExistente[] = r1.abrir.map((c, i) => ({ id: u(900 + i), chave: c.chave, tipo: c.tipo, status: 'aberto', valor: c.valor, mensagem: c.mensagem, severidade: c.severidade, aberto_em: AGORA }));
    expect(reconciliarAlertas(depois, [c1], { agora: AGORA, tipos_ativos: ativos })).toEqual({ abrir: [], atualizar: [], encerrar: [] });
  });
});
