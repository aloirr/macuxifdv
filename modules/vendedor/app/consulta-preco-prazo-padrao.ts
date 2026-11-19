/**
 * Consulta `vendedor.preco_prazo_padrao@1` no aparelho (ADR 0012; RN-VEN-43): lê só as linhas locais (pull de `forma_pagamento`,
 * `prazo_pagamento` e do `cliente` do Core, que só traz a carteira do usuário) e aplica a mesma regra da API
 * (`ajustarCentsPeloPrazoPadrao`). Cliente fora do aparelho (fora da carteira) ou sem prazo padrão: valores iguais.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { ajustarCentsPeloPrazoPadrao, CONSULTA_PRECO_PRAZO_PADRAO, type FormaPagamentoSync, type PrazoPagamentoSync } from '../contracts';

export const consultaPrecoPrazoPadraoAparelho = implementarConsultaAparelho(CONSULTA_PRECO_PRAZO_PADRAO, async (entrada, ctx) => {
  if (entrada.cents.length === 0) return { cents: [] };
  const [cliente] = await ctx.linhasPorIds<{ id: string; deleted_at?: string | null; formas_pagamento?: string[] | null }>('cliente', [entrada.cliente_id]);
  if (!cliente || cliente.deleted_at) return { cents: [...entrada.cents] };
  const formas = (await ctx.linhas<FormaPagamentoSync>('forma_pagamento')).filter((f) => !f.deleted_at);
  const prazos = (await ctx.linhas<PrazoPagamentoSync>('prazo_pagamento')).filter((p) => !p.deleted_at);
  return {
    cents: ajustarCentsPeloPrazoPadrao(entrada.cents, {
      cliente: { formas_pagamento: cliente.formas_pagamento ?? null },
      formas: formas.map((f) => ({ id: f.id, codigo: f.codigo, nome: f.nome, ativo: f.ativo, ordem: f.ordem })),
      prazos: prazos.map((p) => ({ id: p.id, forma_pagamento_id: p.forma_pagamento_id, codigo: p.codigo, descricao: p.descricao, parcelas_dias: p.parcelas_dias, prazo_medio_dias: p.prazo_medio_dias, percentual_ajuste: p.percentual_ajuste ?? 0, ordem: p.ordem, ativo: p.ativo })),
    }),
  };
});
