/**
 * Retorno do ERP no pedido do Vendedor (T-0054; desenho T-0011): status pelo `integracao.pedido.retorno_erp@1`,
 * itens faturados por sequência, `vendedor.pedido.faturado@1` e devolução pela nota do ERP
 * (`integracao.nota.atualizado@1`, tipo `devolucao`). Funções puras: o consumidor (api/retorno-erp.ts) só lê, decide aqui
 * e grava. Estrutural de propósito: nada é importado do módulo de integração (os nomes do ERP vêm como texto).
 *
 * Regras:
 *  - RN-INT-08: o retorno chega como `integrado` | `rejeitado_erp` | `faturado_parcial` | `faturado_total` | `cancelado`
 *    (o Hub também conhece `pendente` e `enviado`, que não mudam nada aqui além do `enviado`).
 *  - RN-VEN-30: o retorno só AVANÇA o status (aprovado < enviado < integrado < faturado parcial < faturado total); o que
 *    chega atrasado não volta o pedido. `cancelado` vale de aprovado em diante (o Hub não publica o `enviado`, então o
 *    pedido do Vendedor pode estar `approved` quando o ERP cancela) e é final. `rejeitado_erp` só antes de integrado.
 *  - RN-TRE-08: o faturado publica os itens DESTE retorno (sequência → produto do próprio pedido, limitado ao saldo);
 *    parcial sem itens não publica; total sem itens fatura o saldo.
 *  - RN-VEN-37 (proposta ao gerente, T-0054): devolução não muda o status; soma das notas de devolução do pedido ÷
 *    faturado = situação "parcial"/"total"; nota cancelada/inativada sai da soma; sem estorno no Treinamento.
 */
import { formatBRL } from '@macuxi/comum';
import type { PedidoFaturadoEvento } from '../contracts/eventos';
import type { OrderStatus } from './order';

// ---------------------------------------------------------------------------------------------------- status do pedido
/** Ordem do avanço pelo retorno (RN-VEN-30). `rejected` conta como aprovado: o ERP pode integrar depois de corrigido. */
const AVANCO: Partial<Record<OrderStatus, number>> = {
  approved: 0,
  rejected: 0,
  sent_to_erp: 1,
  integrated: 2,
  invoiced_partial: 3,
  invoiced: 4,
};
const ALVO: Record<string, OrderStatus> = {
  enviado: 'sent_to_erp',
  integrado: 'integrated',
  faturado_parcial: 'invoiced_partial',
  faturado_total: 'invoiced',
};

export interface RetornoDoErp {
  status: string;
  numero_erp: string | null;
  motivo: string | null;
  nota: { numero: string; serie?: string | null } | null;
  ocorrido_em: string;
}

export type MotivoIgnorado = 'pedido_nao_aprovado' | 'pedido_finalizado' | 'fora_de_ordem' | 'sem_efeito' | 'status_desconhecido';

export type DecisaoRetorno =
  | {
      aplicar: true;
      de: OrderStatus;
      para: OrderStatus;
      mudouStatus: boolean;
      /** número do pedido no ERP a gravar (o informado; senão o atual) */
      numero_erp: string | null;
      motivo_rejeicao: string | null;
      motivo_cancelamento: string | null;
      /** texto da linha do tempo quando o status muda (RF-VEN-05) */
      historico: string;
      /** retorno `faturado_*`: grava a nota e os itens (mesmo sem mudar o status) */
      registraFaturamento: boolean;
      parcial: boolean;
    }
  | { aplicar: false; motivo: MotivoIgnorado };

const MOTIVO_MAX = 500;
const corta = (s: string): string => (s.length > MOTIVO_MAX ? `${s.slice(0, MOTIVO_MAX - 1)}…` : s);
const textoNota = (n: RetornoDoErp['nota']): string => (n ? `NF ${n.numero}${n.serie ? `/${n.serie}` : ''}` : '');

