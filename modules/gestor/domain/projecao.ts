/**
 * Projeção dos eventos consumidos para o read-model do Gestor (schema `gestor`). Funções PURAS sobre um estado
 * serializável (só objetos/arrays, sem Map/Set): a API persiste o estado (ou as tabelas equivalentes) e chama
 * `aplicarEvento` dentro da transação do consumidor.
 *
 * Garantias (testes em `projecao.test.ts`):
 *  - IDEMPOTENTE por `evento_id` (reentrega = `duplicado`, estado intacto) e por CHAVE DE NEGÓCIO (pedido_id,
 *    visita_id, resposta_id…): mesmo fato com `evento_id` novo não conta duas vezes;
 *  - FORA DE ORDEM: cada fato guarda só dados brutos e um carimbo `v` = (ocorrido_em, evento_id); em conflito vence
 *    o carimbo maior, e o histórico de status é um CONJUNTO por `evento_id`. Os indicadores são derivados na consulta
 *    (painel.ts), então a ordem de chegada nunca muda o resultado;
 *  - o dia civil e a base de apuração NÃO são fixados aqui (só UTC é guardado): mudar o fuso ou a base não exige replay.
 */
import {
  EVENTOS_CONSUMIDOS,
  type AprovacaoSolicitadaV1,
  type ClienteAtualizadoV1,
  type GondolaRegistradaV1,
  type LicaoConcluidaV1,
  type MedalhaConquistadaV1,
  type MetaDefinidaV1,
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

export interface EstadoProjecao {
  /** `evento_id` já aplicados (idempotência). A persistência pode podar por retenção: as chaves de negócio protegem. */
  processados: Record<string, true>;
  clientes: Tabela<ClienteAtualizadoV1>;
  /**
   * RN-GES-02: chave `<cliente_id>|<vendedor_id>` → primeiro instante (UTC) em que o cliente apareceu na carteira
   * desse vendedor. Mínimo dos `ocorrido_em`, então independe da ordem de chegada.
   */
  entradas_carteira: Record<string, string>;
  /** Chave `<usuario_id>|<AAAA-MM-DD>`. */
  planejadas: Tabela<RotaDiaPlanejadoV1>;
  /** Chave `<usuario_id>|<AAAA-MM>`. */
  metas: Tabela<MetaDefinidaV1>;
  pedidos: Record<string, PedidoFato>;
  aprovacoes: Tabela<AprovacaoSolicitadaV1>;
  visitas: Record<string, VisitaFato>;
  visitas_loja: Tabela<VisitaLojaConcluidaV1>;
  gondolas: Tabela<GondolaRegistradaV1>;
  shares: Tabela<ShareMedidoV1>;
  precos: Tabela<PrecoColetadoV1>;
  rupturas: Tabela<RupturaRegistradaV1>;
  tarefas: Tabela<TarefaConcluidaV1>;
  respostas: Tabela<RespostaRegistradaV1>;
  licoes: Tabela<LicaoConcluidaV1>;
  medalhas: Tabela<MedalhaConquistadaV1>;
}

export function estadoInicial(): EstadoProjecao {
  return {
    processados: {},
    clientes: {},
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
  const p = lido.data as never;
  const v = carimbo(evento);
  const base = { ...estado, processados: { ...estado.processados, [evento.evento_id]: true as const } };

  switch (evento.nome) {
    case 'core.cliente.atualizado@1': {
      const d = p as ClienteAtualizadoV1;
      let entradas = base.entradas_carteira;
      if (d.vendedor_id) {
        const k = `${d.cliente_id}|${d.vendedor_id}`;
        const atual = entradas[k];
        if (!atual || instanteMs(evento.ocorrido_em) < instanteMs(atual)) entradas = { ...entradas, [k]: evento.ocorrido_em };
      }
      return ok({ ...base, entradas_carteira: entradas, clientes: gravar(base.clientes, d.cliente_id, { ...d, v }) });
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
      if (atual.checkout && atual.checkout.v >= v) return ok(base);
      return ok({ ...base, visitas: { ...base.visitas, [d.visita_id]: { ...atual, checkout: { ...d, v } } } });
    }
    case 'core.rota.dia_planejado@1': {
      const d = p as RotaDiaPlanejadoV1;
      return ok({ ...base, planejadas: gravar(base.planejadas, `${d.usuario_id}|${d.data}`, { ...d, v }) });
    }
    case 'core.meta.definida@1': {
      const d = p as MetaDefinidaV1;
      return ok({ ...base, metas: gravar(base.metas, `${d.usuario_id}|${d.mes}`, { ...d, v }) });
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
      return ok({ ...base, tarefas: gravar(base.tarefas, d.tarefa_id, { ...d, v }) });
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

/** Aplica uma lista em sequência; devolve o estado final e a contagem por situação. */
export function aplicarEventos(estado: EstadoProjecao, eventos: readonly EventoRecebido[]): { estado: EstadoProjecao; contagem: Record<SituacaoAplicacao, number> } {
  const contagem: Record<SituacaoAplicacao, number> = { aplicado: 0, duplicado: 0, ignorado: 0, invalido: 0 };
  let atual = estado;
  for (const e of eventos) {
    const r = aplicarEvento(atual, e);
    atual = r.estado;
    contagem[r.situacao] += 1;
  }
  return { estado: atual, contagem };
}
