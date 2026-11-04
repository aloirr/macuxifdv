/**
 * Card "Pedidos para aprovar" do Início da Gestão (T-0073, docs/design/inicio.md §5.1). Só APRESENTAÇÃO sobre a fila
 * que o aparelho já tem (cache `fila`, RN-GES-03/04): o número é o da alçada de quem olha (`para_mim`), e o resumo mostra
 * o primeiro pedido que ele pode decidir. Aprovar continua em 1 toque na tela do pedido (RN-GES-08).
 */
import { formatBRL0 } from '@macuxi/comum';
import { firstName } from '@macuxi/ui/mobile/puro';
import type { FilaAprovacao } from '../../contracts';
import { MOTIVO_ROTULO } from './apresentacao';
import { pct } from './formato';

export interface ResumoCardAprovacao {
  /** Fila sem nada na alçada: cartão suave, não tocável. */
  vazio: boolean;
  total: number;
  titulo: string;
  /** "Lucas · 8% de desconto · R$ 2.310"; `null` com a fila vazia. */
  linha: string | null;
  rotuloAcessivel: string;
}

const SEM_PEDIDO = 'Nenhum pedido esperando aprovação.';

/** `null` = sem cópia da fila no aparelho (o card não aparece até a primeira sincronização). */
export function resumoDoCardAprovacao(fila: FilaAprovacao | null, nomes: ReadonlyMap<string, string>): ResumoCardAprovacao | null {
  if (!fila) return null;
  const total = fila.resumo.para_mim;
  const primeiro = fila.itens.find((i) => i.pode_decidir);
  if (total === 0 || !primeiro) return { vazio: true, total: 0, titulo: SEM_PEDIDO, linha: null, rotuloAcessivel: SEM_PEDIDO };
  const vendedor = firstName(nomes.get(primeiro.vendedor_id) ?? 'Vendedor');
  const motivo = primeiro.desconto_efetivo_pct > 0 ? `${pct(primeiro.desconto_efetivo_pct)} de desconto` : MOTIVO_ROTULO[primeiro.motivos[0]!];
  const valor = formatBRL0(primeiro.total_cents);
  const titulo = total === 1 ? 'Pedido para aprovar' : 'Pedidos para aprovar';
  return {
    vazio: false,
    total,
    titulo,
    linha: `${vendedor} · ${motivo} · ${valor}`,
    rotuloAcessivel: `${total} ${total === 1 ? 'pedido' : 'pedidos'} para aprovar. O primeiro: ${vendedor}, ${motivo}, ${valor}.`,
  };
}