/**
 * RN-INT-08 / RN-VEN-30: o que o retorno do ERP faz com o pedido. `numeroErpAtual` evita gravar de novo o mesmo
 * `integrado` repetido (o consumidor também é idempotente por `evento_id`).
 */
export function decidirRetornoErp(atual: OrderStatus, retorno: RetornoDoErp, numeroErpAtual: string | null = null): DecisaoRetorno {
  if (atual === 'cancelled') return { aplicar: false, motivo: 'pedido_finalizado' };
  const nivelAtual = AVANCO[atual];
  if (nivelAtual === undefined) return { aplicar: false, motivo: 'pedido_nao_aprovado' };
  const numero = retorno.numero_erp?.trim() ? retorno.numero_erp.trim() : numeroErpAtual;
  const base = { de: atual, numero_erp: numero, motivo_rejeicao: null, motivo_cancelamento: null, registraFaturamento: false, parcial: false } as const;

  switch (retorno.status) {
    case 'pendente':
      return { aplicar: false, motivo: 'sem_efeito' };
    case 'cancelado': {
      const m = retorno.motivo?.trim();
      const motivo = corta(m ? `Cancelado no ERP: ${m}` : 'Cancelado no ERP.');
      return { ...base, aplicar: true, para: 'cancelled', mudouStatus: true, motivo_cancelamento: motivo, historico: motivo };
    }
    case 'rejeitado_erp': {
      if (nivelAtual >= 2) return { aplicar: false, motivo: 'fora_de_ordem' };
      if (atual === 'rejected') return { aplicar: false, motivo: 'sem_efeito' };
      const motivo = corta(`Rejeitado pelo ERP: ${retorno.motivo?.trim() || 'sem motivo informado'}`);
      return { ...base, aplicar: true, para: 'rejected', mudouStatus: true, motivo_rejeicao: motivo, historico: motivo };
    }
    case 'enviado':
    case 'integrado':
    case 'faturado_parcial':
    case 'faturado_total': {
      const para = ALVO[retorno.status]!;
      const nivelAlvo = AVANCO[para]!;
      const fatura = retorno.status === 'faturado_parcial' || retorno.status === 'faturado_total';
      const parcial = retorno.status === 'faturado_parcial';
      if (nivelAlvo < nivelAtual || (nivelAlvo === nivelAtual && !fatura)) {
        // mesmo status com número novo do ERP: só atualiza o número
        if (nivelAlvo === nivelAtual && numero !== numeroErpAtual) {
          return { ...base, aplicar: true, para: atual, mudouStatus: false, historico: '' };
        }
        // faturamento atrasado (parcial depois do total): registra a nota sem voltar o status
        if (fatura) return { ...base, aplicar: true, para: atual, mudouStatus: false, historico: '', registraFaturamento: true, parcial };
        return { aplicar: false, motivo: nivelAlvo < nivelAtual ? 'fora_de_ordem' : 'sem_efeito' };
      }
      const nota = textoNota(retorno.nota);
      const historico =
        para === 'sent_to_erp'
          ? 'Enviado ao ERP.'
          : para === 'integrated'
            ? `Integrado ao ERP${numero ? ` (nº ${numero})` : ''}.`
            : `${parcial ? 'Faturado parcialmente' : 'Faturado'}${nota ? ` — ${nota}` : ''}.`;
      return { ...base, aplicar: true, para, mudouStatus: para !== atual, historico, registraFaturamento: fatura, parcial };
    }
    default:
      return { aplicar: false, motivo: 'status_desconhecido' };
  }
}

// ---------------------------------------------------------------------------------------------------- itens faturados
export interface ItemDoPedidoParaFaturar {
  sequencia: number;
  product_id: string;
  quantity: number;
}
export interface ItemDoRetorno {
  sequencia: number;
  quantidade: number;
  valor_cents?: number | null;
}
export interface QuantidadeFaturada {
  sequencia: number;
  quantidade: number;
}
export interface ItemFaturadoNoPedido {
  sequencia: number;
  product_id: string;
  quantity: number;
  valor_cents: number | null;
}
export interface DivergenciaFaturamento {
  sequencia: number;
  codigo: 'sequencia_inexistente' | 'acima_do_saldo';
  informada: number;
  aceita: number;
}

