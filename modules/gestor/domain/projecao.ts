/**
 * Projeção dos eventos consumidos para o read-model do Gestor (schema `gestor`). Funções PURAS sobre um estado
 * serializável (só objetos/arrays, sem Map/Set): a API persiste o estado (ou as tabelas equivalentes) e chama
 * `aplicarEvento` dentro da transação do consumidor.
 *
 * Garantias (testes em `projecao.test.ts`):
 *  - IDEMPOTENTE por `evento_id` (reentrega = `duplicado`, estado intacto) e por CHAVE DE NEGÓCIO (pedido_id,
 *    visita_id, resposta_id, execucao_id…): mesmo fato com `evento_id` novo não conta duas vezes;
 *  - `promotor.*@1` é validado com os schemas OFICIAIS do Promotor (via `EVENTOS_CONSUMIDOS`, T-0046);
 *  - FORA DE ORDEM: cada fato guarda só dados brutos e um carimbo `v` = (ocorrido_em, evento_id); em conflito vence
 *    o carimbo maior, e o histórico de status é um CONJUNTO por `evento_id`. Os indicadores são derivados na consulta
 *    (painel.ts), então a ordem de chegada nunca muda o resultado;
 *  - o dia civil e a base de apuração NÃO são fixados aqui (só UTC é guardado): mudar o fuso ou a base não exige replay.
 */
import {
  CAMPOS_CARTEIRA,
  EVENTOS_CONSUMIDOS,
  type AprovacaoSolicitadaV1,
  type ClienteAtualizadoV1,
  type FrequenciaVisita,
  type GondolaRegistradaV1,
  type LicaoConcluidaV1,
  type MedalhaConquistadaV1,
  type MetaDefinidaV1,
  type MetaDoMes,
  type PedidoCriadoV1,
  type PedidoFaturadoV1,
  type PrecoColetadoV1,
  type RespostaRegistradaV1,
  type RotaDiaPlanejadoV1,
  type RupturaRegistradaV1,
  type ShareMedidoV1,
  type StatusPedido,
  type TarefaConcluidaV1,
  type VisitaCheckinV1,
  type VisitaCheckoutV1,
  type VisitaLojaConcluidaV1,
} from '../contracts';
import { instanteMs } from './numeros';

/** Evento como chega do barramento (subconjunto do `EnvelopeEvento` do platform-sdk). */
export interface EventoRecebido {
  evento_id: string;
  nome: string;
  ocorrido_em: string;
  payload: unknown;
}

/** Carimbo de versão: instante (ms, 15 dígitos) + `evento_id`; comparável como texto. */
export type Carimbo = string;
export type Versionado<T> = T & { v: Carimbo };

export interface EntradaHistoricoPedido {
  evento_id: string;
  para: StatusPedido;
  /** Instante UTC da transição (`alterado_em`). */
  em: string;
}

/** Um retorno de faturamento do ERP (`vendedor.pedido.faturado@1`), guardado por `evento_id`. */
export interface FaturamentoPedido {
  parcial: boolean;
  faturado_em: string;
  itens: PedidoFaturadoV1['itens'];
}

export interface PedidoFato {
  criado?: Versionado<PedidoCriadoV1>;
  /** Conjunto por `evento_id` (ordem de chegada irrelevante). */
  historico: Record<string, EntradaHistoricoPedido>;
  /** RN-GES-06: faturamentos recebidos, conjunto por `evento_id` (o consumidor soma os itens). */
  faturamentos?: Record<string, FaturamentoPedido>;
}

export interface VisitaFato {
  checkin?: Versionado<VisitaCheckinV1>;
  checkout?: Versionado<VisitaCheckoutV1>;
}

type Tabela<T> = Record<string, Versionado<T>>;

/** Carteira de um cliente, como o Gestor guarda (campos opcionais do evento já resolvidos). */
export interface CarteiraCliente {
  cliente_id: string;
  vendedor_id: string | null;
  ativo: boolean;
  nome?: string;
  frequencia_visita: FrequenciaVisita | null;
  na_carteira_desde: string | null;
}

