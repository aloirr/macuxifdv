import { describe, expect, it } from 'vitest';
import { CondicaoAlerta, RegraAlerta, TIPOS_ALERTA, type MembroEquipe } from '../contracts';
import { avaliarAlertas, FREQUENCIA_EM_DIAS, limiteDiasSemVisita, REGRAS_PADRAO, reconciliarAlertas, resolverRegras, tiposAtivos, type AlertaExistente } from './alertas';
import { situacaoDoPrazo } from './aprovacoes';
import { PARAMETROS_PADRAO } from './parametros';
import { CLIENTE_A, CLIENTE_B, checkin, ev, pedidoCriado, PROMOTOR, rupturaRegistrada, statusAlterado, u, VENDEDOR, visitaLoja, type DesfechoTeste } from './fixtures';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const MEMBROS: MembroEquipe[] = [
  { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true },
  { id: PROMOTOR, nome: 'Paula', perfil: 'promotor', superior_id: null, ativo: true },
];
const avaliar = (
  estado: ReturnType<typeof montar>,
  agora: string,
  extra: { modulos?: Set<string>; regras?: Parameters<typeof resolverRegras>[0]; membros?: MembroEquipe[]; params?: Parameters<typeof avaliarAlertas>[0]['params'] } = {},
) => avaliarAlertas({ estado, membros: extra.membros ?? MEMBROS, agora, modulos: extra.modulos ?? TODOS, regras: resolverRegras(extra.regras), params: extra.params });
const doTipo = (cs: ReturnType<typeof avaliar>, tipo: string) => cs.filter((c) => c.tipo === tipo);

const cliente = (id: string, vendedor: string | null = VENDEDOR, ativo = true) => ev('core.cliente.atualizado@1', '2026-10-01T10:00:00Z', { cliente_id: id, vendedor_id: vendedor, ativo, nome: 'Mercado ' + id.slice(-3) });