function somaPorSequencia(l: readonly QuantidadeFaturada[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of l) m.set(x.sequencia, (m.get(x.sequencia) ?? 0) + x.quantidade);
  return m;
}

/**
 * RN-INT-08 / RN-TRE-08 (desenho T-0011 §2.2): itens deste faturamento no pedido.
 *  - com itens no retorno (parcial ou total): sequência → produto do pedido; a mesma sequência soma; limita ao saldo
 *    (pedido − já faturado); sequência que não existe fica de fora. Divergências voltam para o log (sem dado pessoal);
 *  - `faturado_total` sem itens: o saldo de cada sequência;
 *  - `faturado_parcial` sem itens: nada (o total seguinte cobre o saldo).
 */
export function itensDoFaturamento(
  status: string,
  itensRetorno: readonly ItemDoRetorno[] | null | undefined,
  itensPedido: readonly ItemDoPedidoParaFaturar[],
  jaFaturados: readonly QuantidadeFaturada[],
): { itens: ItemFaturadoNoPedido[]; divergencias: DivergenciaFaturamento[] } {
  const ja = somaPorSequencia(jaFaturados);
  const porSeq = new Map(itensPedido.map((i) => [i.sequencia, i]));
  const saldo = (seq: number) => Math.max(0, (porSeq.get(seq)?.quantity ?? 0) - (ja.get(seq) ?? 0));

  if (!itensRetorno || itensRetorno.length === 0) {
    if (status !== 'faturado_total') return { itens: [], divergencias: [] };
    const itens = [...itensPedido]
      .sort((a, b) => a.sequencia - b.sequencia)
      .map((i) => ({ sequencia: i.sequencia, product_id: i.product_id, quantity: saldo(i.sequencia), valor_cents: null }))
      .filter((i) => i.quantity > 0);
    return { itens, divergencias: [] };
  }

  const pedidos = new Map<number, { quantidade: number; valor: number | null }>();
  for (const r of itensRetorno) {
    const atual = pedidos.get(r.sequencia);
    const valor = r.valor_cents ?? null;
    if (!atual) pedidos.set(r.sequencia, { quantidade: r.quantidade, valor });
    else pedidos.set(r.sequencia, { quantidade: atual.quantidade + r.quantidade, valor: atual.valor === null || valor === null ? null : atual.valor + valor });
  }
  const itens: ItemFaturadoNoPedido[] = [];
  const divergencias: DivergenciaFaturamento[] = [];
  for (const [sequencia, r] of pedidos) {
    const doPedido = porSeq.get(sequencia);
    if (!doPedido) {
      divergencias.push({ sequencia, codigo: 'sequencia_inexistente', informada: r.quantidade, aceita: 0 });
      continue;
    }
    const aceita = Math.min(r.quantidade, saldo(sequencia));
    if (aceita < r.quantidade) divergencias.push({ sequencia, codigo: 'acima_do_saldo', informada: r.quantidade, aceita });
    if (aceita > 0) itens.push({ sequencia, product_id: doPedido.product_id, quantity: aceita, valor_cents: r.valor });
  }
  itens.sort((a, b) => a.sequencia - b.sequencia);
  return { itens, divergencias };
}

/** RN-TRE-08: `vendedor.pedido.faturado@1` com os itens deste faturamento somados por produto; sem itens = `null`. */
export function eventoFaturadoDosItens(
  pedido: { id: string; vendedor_id: string },
  faturadoEm: string,
  parcial: boolean,
  itens: readonly ItemFaturadoNoPedido[],
): PedidoFaturadoEvento | null {
  const soma = new Map<string, number>();
  for (const i of itens) if (i.quantity > 0) soma.set(i.product_id, (soma.get(i.product_id) ?? 0) + i.quantity);
  if (soma.size === 0) return null;
  return {
    pedido_id: pedido.id,
    vendedor_id: pedido.vendedor_id,
    faturado_em: faturadoEm,
    parcial,
    itens: [...soma].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
  };
}