export interface EstadoProjecao {
  /** `evento_id` já aplicados (idempotência). A persistência pode podar por retenção: as chaves de negócio protegem. */
  processados: Record<string, true>;
  /** Clientes com carteira CONHECIDA (o evento trouxe `vendedor_id`). */
  clientes: Tabela<CarteiraCliente>;
  /**
   * T-0046: clientes cujo último `core.cliente.atualizado@1` não trouxe a carteira (`vendedor_id` ausente) — sem carteira
   * conhecida, ou com `campos` de carteira alterados sem o novo dono. Valor = carimbo do evento; vale enquanto for mais
   * novo que a carteira conhecida (`situacaoDaCarteira`). O alerta `cliente_sem_visita` não roda para eles.
   */
  carteira_pendente: Record<string, Carimbo>;
  /**
   * RN-GES-02: chave `<cliente_id>|<vendedor_id>` → primeiro instante (UTC) em que o cliente apareceu na carteira
   * desse vendedor. Mínimo dos `ocorrido_em`, então independe da ordem de chegada.
   */
  entradas_carteira: Record<string, string>;
  /** Chave `<usuario_id>|<AAAA-MM-DD>`. */
  planejadas: Tabela<RotaDiaPlanejadoV1>;
  /** Chave `<usuario_id>|<AAAA-MM>`. */
  metas: Tabela<MetaDoMes>;
  pedidos: Record<string, PedidoFato>;
  aprovacoes: Tabela<AprovacaoSolicitadaV1>;
  visitas: Record<string, VisitaFato>;
  visitas_loja: Tabela<VisitaLojaConcluidaV1>;
  gondolas: Tabela<GondolaRegistradaV1>;
  shares: Tabela<ShareMedidoV1>;
  precos: Tabela<PrecoColetadoV1>;
  rupturas: Tabela<RupturaRegistradaV1>;
  /** Chave `execucao_id` (execução da tarefa numa loja); `tarefa_id` é o agrupador da campanha (`execucoesDaTarefa`). */
  tarefas: Tabela<TarefaConcluidaV1>;
  respostas: Tabela<RespostaRegistradaV1>;
  licoes: Tabela<LicaoConcluidaV1>;
  medalhas: Tabela<MedalhaConquistadaV1>;
}

export function estadoInicial(): EstadoProjecao {
  return {
    processados: {},
    clientes: {},
    carteira_pendente: {},
    entradas_carteira: {},
    planejadas: {},
    metas: {},
    pedidos: {},
    aprovacoes: {},
    visitas: {},
    visitas_loja: {},
    gondolas: {},
    shares: {},
    precos: {},
    rupturas: {},
    tarefas: {},
    respostas: {},
    licoes: {},
    medalhas: {},
  };
}

export type SituacaoAplicacao = 'aplicado' | 'duplicado' | 'ignorado' | 'invalido';
export interface ResultadoAplicacao {
  estado: EstadoProjecao;
  situacao: SituacaoAplicacao;
  /** Em português; só em `invalido`. */
  motivo?: string;
  /** Em português; evento aplicado com dado incompleto (ex.: carteira não informada). Sem dado pessoal (só ids). */
  aviso?: string;
}

function carimbo(e: EventoRecebido): Carimbo {
  return `${String(instanteMs(e.ocorrido_em)).padStart(15, '0')}|${e.evento_id}`;
}

/** Grava o fato se o carimbo for maior que o atual (devolve a mesma tabela se nada mudou). */
function gravar<T>(tabela: Tabela<T>, chave: string, fato: Versionado<T>): Tabela<T> {
  const atual = tabela[chave];
  if (atual && atual.v >= fato.v) return tabela;
  return { ...tabela, [chave]: fato };
}

