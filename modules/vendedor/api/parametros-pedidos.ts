/**
 * GET|PUT /v1/vendedor/parametros/pedidos — Parâmetros › Pedidos: `titulo_vencido_dias` (RN-VEN-13) e `validade_orcamento_dias` (RN-VEN-18).
 * Só admin, analista e gerente (`alcada.gerenciar`, a mesma de Parâmetros › Pedidos › Alçadas). O PUT aceita uma ou as duas chaves (vazio = 422),
 * revalida a faixa no domain (422 com a regra) e grava só as chaves enviadas pelo SDK (`ctx.gravarParametros`: idempotente; audita só o que mudou).
 */
import { ErroHttpModulo, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ROTA_PARAMETROS_PEDIDOS, type ParametrosPedidos } from '../contracts';
import { tituloVencidoDias, validadeOrcamentoDias, validarTituloVencidoDias, validarValidadeOrcamentoDias } from '../domain';

/** O Zod só confere o formato; a faixa é do domain, que responde 422 com a regra citada. */
const CorpoBruto = z.object({ titulo_vencido_dias: z.unknown().optional(), validade_orcamento_dias: z.unknown().optional() }).strict();

function lidos(p: Readonly<Record<string, unknown>>): ParametrosPedidos {
  return { titulo_vencido_dias: tituloVencidoDias(p), validade_orcamento_dias: validadeOrcamentoDias(p) };
}

export const rotaLerParametrosPedidos: RotaModulo = {
  metodo: 'GET',
  caminho: ROTA_PARAMETROS_PEDIDOS,
  acao: 'alcada.gerenciar',
  carteira: 'nao_se_aplica',
  executar: (ctx): Promise<ParametrosPedidos> => Promise.resolve(lidos(ctx.parametros())),
};

export const rotaGravarParametrosPedidos: RotaModulo = {
  metodo: 'PUT',
  caminho: ROTA_PARAMETROS_PEDIDOS,
  acao: 'alcada.gerenciar',
  carteira: 'nao_se_aplica',
  corpo: CorpoBruto,
  async executar(ctx): Promise<ParametrosPedidos> {
    const c = ctx.corpo as { titulo_vencido_dias?: unknown; validade_orcamento_dias?: unknown };
    const enviados: Record<string, number> = {};
    const checagens: Array<[string, unknown, typeof validarTituloVencidoDias]> = [
      ['titulo_vencido_dias', c.titulo_vencido_dias, validarTituloVencidoDias],
      ['validade_orcamento_dias', c.validade_orcamento_dias, validarValidadeOrcamentoDias],
    ];
    for (const [chave, valor, validar] of checagens) {
      if (valor === undefined) continue;
      const r = validar(valor);
      if (!r.ok) throw new ErroHttpModulo(422, r.codigo, r.mensagem);
      enviados[chave] = r.valor;
    }
    if (Object.keys(enviados).length === 0) throw new ErroHttpModulo(422, 'RN-VEN-13', 'Envie ao menos um parâmetro: titulo_vencido_dias ou validade_orcamento_dias.');
    await ctx.gravarParametros!(enviados, { acao: 'alcada.gerenciar' });
    return lidos({ ...ctx.parametros(), ...enviados });
  },
};

export const rotasParametrosPedidos: RotaModulo[] = [rotaLerParametrosPedidos, rotaGravarParametrosPedidos];
