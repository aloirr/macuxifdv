/**
 * Consulta ao servidor quando o período escolhido está fora da janela de 90 dias do aparelho (T-0077 item 6, RF-VEN-05).
 * Usa a listagem `GET /v1/vendedor/pedidos` (escopo de carteira/equipe, licença e `promotor_ve_pedidos` valem no servidor).
 * Sem sinal não há consulta: a tela diz que o período não está no aparelho e volta com o sinal. Funções puras.
 */
import { intervaloDoPeriodo, type Periodo } from '../../domain/busca-periodo';
import type { Order } from '../../contracts';
import type { PedidoDaLista } from './pedidos';

export const PAGINAS_MAXIMAS_DA_CONSULTA = 5;

export function caminhoDaConsultaPorPeriodo(p: Periodo, cursor: string | null): string {
  const { from, to } = intervaloDoPeriodo(p);
  return `/vendedor/pedidos?from=${from}&to=${to}&por_status=1&tipo=todos&limite=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}

export type EstadoDaConsulta = 'local' | 'consultar' | 'disponivel_com_conexao';

export function estadoDaConsulta(o: { fora: boolean; offline: boolean }): EstadoDaConsulta {
  if (!o.fora) return 'local';
  return o.offline ? 'disponivel_com_conexao' : 'consultar';
}

export function mensagemForaDaJanela(e: 'disponivel_com_conexao' | 'carregando' | 'erro'): string {
  if (e === 'disponivel_com_conexao') return 'Sem sinal: este período não está no aparelho. Os pedidos aparecem quando o sinal voltar.';
  if (e === 'carregando') return 'Buscando no servidor…';
  return 'Não foi possível consultar o servidor. Puxe para baixo para tentar de novo.';
}

export function pedidosDaConsulta(itens: readonly Order[]): PedidoDaLista[] {
  return itens.map((o) => ({ ...o, local: false, local_error: '' }));
}

export interface EntradaTextoDoVazio {
  fora: boolean;
  modoConsulta: string | null | undefined;
  estadoDoServidor: 'ok' | 'erro' | 'carregando' | null | undefined;
  buscando: boolean;
  situacao: string;
  gestao: boolean;
}

/** Texto da lista vazia de Pedidos: fora da janela sem resposta, com busca, ou conforme a situação. */
export function textoDoVazio(e: EntradaTextoDoVazio): string {
  if (e.fora) {
    if (e.estadoDoServidor === 'ok') return 'Nenhum pedido neste período.';
    return mensagemForaDaJanela(e.modoConsulta === 'disponivel_com_conexao' ? 'disponivel_com_conexao' : e.estadoDoServidor === 'erro' ? 'erro' : 'carregando');
  }
  if (e.buscando) return 'Nenhum pedido encontrado. Confira o nome ou o número, ou limpe a busca.';
  if (e.situacao === 'orcamentos') return 'Nenhum orçamento neste período.';
  if (e.situacao === 'decide') return 'Nada para aprovar agora.';
  if (e.situacao === 'todos') return e.gestao ? 'Nenhum pedido da equipe neste período.' : 'Nenhum pedido neste período. Toque em Novo para começar.';
  return 'Nenhum pedido com esta situação neste período.';
}

/**
 * T-0090: período que sai em parte da janela do aparelho. Junta o que veio do servidor com o que está no aparelho, sem duplicar por id:
 * a fila e as edições locais (local=true) têm prioridade sobre o item do servidor; o que só o aparelho tem entra; o resto vem do servidor.
 */
export function juntarServidorComAparelho(servidor: readonly PedidoDaLista[], aparelho: readonly PedidoDaLista[]): PedidoDaLista[] {
  const porId = new Map<string, PedidoDaLista>();
  for (const s of servidor) porId.set(s.id, s);
  for (const a of aparelho) {
    if (a.local || !porId.has(a.id)) porId.set(a.id, a);
  }
  return [...porId.values()];
}

/** T-0090 UX1: resumo da busca; com vendedor escolhido (Gestão) o nome entra, para o "0 resultados" não ficar sem motivo. */
export function resumoDaBusca(quantidade: number, vendedor: string | null): string {
  const n = `${quantidade} ${quantidade === 1 ? 'resultado' : 'resultados'}`;
  return vendedor ? `${n} · ${vendedor} · últimos 90 dias` : `${n} · últimos 90 dias`;
}

/** T-0090 UX2: o chip A faturar (do Início) ignora o período; escolher um período volta para Todos, para a etiqueta não mentir. */
export function situacaoAoEscolherPeriodo<S extends string>(situacao: S | null): S | 'todos' | null {
  return situacao === 'a_faturar' ? 'todos' : situacao;
}

/** T-0090 UX5: mesmo padrão da etiqueta de período. */
export function rotuloRemoverVendedor(nome: string): string {
  return `Remover filtro ${nome}`;
}