function pedidoDe(estado: EstadoProjecao, id: string): PedidoFato {
  return estado.pedidos[id] ?? { historico: {} };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDS_DO_VENDEDOR = ['pedido_id', 'vendedor_id', 'cliente_id'] as const;

/** Campos de instante dos eventos do Vendedor que o schema do dono não restringe a ISO UTC (RN-GES-03/06: prazo e faturado dependem deles). */
const INSTANTES_DO_VENDEDOR: Record<string, readonly string[]> = {
  'vendedor.pedido.criado@1': ['criado_em'],
  'vendedor.pedido.aprovacao_solicitada@1': ['solicitada_em'],
  'vendedor.pedido.faturado@1': ['faturado_em'],
};

/**
 * Aplica UM evento. Nunca lança por dado ruim: payload inválido volta como `invalido` com o motivo; evento de
 * outro módulo/versão volta como `ignorado`. O estado devolvido é novo (o recebido não é mutado).
 */
export function aplicarEvento(estado: EstadoProjecao, evento: EventoRecebido): ResultadoAplicacao {
  const schema = (EVENTOS_CONSUMIDOS as Record<string, (typeof EVENTOS_CONSUMIDOS)[keyof typeof EVENTOS_CONSUMIDOS]>)[evento.nome];
  if (!schema) return { estado, situacao: 'ignorado' };
  if (estado.processados[evento.evento_id]) return { estado, situacao: 'duplicado' };
  if (Number.isNaN(Date.parse(evento.ocorrido_em))) return { estado, situacao: 'invalido', motivo: `Data e hora do evento inválidas: ${evento.ocorrido_em}.` };
  const lido = schema.safeParse(evento.payload);
  if (!lido.success) {
    const i = lido.error.issues[0]!;
    return { estado, situacao: 'invalido', motivo: `Payload de ${evento.nome} inválido em "${i.path.join('.')}": ${i.message}` };
  }
  // T-0024: o Vendedor publica id e instante como texto livre (`Id`, `IsoDateTime`); o Gestor exige UUID e data válida, como antes.
  if (evento.nome.startsWith('vendedor.')) {
    for (const campo of IDS_DO_VENDEDOR) {
      const valor = (lido.data as Record<string, unknown>)[campo];
      if (valor !== undefined && (typeof valor !== 'string' || !UUID.test(valor))) return { estado, situacao: 'invalido', motivo: `Payload de ${evento.nome} inválido em "${campo}": identificador inválido.` };
    }
  }
  for (const campo of INSTANTES_DO_VENDEDOR[evento.nome] ?? []) {
    const valor = (lido.data as Record<string, unknown>)[campo];
    if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) return { estado, situacao: 'invalido', motivo: `Payload de ${evento.nome} inválido em "${campo}": data e hora inválidas.` };
  }
  const p = lido.data as never;
  const v = carimbo(evento);
  const base = { ...estado, processados: { ...estado.processados, [evento.evento_id]: true as const } };

  switch (evento.nome) {
    case 'core.cliente.atualizado@1': {
      const d = p as ClienteAtualizadoV1;
      if (d.vendedor_id === undefined) {
        // T-0046: o Core ainda não publica a carteira. Sem carteira conhecida (ou com campo de carteira alterado sem o
        // novo dono), o cliente fica PENDENTE com aviso — nunca "carteira vazia" em silêncio.
        const conhecida = base.clientes[d.cliente_id];
        const mexeuNaCarteira = d.campos.some((c) => (CAMPOS_CARTEIRA as readonly string[]).includes(c));
        if (conhecida && !mexeuNaCarteira) return ok(base);
        const pendentes = (base.carteira_pendente[d.cliente_id] ?? '') >= v ? base.carteira_pendente : { ...base.carteira_pendente, [d.cliente_id]: v };
        return {
          estado: { ...base, carteira_pendente: pendentes },
          situacao: 'aplicado',
          aviso: `Carteira incompleta: core.cliente.atualizado@1 do cliente ${d.cliente_id} sem vendedor_id; o alerta de cliente sem visita fica desligado para ele até o Core informar a carteira.`,
        };
      }
      let entradas = base.entradas_carteira;
      if (d.vendedor_id) {
        const k = `${d.cliente_id}|${d.vendedor_id}`;
        const atual = entradas[k];
        if (!atual || instanteMs(evento.ocorrido_em) < instanteMs(atual)) entradas = { ...entradas, [k]: evento.ocorrido_em };
      }
      const carteira: Versionado<CarteiraCliente> = {
        cliente_id: d.cliente_id,
        vendedor_id: d.vendedor_id,
        ativo: d.ativo ?? true,
        frequencia_visita: d.frequencia_visita ?? null,
        na_carteira_desde: d.na_carteira_desde ?? null,
        v,
      };
      return ok({ ...base, entradas_carteira: entradas, clientes: gravar(base.clientes, d.cliente_id, carteira) });
    }
    case 'core.visita.checkin@1': {
      const d = p as VisitaCheckinV1;
      const atual = base.visitas[d.visita_id] ?? {};
      if (atual.checkin && atual.checkin.v >= v) return ok(base);
      return ok({ ...base, visitas: { ...base.visitas, [d.visita_id]: { ...atual, checkin: { ...d, v } } } });
    }
    case 'core.visita.checkout@1': {
      const d = p as VisitaCheckoutV1;
      const atual = base.visitas[d.visita_id] ?? {};
      // RN-CORE-11 / eventos.md: o checkout do usuário substitui o automático (servidor) e nunca o contrário, qualquer
      // que seja a ordem de chegada ou o `ocorrido_em`; entre dois do mesmo tipo vence o carimbo maior.
      const ex = atual.checkout;
      if (ex && ex.fechada_por !== d.fechada_por) {
        if (ex.fechada_por === 'usuario') return ok(base);
      } else if (ex && ex.v >= v) return ok(base);
      return ok({ ...base, visitas: { ...base.visitas, [d.visita_id]: { ...atual, checkout: { ...d, v } } } });
    }
    case 'core.rota.dia_planejado@1': {
      const d = p as RotaDiaPlanejadoV1;
      return ok({ ...base, planejadas: gravar(base.planejadas, `${d.usuario_id}|${d.data}`, { ...d, v }) });
    }
    case 'core.meta.definida@1': {
      const d = p as MetaDefinidaV1;
      // T-0024: formato oficial do Core; o Gestor só usa a meta de venda (centavos). Outro indicador não entra no painel.
      if (d.indicador !== 'venda_cents') return ok(base);
      const meta: MetaDoMes = { usuario_id: d.usuario_id, mes: d.periodo, meta_cents: d.valor };
      return ok({ ...base, metas: gravar(base.metas, `${d.usuario_id}|${d.periodo}`, { ...meta, v }) });
    }
    case 'vendedor.pedido.criado@1': {
      const d = p as PedidoCriadoV1;
      const atual = pedidoDe(base, d.pedido_id);
      if (atual.criado && atual.criado.v >= v) return ok(base);
      return ok({ ...base, pedidos: { ...base.pedidos, [d.pedido_id]: { ...atual, criado: { ...d, v } } } });
    }
    case 'vendedor.pedido.status_alterado@1': {
      const d = p as { pedido_id: string; para: StatusPedido; alterado_em: string };
      if (Number.isNaN(Date.parse(d.alterado_em))) return { estado, situacao: 'invalido', motivo: `Data e hora da transição inválidas: ${d.alterado_em}.` };
      const atual = pedidoDe(base, d.pedido_id);
      const historico = { ...atual.historico, [evento.evento_id]: { evento_id: evento.evento_id, para: d.para, em: d.alterado_em } };
      return ok({ ...base, pedidos: { ...base.pedidos, [d.pedido_id]: { ...atual, historico } } });
    }
    case 'vendedor.pedido.aprovacao_solicitada@1': {
      const d = p as AprovacaoSolicitadaV1;
      // vence a solicitação mais recente do pedido (revalidação após edição gera outra solicitação)
      const vSolic = `${String(instanteMs(d.solicitada_em)).padStart(15, '0')}|${evento.evento_id}`;
      return ok({ ...base, aprovacoes: gravar(base.aprovacoes, d.pedido_id, { ...d, v: vSolic }) });
    }
    case 'vendedor.pedido.faturado@1': {
      const d = p as PedidoFaturadoV1;
      const atual = pedidoDe(base, d.pedido_id);
      const faturamentos = { ...(atual.faturamentos ?? {}), [evento.evento_id]: { parcial: d.parcial, faturado_em: d.faturado_em, itens: d.itens } };
      return ok({ ...base, pedidos: { ...base.pedidos, [d.pedido_id]: { ...atual, faturamentos } } });
    }
    case 'promotor.visita_loja.concluida@1': {
      const d = p as VisitaLojaConcluidaV1;
      return ok({ ...base, visitas_loja: gravar(base.visitas_loja, d.visita_loja_id, { ...d, v }) });
    }
    case 'promotor.gondola.registrada@1': {
      const d = p as GondolaRegistradaV1;
      return ok({ ...base, gondolas: gravar(base.gondolas, d.gondola_id, { ...d, v }) });
    }
    case 'promotor.share.medido@1': {
      const d = p as ShareMedidoV1;
      return ok({ ...base, shares: gravar(base.shares, d.medicao_id, { ...d, v }) });
    }
    case 'promotor.preco.coletado@1': {
      const d = p as PrecoColetadoV1;
      return ok({ ...base, precos: gravar(base.precos, d.coleta_id, { ...d, v }) });
    }
    case 'promotor.ruptura.registrada@1': {
      const d = p as RupturaRegistradaV1;
      return ok({ ...base, rupturas: gravar(base.rupturas, d.registro_id, { ...d, v }) });
    }
    case 'promotor.tarefa.concluida@1': {
      const d = p as TarefaConcluidaV1;
      // T-0046: a chave do fato é a EXECUÇÃO numa loja; a mesma tarefa de campanha (`tarefa_id`) se repete em várias lojas
      return ok({ ...base, tarefas: gravar(base.tarefas, d.execucao_id, { ...d, v }) });
    }
    case 'pesquisa.resposta.registrada@1': {
      const d = p as RespostaRegistradaV1;
      return ok({ ...base, respostas: gravar(base.respostas, d.resposta_id, { ...d, v }) });
    }
    case 'treinamento.licao.concluida@1': {
      const d = p as LicaoConcluidaV1;
      return ok({ ...base, licoes: gravar(base.licoes, d.progresso_id, { ...d, v }) });
    }
    case 'treinamento.medalha.conquistada@1': {
      const d = p as MedalhaConquistadaV1;
      return ok({ ...base, medalhas: gravar(base.medalhas, d.medalha_usuario_id, { ...d, v }) });
    }
    default:
      return { estado, situacao: 'ignorado' };
  }
}