// ---------------------------------------------------------------------------------------------------- devolução
export interface NotaDoErp {
  tipo: string;
  pedido_uuid?: string | null;
  numero: string;
  serie?: string | null;
  emitida_em: string;
  total_cents: number;
  cancelada?: boolean;
}
export interface EventoNota {
  acao: string;
  external_id: string;
  registro?: NotaDoErp;
}
export type DecisaoDevolucao =
  | { tipo: 'gravar'; pedido_id: string; external_id: string; numero: string; serie: string | null; emitida_em: string; total_cents: number }
  | { tipo: 'remover'; external_id: string };

/**
 * RN-VEN-37 (proposta): nota de devolução do ERP com o UUID do pedido do Macuxi → gravar (upsert pelo `external_id` da
 * nota). Inativada, cancelada, sem pedido do Macuxi ou que deixou de ser devolução → remover (some da soma; idempotente).
 */
export function decidirNotaDevolucao(e: EventoNota): DecisaoDevolucao {
  const r = e.registro;
  if (e.acao === 'inativado' || !r || r.tipo !== 'devolucao' || r.cancelada || !r.pedido_uuid) return { tipo: 'remover', external_id: e.external_id };
  return {
    tipo: 'gravar',
    pedido_id: r.pedido_uuid,
    external_id: e.external_id,
    numero: r.numero,
    serie: r.serie ?? null,
    emitida_em: r.emitida_em,
    total_cents: Math.abs(Math.trunc(r.total_cents)),
  };
}

// ---------------------------------------------------------------------------------------------------- resumo para as telas
export interface FaturamentoRegistrado {
  nota_numero: string | null;
  nota_total_cents: number | null;
  faturado_em: string;
  itens: ReadonlyArray<{ sequencia: number; quantidade: number; valor_cents: number | null }>;
}
export interface ResumoFaturamento {
  itens: Array<{ sequencia: number; quantidade: number; faturada: number; saldo: number }>;
  faturado_cents: number;
  devolvido_cents: number;
  devolucao: SituacaoDevolucao;
  notas: number;
  ultima_nota: string | null;
  ultimo_faturamento_em: string | null;
}
export type SituacaoDevolucao = 'nenhuma' | 'parcial' | 'total';

export function situacaoDevolucao(faturadoCents: number, devolvidoCents: number): SituacaoDevolucao {
  if (devolvidoCents <= 0) return 'nenhuma';
  return faturadoCents > 0 && devolvidoCents >= faturadoCents ? 'total' : 'parcial';
}

/**
 * RF-VEN-05 / RN-VEN-37: quanto de cada item já foi faturado, o valor faturado (valor do item no retorno; sem valor, a
 * proporção do total do item no pedido; nota sem itens, o total da nota) e a situação da devolução.
 */
