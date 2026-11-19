/**
 * PUT /v1/vendedor/alcadas/aprovadores — quem aprova crédito e quem aprova inadimplência (T-0184, P2 B; padrão gerente, P5 B).
 * Grava `aprovacao.credito_nivel` e `aprovacao.inadimplencia_nivel` pelo SDK (`ctx.gravarParametros`: idempotente e auditado); o servidor
 * lê as mesmas chaves em `niveisDosParametros` ao receber o pedido. O limite de crédito não é configurável: vem do ERP (RN-VEN-12).
 */
import { PutAprovadoresRequest, type NivelAprovacao } from '../contracts';
import type { RotaModulo } from '@macuxi/platform-sdk';

export const rotaGravarAprovadores: RotaModulo = {
  metodo: 'PUT',
  caminho: 'alcadas/aprovadores',
  acao: 'alcada.gerenciar',
  carteira: 'nao_se_aplica',
  corpo: PutAprovadoresRequest,
  async executar(ctx) {
    const c = ctx.corpo as { aprovador_credito: NivelAprovacao; aprovador_inadimplencia: NivelAprovacao };
    await ctx.gravarParametros!({ 'aprovacao.credito_nivel': c.aprovador_credito, 'aprovacao.inadimplencia_nivel': c.aprovador_inadimplencia }, { acao: 'alcada.gerenciar' });
    return { aprovador_credito: c.aprovador_credito, aprovador_inadimplencia: c.aprovador_inadimplencia };
  },
};