/**
 * RN-GES-02: quando o cliente entrou na carteira do vendedor ATUAL: `na_carteira_desde` do evento (se o Core informar)
 * ou o primeiro evento visto do cliente com esse vendedor. `null` = sem carteira ou cliente desconhecido.
 */
export function entradaNaCarteira(estado: EstadoProjecao, clienteId: string): string | null {
  const c = estado.clientes[clienteId];
  if (!c || !c.vendedor_id) return null;
  return c.na_carteira_desde ?? estado.entradas_carteira[`${clienteId}|${c.vendedor_id}`] ?? null;
}

function ok(estado: EstadoProjecao): ResultadoAplicacao {
  return { estado, situacao: 'aplicado' };
}

/**
 * Execuções de uma tarefa de campanha (`tarefa_id`), uma por loja/visita (`execucao_id`), em ordem de conclusão
 * (desempate pelo `execucao_id`). Opcionalmente só as de um promotor.
 */
export function execucoesDaTarefa(estado: EstadoProjecao, tarefaId: string, promotorId?: string): Versionado<TarefaConcluidaV1>[] {
  return Object.values(estado.tarefas)
    .filter((t) => t.tarefa_id === tarefaId && (promotorId === undefined || t.promotor_id === promotorId))
    .sort((a, b) => instanteMs(a.concluida_em) - instanteMs(b.concluida_em) || (a.execucao_id < b.execucao_id ? -1 : a.execucao_id > b.execucao_id ? 1 : 0));
}

