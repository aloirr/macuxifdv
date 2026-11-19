/**
 * Aprovar ou devolver pelo app (RN-GES-08, RN-VEN-30; T-0184): o corpo das rotas e o detalhe depois da resposta, que traz só o status e as
 * aprovações do ciclo (`{ status, aprovacoes }`). Funções puras; a chamada e o sinal ficam em `use-vendedor.ts`.
 */
import type { DecisaoAprovacaoResposta, OrderDetail } from '../../contracts';

/** `rejeitar` é a rota que DEVOLVE o pedido ao vendedor (`rejected`): o corpo leva `texto`. */
export function corpoDaDecisaoNoApp(decisao: 'aprovar' | 'rejeitar', texto: string): { comentario?: string; texto?: string } {
  const t = texto.trim();
  return decisao === 'aprovar' ? (t ? { comentario: t } : {}) : { texto: t };
}

export function aplicarDecisaoNoDetalhe(d: OrderDetail, r: DecisaoAprovacaoResposta): OrderDetail {
  const pendentes = r.aprovacoes.filter((a) => a.estado === 'pendente');
  if (r.status === 'pending_approval' && pendentes.length > 0) {
    return { ...d, status: r.status, aprovacoes: r.aprovacoes, approval_reasons: pendentes.map((a) => a.motivo), pending_reason: pendentes.map((a) => a.texto_pendencia).join(' · ') || d.pending_reason };
  }
  const { approval_reasons: _fora, ...resto } = d;
  void _fora;
  return { ...resto, status: r.status, aprovacoes: r.aprovacoes, nivel_aprovacao: null, pode_decidir: false, pending_reason: '' };
}
