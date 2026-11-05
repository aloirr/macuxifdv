/**
 * Consulta ao servidor quando o período escolhido está fora da janela de 90 dias do aparelho (T-0077 item 6, RF-VEN-05).
 * Usa a listagem `GET /v1/vendedor/pedidos` (escopo de carteira/equipe, licença e `promotor_ve_pedidos` valem no servidor).
 * Sem sinal não há consulta: a tela diz "Disponível com conexão". Funções puras.
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
  if (e === 'disponivel_com_conexao') return 'Disponível com conexão';
  if (e === 'carregando') return 'Buscando no servidor…';
  return 'Não foi possível consultar o servidor. Puxe para baixo para tentar de novo.';
}

export function pedidosDaConsulta(itens: readonly Order[]): PedidoDaLista[] {
  return itens.map((o) => ({ ...o, local: false, local_error: '' }));
}