/** Situação da carteira projetada (T-0046): aviso de carteira incompleta para a API/BKO, em vez de carteira vazia. */
export interface SituacaoCarteira {
  completa: boolean;
  /** Clientes conhecidos só por eventos sem carteira, ou com a carteira alterada sem o novo dono (ordenados). */
  clientes_pendentes: string[];
  /** Em português, com a ação seguinte; `null` com a carteira completa. */
  aviso: string | null;
}

/** `true` se o cliente está com a carteira pendente (evento sem `vendedor_id` mais novo que a carteira conhecida). */
export function carteiraPendente(estado: EstadoProjecao, clienteId: string): boolean {
  const p = estado.carteira_pendente[clienteId];
  return p !== undefined && p > (estado.clientes[clienteId]?.v ?? '');
}

export function situacaoDaCarteira(estado: EstadoProjecao): SituacaoCarteira {
  const pendentes = Object.keys(estado.carteira_pendente)
    .filter((c) => carteiraPendente(estado, c))
    .sort();
  if (pendentes.length === 0) return { completa: true, clientes_pendentes: [], aviso: null };
  const n = pendentes.length;
  return {
    completa: false,
    clientes_pendentes: pendentes,
    aviso: `Carteira incompleta: ${n} ${n === 1 ? 'cliente sem' : 'clientes sem'} vendedor informado pelo Core. O alerta de cliente sem visita não vale para ${n === 1 ? 'ele' : 'eles'} até o Core publicar a carteira no core.cliente.atualizado@1.`,
  };
}

/** Aplica uma lista em sequência; devolve o estado final e a contagem por situação. */
export function aplicarEventos(estado: EstadoProjecao, eventos: readonly EventoRecebido[]): { estado: EstadoProjecao; contagem: Record<SituacaoAplicacao, number>; avisos: number } {
  const contagem: Record<SituacaoAplicacao, number> = { aplicado: 0, duplicado: 0, ignorado: 0, invalido: 0 };
  let atual = estado;
  let avisos = 0;
  for (const e of eventos) {
    const r = aplicarEvento(atual, e);
    atual = r.estado;
    contagem[r.situacao] += 1;
    if (r.aviso) avisos += 1;
  }
  return { estado: atual, contagem, avisos };
}