export function resumoFaturamento(
  itensPedido: ReadonlyArray<{ sequencia: number; quantity: number; total_cents: number }>,
  faturamentos: readonly FaturamentoRegistrado[],
  devolucoes: ReadonlyArray<{ total_cents: number }>,
): ResumoFaturamento {
  const porSeq = new Map(itensPedido.map((i) => [i.sequencia, i]));
  const faturada = new Map<number, number>();
  let faturado = 0;
  for (const f of faturamentos) {
    if (f.itens.length === 0) {
      faturado += Math.max(0, f.nota_total_cents ?? 0);
      continue;
    }
    for (const i of f.itens) {
      faturada.set(i.sequencia, (faturada.get(i.sequencia) ?? 0) + i.quantidade);
      const p = porSeq.get(i.sequencia);
      faturado += i.valor_cents ?? (p && p.quantity > 0 ? Math.round((p.total_cents * i.quantidade) / p.quantity) : 0);
    }
  }
  const devolvido = devolucoes.reduce((s, d) => s + Math.max(0, d.total_cents), 0);
  const ordenados = [...faturamentos].sort((a, b) => a.faturado_em.localeCompare(b.faturado_em));
  const ultimo = ordenados[ordenados.length - 1] ?? null;
  return {
    itens: [...itensPedido]
      .sort((a, b) => a.sequencia - b.sequencia)
      .map((i) => {
        const f = Math.min(i.quantity, faturada.get(i.sequencia) ?? 0);
        return { sequencia: i.sequencia, quantidade: i.quantity, faturada: f, saldo: i.quantity - f };
      }),
    faturado_cents: faturado,
    devolvido_cents: devolvido,
    devolucao: situacaoDevolucao(faturado, devolvido),
    notas: faturamentos.length,
    ultima_nota: ultimo?.nota_numero ?? null,
    ultimo_faturamento_em: ultimo?.faturado_em ?? null,
  };
}

/** RF-VEN-05: linhas curtas da situação de faturamento e devolução (app e BKO; em reais, nunca em %). */
export function textoSituacaoFaturamento(r: { faturado_cents: number; devolvido_cents: number; ultima_nota: string | null; notas: number }): string[] {
  const linhas: string[] = [];
  if (r.notas > 0 || r.faturado_cents > 0) {
    const valor = formatBRL(r.faturado_cents);
    if (r.notas > 1) linhas.push(`Faturado ${valor} em ${r.notas} notas${r.ultima_nota ? ` (última NF ${r.ultima_nota})` : ''}`);
    else linhas.push(`Faturado ${valor}${r.ultima_nota ? ` (NF ${r.ultima_nota})` : ''}`);
  }
  const dev = situacaoDevolucao(r.faturado_cents, r.devolvido_cents);
  if (dev !== 'nenhuma') linhas.push(`Devolvido ${formatBRL(r.devolvido_cents)} (${dev})`);
  return linhas;
}

/** Campos de faturamento do pedido para as telas (lista e detalhe), a partir das colunas de resumo do pedido. */
export interface CamposFaturamento {
  faturado_cents: number;
  devolvido_cents: number;
  devolucao: SituacaoDevolucao;
  ultima_nota: string | null;
  situacao_faturamento: string[];
}

/**
 * RF-VEN-05: o mesmo resumo na API (lista/detalhe) e no app (pull offline). Sem a coluna `faturado_cents` (antes da
 * migração ou linha antiga do aparelho) devolve `{}`: a tela não mostra nada.
 */
export function camposFaturamento(l: {
  faturado_cents?: number | string | null;
  devolvido_cents?: number | string | null;
  notas_faturamento?: number | string | null;
  ultima_nota_numero?: string | null;
}): Partial<CamposFaturamento> {
  if (l.faturado_cents === undefined || l.faturado_cents === null) return {};
  const faturado = Number(l.faturado_cents);
  const devolvido = Number(l.devolvido_cents ?? 0);
  const notas = Number(l.notas_faturamento ?? 0);
  const ultima = l.ultima_nota_numero ?? null;
  return {
    faturado_cents: faturado,
    devolvido_cents: devolvido,
    devolucao: situacaoDevolucao(faturado, devolvido),
    ultima_nota: ultima,
    situacao_faturamento: textoSituacaoFaturamento({ faturado_cents: faturado, devolvido_cents: devolvido, ultima_nota: ultima, notas }),
  };
}

/** RF-VEN-05: "Faturado 6 de 10" no item; `null` = sem retorno de faturamento (não mostra). */
export function textoItemFaturado(quantidade: number, faturada: number | null | undefined): string | null {
  if (faturada === undefined || faturada === null) return null;
  if (faturada <= 0) return 'Não faturado';
  if (faturada >= quantidade) return 'Faturado';
  return `Faturado ${faturada} de ${quantidade}`;
}