describe('regras de alerta: padrões e validação (RF-GES-07)', () => {
  it('uma regra padrão para cada tipo, todas ativas e válidas no contrato', () => {
    expect(Object.keys(REGRAS_PADRAO).sort()).toEqual([...TIPOS_ALERTA].sort());
    for (const r of Object.values(REGRAS_PADRAO)) {
      expect(RegraAlerta.parse(r)).toEqual(r);
      expect(r.ativa).toBe(true);
    }
    expect(REGRAS_PADRAO.cliente_sem_visita).toMatchObject({ limiar: null }); // RN-GES-01: limite vem da frequência do cliente
    expect(REGRAS_PADRAO.ritmo_abaixo_meta).toMatchObject({ limiar: 80, amostra_min: 3 });
    expect(REGRAS_PADRAO.pedido_aguardando_aprovacao).toMatchObject({ limiar: null }); // RN-GES-03: o prazo vem de prazo_aprovacao_dias_uteis
    expect(REGRAS_PADRAO.ruptura_recorrente).toMatchObject({ limiar: 3, janela_dias: 14 });
    expect(REGRAS_PADRAO.visita_curta).toMatchObject({ janela_dias: 3 });
    expect(REGRAS_PADRAO.fotos_sem_gps).toMatchObject({ limiar: 20, janela_dias: 7, amostra_min: 10 });
  });

  it('o tenant ajusta limiar, janela e liga/desliga cada regra; o resto fica no padrão', () => {
    const r = resolverRegras({ ruptura_recorrente: { limiar: 4 }, fotos_sem_gps: { ativa: false } });
    expect(r.ruptura_recorrente).toMatchObject({ limiar: 4, janela_dias: 14, ativa: true, severidade: 'atencao' });
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

describe('RF-GES-07 / RN-GES-01: cliente da carteira sem visita além do limite do cliente', () => {
  const AGORA = '2026-10-30T20:00:00Z'; // 30/10 em Manaus
  const comFreq = (id: string, frequencia_visita: 'semanal' | 'quinzenal' | 'mensal' | null) =>
    ev('core.cliente.atualizado@1', '2026-09-01T10:00:00Z', { cliente_id: id, vendedor_id: VENDEDOR, ativo: true, nome: 'Mercado ' + id.slice(-3), frequencia_visita });
  /** Check-in às 09:00 de Manaus do dia civil informado. */
  const visitaEm = (n: number, cliente: string, dia: string) => checkin({ visita: u(2000 + n), cliente, em: `${dia}T13:00:00Z` });
  const limiteDe = (frequencia: 'semanal' | 'quinzenal' | 'mensal' | null, diasAtras: number, extra: Parameters<typeof avaliar>[2] = {}) => {
    const dia = new Date(Date.parse('2026-10-30T12:00:00Z') - diasAtras * 86_400_000).toISOString().slice(0, 10);
    return doTipo(avaliar(montar([comFreq(CLIENTE_A, frequencia), visitaEm(1, CLIENTE_A, dia)]), AGORA, extra), 'cliente_sem_visita');
  };

  it('limite = frequência × (1 + 50%), arredondado para baixo: semanal 10, quinzenal 21, mensal 45; sem frequência 30', () => {
    expect(limiteDiasSemVisita('semanal', PARAMETROS_PADRAO)).toBe(10);
    expect(limiteDiasSemVisita('quinzenal', PARAMETROS_PADRAO)).toBe(21);
    expect(limiteDiasSemVisita('mensal', PARAMETROS_PADRAO)).toBe(45);
    expect(limiteDiasSemVisita(null, PARAMETROS_PADRAO)).toBe(30);
    expect(FREQUENCIA_EM_DIAS).toEqual({ semanal: 7, quinzenal: 14, mensal: 30 });
  });

  it('cliente quinzenal: 21 dias sem visita ainda está no limite (não alerta); 22 alerta com valor 22 e limiar 21', () => {
    expect(limiteDe('quinzenal', 21)).toHaveLength(0);
    const cs = limiteDe('quinzenal', 22);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ chave: `cliente_sem_visita:${CLIENTE_A}`, alvo_tipo: 'cliente', alvo_id: CLIENTE_A, responsavel_id: VENDEDOR, valor: 22, limiar: 21, severidade: 'atencao' });
    expect(cs[0]!.mensagem).toContain('quinzenal');
    expect(CondicaoAlerta.parse(cs[0])).toEqual(cs[0]);
  });

  it('cliente semanal alerta no 11º dia; mensal no 46º; sem frequência no 31º', () => {
    expect([limiteDe('semanal', 10).length, limiteDe('semanal', 11).length]).toEqual([0, 1]);
    expect([limiteDe('mensal', 45).length, limiteDe('mensal', 46).length]).toEqual([0, 1]);
    expect([limiteDe(null, 30).length, limiteDe(null, 31).length]).toEqual([0, 1]);
    expect(limiteDe(null, 31)[0]).toMatchObject({ valor: 31, limiar: 30 });
  });

  it('parâmetros do tenant: tolerância 100% (quinzenal → 28) e 20 dias para quem não tem frequência', () => {
    expect(limiteDe('quinzenal', 22, { params: { pct_tolerancia_frequencia: 100 } })).toHaveLength(0);
    expect(limiteDe('quinzenal', 29, { params: { pct_tolerancia_frequencia: 100 } })[0]).toMatchObject({ valor: 29, limiar: 28 });
    expect(limiteDe(null, 21, { params: { dias_sem_visita_padrao: 20 } })[0]).toMatchObject({ valor: 21, limiar: 20 });
    expect(limiteDe('quinzenal', 15, { params: { pct_tolerancia_frequencia: 0 } })[0]).toMatchObject({ valor: 15, limiar: 14 });
  });

  it('o limite é do cliente e de parâmetro do tenant: a regra não aceita limiar próprio', () => {
    expect(REGRAS_PADRAO.cliente_sem_visita.limiar).toBeNull();
    expect(() => resolverRegras({ cliente_sem_visita: { limiar: 15 } })).toThrow(/cliente_sem_visita/);
    expect(resolverRegras({ cliente_sem_visita: { ativa: false } }).cliente_sem_visita.ativa).toBe(false);
  });

  it('conta a última visita de QUALQUER usuário ao cliente, no dia do fuso do tenant', () => {
    // 30/09 02:00Z é 29/09 em Manaus → 31 dias até 30/10 → alerta; 30/09 05:00Z é 30/09 → 30 dias → não
    const a = montar([cliente(CLIENTE_A), checkin({ cliente: CLIENTE_A, usuario: PROMOTOR, em: '2026-09-30T02:00:00Z' })]);
    expect(doTipo(avaliar(a, AGORA), 'cliente_sem_visita')).toHaveLength(1);
    const b = montar([cliente(CLIENTE_A), checkin({ cliente: CLIENTE_A, usuario: PROMOTOR, em: '2026-09-30T05:00:00Z' })]);
    expect(doTipo(avaliar(b, AGORA), 'cliente_sem_visita')).toHaveLength(0);
  });

  it('sem carteira ou cliente inativo não alerta', () => {
    const s = montar([cliente(CLIENTE_B, null), cliente(u(504), VENDEDOR, false)]);
    expect(doTipo(avaliar(s, AGORA), 'cliente_sem_visita')).toEqual([]);
  });

  it('vendedor da carteira inativo no cadastro não gera alerta', () => {
    const s = montar([cliente(CLIENTE_A)]);
    const membros = MEMBROS.map((x) => (x.id === VENDEDOR ? { ...x, ativo: false } : x));
    expect(doTipo(avaliar(s, AGORA, { membros }), 'cliente_sem_visita')).toHaveLength(0);
  });
});

describe('RN-GES-02: cliente nunca visitado só alerta depois de PASSAR de 15 dias na carteira (dia 15 não, dia 16 sim)', () => {
  const AGORA = '2026-10-30T20:00:00Z'; // 30/10 em Manaus
  const naCarteira = (id: string, desde: string | null, ocorrido = '2026-10-01T10:00:00Z', vendedor = VENDEDOR) =>
    ev('core.cliente.atualizado@1', ocorrido, { cliente_id: id, vendedor_id: vendedor, ativo: true, nome: 'Mercado ' + id.slice(-3), na_carteira_desde: desde });

  it('14 dias e 15 dias na carteira: ainda não alerta; 16 dias: alerta com valor null (nunca visitado) e limiar 15', () => {
    expect(doTipo(avaliar(montar([naCarteira(CLIENTE_A, '2026-10-16T14:00:00Z')]), AGORA), 'cliente_sem_visita')).toHaveLength(0); // 14 dias
    expect(doTipo(avaliar(montar([naCarteira(CLIENTE_A, '2026-10-15T14:00:00Z')]), AGORA), 'cliente_sem_visita')).toHaveLength(0); // 15 dias: no limite, não passou
    const cs = doTipo(avaliar(montar([naCarteira(CLIENTE_A, '2026-10-14T14:00:00Z')]), AGORA), 'cliente_sem_visita'); // 16 dias
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ alvo_id: CLIENTE_A, valor: null, limiar: 15 });
    expect(cs[0]!.mensagem).toMatch(/nunca foi visitado.*16 dias na carteira/);
  });

  it('a entrada na carteira usa o dia no fuso do tenant (15/10 03:00Z ainda é 14/10 em Manaus → 16 dias; em UTC seriam 15 e não alertaria)', () => {
    expect(doTipo(avaliar(montar([naCarteira(CLIENTE_A, '2026-10-15T03:00:00Z')]), AGORA), 'cliente_sem_visita')).toHaveLength(1); // 14/10 em Manaus
    expect(doTipo(avaliar(montar([naCarteira(CLIENTE_A, '2026-10-16T03:00:00Z')]), AGORA), 'cliente_sem_visita')).toHaveLength(0); // 15/10 em Manaus → 15 dias
  });

  it('sem a data no evento, vale o primeiro evento do cliente com este vendedor (fora de ordem dá o mesmo); troca de carteira reinicia a carência', () => {
    const primeiro = naCarteira(CLIENTE_A, null, '2026-10-16T14:00:00Z');
    const depois = naCarteira(CLIENTE_A, null, '2026-10-29T14:00:00Z');
    expect(doTipo(avaliar(montar([primeiro, depois]), AGORA), 'cliente_sem_visita')).toHaveLength(0); // 14 dias desde 16/10
    const antigo = naCarteira(CLIENTE_A, null, '2026-10-01T14:00:00Z');
    expect(doTipo(avaliar(montar([depois, antigo]), AGORA), 'cliente_sem_visita')).toHaveLength(1); // 29 dias desde 01/10
    const trocou = naCarteira(CLIENTE_A, null, '2026-10-20T14:00:00Z', u(105));
    expect(doTipo(avaliar(montar([antigo, trocou]), AGORA), 'cliente_sem_visita')).toHaveLength(0); // novo vendedor há 10 dias
  });

  it('carência é parâmetro do tenant (0 = alerta a partir do 1º dia depois da entrada; no próprio dia ainda não passou)', () => {
    const s = montar([naCarteira(CLIENTE_A, '2026-10-29T14:00:00Z')]); // 1 dia na carteira
    expect(doTipo(avaliar(s, AGORA), 'cliente_sem_visita')).toHaveLength(0);
    expect(doTipo(avaliar(s, AGORA, { params: { dias_carencia_cliente_novo: 0 } }), 'cliente_sem_visita')[0]).toMatchObject({ valor: null, limiar: 0 });
    const hoje = montar([naCarteira(CLIENTE_A, '2026-10-30T14:00:00Z')]); // 0 dia: igual à carência 0, não passou
    expect(doTipo(avaliar(hoje, AGORA, { params: { dias_carencia_cliente_novo: 0 } }), 'cliente_sem_visita')).toHaveLength(0);
  });

  it('cliente já visitado não usa a carência, usa o limite da frequência (RN-GES-01)', () => {
    const s = montar([naCarteira(CLIENTE_A, '2026-10-29T14:00:00Z'), checkin({ cliente: CLIENTE_A, em: '2026-09-01T13:00:00Z' })]);
    expect(doTipo(avaliar(s, AGORA), 'cliente_sem_visita')[0]).toMatchObject({ valor: 59, limiar: 30 });
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

describe('RF-GES-07 / RN-GES-03: pedido aguardando aprovação além do prazo em dias úteis (mesmo prazo da fila)', () => {
  const solicita = (n: number, em: string, vendedor = VENDEDOR) =>
    ev('vendedor.pedido.aprovacao_solicitada@1', em, { pedido_id: u(1000 + n), vendedor_id: vendedor, cliente_id: CLIENTE_A, solicitada_em: em, nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 11, total_cents: 100_000 });
  const SEXTA_17H = '2026-11-06T21:00:00Z'; // sexta 06/11 17:00 em Manaus → prazo segunda 09/11 17:00 (21:00Z)
  const alertas = (s: ReturnType<typeof montar>, agora: string, extra: Parameters<typeof avaliar>[2] = {}) => doTipo(avaliar(s, agora, extra), 'pedido_aguardando_aprovacao');

  it('só alerta quando PASSA do prazo: segunda 17:00 exata não alerta, 17:01 alerta (valor = horas úteis de espera, limiar = horas úteis do prazo)', () => {
    const s = montar([solicita(1, SEXTA_17H), solicita(2, '2026-11-06T21:01:00Z')]);
    expect(alertas(s, '2026-11-09T21:00:00Z')).toHaveLength(0);
    const cs = alertas(s, '2026-11-09T21:01:00Z');
    expect(cs.map((c) => c.chave)).toEqual([`pedido_aguardando_aprovacao:${u(1001)}`]); // o pedido 2 vence um minuto depois
    expect(cs[0]).toMatchObject({ alvo_tipo: 'pedido', responsavel_id: VENDEDOR, severidade: 'critica', valor: 10.02, limiar: 10 });
    expect(cs[0]!.mensagem).toMatch(/1 dia útil/);
    expect(CondicaoAlerta.parse(cs[0])).toEqual(cs[0]);
  });

  it('o fim de semana não conta: pedido de sexta 17:00 não alerta no sábado, no domingo nem na segunda de manhã', () => {
    const s = montar([solicita(1, SEXTA_17H)]);
    expect(alertas(s, '2026-11-07T16:00:00Z')).toHaveLength(0);
    expect(alertas(s, '2026-11-08T16:00:00Z')).toHaveLength(0);
    expect(alertas(s, '2026-11-09T15:00:00Z')).toHaveLength(0);
  });

  it('pedido de sábado 10:00 conta de segunda 08:00: não alerta até terça 08:00, alerta depois', () => {
    const s = montar([solicita(1, '2026-11-07T14:00:00Z')]);
    expect(alertas(s, '2026-11-10T12:00:00Z')).toHaveLength(0);
    expect(alertas(s, '2026-11-10T12:01:00Z')).toHaveLength(1);
  });

  it('feriado do tenant na segunda: sexta 17:00 só alerta depois de terça 17:00', () => {
    const s = montar([solicita(1, SEXTA_17H)]);
    const p = { feriados: ['2026-11-09'] };
    expect(alertas(s, '2026-11-09T21:30:00Z', { params: p })).toHaveLength(0);
    expect(alertas(s, '2026-11-10T21:00:00Z', { params: p })).toHaveLength(0);
    expect(alertas(s, '2026-11-10T21:01:00Z', { params: p })).toHaveLength(1);
  });

  it('feriado nacional na segunda (Finados 02/11): sexta 30/10 17:00 só alerta depois de terça 03/11 17:00', () => {
    const s = montar([solicita(1, '2026-10-30T21:00:00Z')]);
    expect(alertas(s, '2026-11-02T22:00:00Z')).toHaveLength(0);
    expect(alertas(s, '2026-11-03T21:00:00Z')).toHaveLength(0);
    expect(alertas(s, '2026-11-03T21:01:00Z')).toHaveLength(1);
  });

  it('fuso do tenant: o mesmo pedido já passou do prazo em Manaus (segunda 17:00) e ainda não em São Paulo (terça 08:00 local)', () => {
    const s = montar([solicita(1, SEXTA_17H)]);
    expect(alertas(s, '2026-11-09T21:30:00Z')).toHaveLength(1);
    expect(alertas(s, '2026-11-09T21:30:00Z', { params: { fuso: 'America/Sao_Paulo' } })).toHaveLength(0);
    expect(alertas(s, '2026-11-10T11:01:00Z', { params: { fuso: 'America/Sao_Paulo' } })).toHaveLength(1);
  });

  it('prazo do tenant de 2 dias úteis: sexta 17:00 só alerta depois de terça 17:00', () => {
    const s = montar([solicita(1, SEXTA_17H)]);
    const p = { prazo_aprovacao_dias_uteis: 2 };
    expect(alertas(s, '2026-11-10T21:00:00Z', { params: p })).toHaveLength(0);
    expect(alertas(s, '2026-11-10T21:01:00Z', { params: p })[0]).toMatchObject({ limiar: 20 });
  });

  it('pedido decidido deixa de ser condição', () => {
    const s = montar([solicita(1, '2026-11-02T12:00:00Z'), statusAlterado({ pedido: u(1001), para: 'aprovado', em: '2026-11-03T09:00:00Z' })]);
    expect(alertas(s, '2026-11-10T16:00:00Z')).toHaveLength(0);
  });

  it('o limiar não é da regra: vem do prazo do tenant; a regra só liga/desliga (como o cliente_sem_visita)', () => {
    expect(() => resolverRegras({ pedido_aguardando_aprovacao: { limiar: 4 } })).toThrow(/pedido_aguardando_aprovacao.*prazo_aprovacao_dias_uteis/);
    const s = montar([solicita(1, SEXTA_17H)]);
    expect(alertas(s, '2026-11-09T21:01:00Z', { regras: { pedido_aguardando_aprovacao: { ativa: false } } })).toHaveLength(0);
  });

  it('o alerta e a fila usam o MESMO prazo: alerta ⇔ situação "vencido"', () => {
    const s = montar([solicita(1, SEXTA_17H)]);
    for (const agora of ['2026-11-09T20:59:00Z', '2026-11-09T21:00:00Z', '2026-11-09T21:01:00Z', '2026-11-10T14:00:00Z']) {
      expect(alertas(s, agora).length === 1).toBe(situacaoDoPrazo(SEXTA_17H, agora).situacao === 'vencido');
    }
  });
});

describe('RF-GES-07: alertas do promotor (ruptura recorrente, visita curta, fotos sem GPS) com payloads oficiais', () => {
  const lj = (n: number, o: { cliente?: string; min?: number; em: string; fotos?: [number, number]; desfecho?: DesfechoTeste }) => visitaLoja(n, o);
  const rup = rupturaRegistrada;
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
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-29T13:00:00Z', fotos: [0, 0] })]), AGORA), 'fotos_sem_gps')).toHaveLength(0); // visita sem fotos
  });

  it('T-0046 / RN-CORE-14: cliente fechado (loja_fechada/acesso_negado) não é visita curta nem conta na ruptura recorrente', () => {
    const s = montar([
      lj(1, { em: '2026-10-30T13:00:00Z', min: 3, desfecho: 'loja_fechada' }),
      lj(2, { em: '2026-10-30T14:00:00Z', min: 2, desfecho: 'acesso_negado' }),
      lj(3, { em: '2026-10-20T13:00:00Z' }),
      lj(4, { em: '2026-10-24T13:00:00Z' }),
      lj(5, { em: '2026-10-29T13:00:00Z', desfecho: 'acesso_negado' }),
      rup(1, 3, 'ruptura_total', '2026-10-20T13:10:00Z'),
      rup(2, 4, 'ruptura_total', '2026-10-24T13:10:00Z'),
      rup(3, 5, 'ruptura_total', '2026-10-29T13:10:00Z'), // de visita sem atendimento: fora
    ]);
    expect(doTipo(avaliar(s, AGORA), 'visita_curta')).toHaveLength(0);
    expect(doTipo(avaliar(s, AGORA), 'ruptura_recorrente')).toHaveLength(0);
    // a mesma visita de 3 min com desfecho `realizada` alerta
    expect(doTipo(avaliar(montar([lj(1, { em: '2026-10-30T13:00:00Z', min: 3 })]), AGORA), 'visita_curta')).toHaveLength(1);
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
