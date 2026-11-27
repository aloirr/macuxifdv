/**
 * GET|PUT /v1/vendedor/parametros/pedidos — Parâmetros › Pedidos: `titulo_vencido_dias` (RN-VEN-13), `validade_orcamento_dias` (RN-VEN-18), `pedido_minimo_cents` (RN-VEN-22),
 * `credito_excedido_acao` (RN-VEN-12) e `estoque_insuficiente_acao` (RN-VEN-20). Sem linha gravada vale o padrão do domain (o passo Empresa não grava as três últimas).
 * Só admin, analista e gerente (`alcada.gerenciar`, a mesma de Parâmetros › Pedidos › Alçadas). O PUT aceita qualquer subconjunto das chaves (vazio = 422),
 * revalida a faixa no domain (422 com a regra) e grava só as chaves enviadas pelo SDK (`ctx.gravarParametros`: idempotente; audita só o que mudou).
 */
import { ErroHttpModulo, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ROTA_PARAMETROS_PEDIDOS, type ParametrosPedidos } from '../contracts';
import {
  acaoCreditoExcedido,
  acaoEstoqueInsuficiente,
  pedidoMinimoCents,
  tituloVencidoDias,
  validadeOrcamentoDias,
  validarAcaoCreditoExcedido,
  validarAcaoEstoqueInsuficiente,
  validarPedidoMinimoCents,
  validarTituloVencidoDias,
  validarValidadeOrcamentoDias,
} from '../domain';

type ChaveParametrosPedidos = keyof ParametrosPedidos;

/** O Zod só confere o formato; a faixa é do domain, que responde 422 com a regra citada. */
const CorpoBruto = z
  .object({
    titulo_vencido_dias: z.unknown().optional(),
    validade_orcamento_dias: z.unknown().optional(),
    pedido_minimo_cents: z.unknown().optional(),
    credito_excedido_acao: z.unknown().optional(),
    estoque_insuficiente_acao: z.unknown().optional(),
  })
  .strict();

function lidos(p: Readonly<Record<string, unknown>>): ParametrosPedidos {
  return {
    titulo_vencido_dias: tituloVencidoDias(p),
    validade_orcamento_dias: validadeOrcamentoDias(p),
    pedido_minimo_cents: pedidoMinimoCents(p),
    credito_excedido_acao: acaoCreditoExcedido(p),
    estoque_insuficiente_acao: acaoEstoqueInsuficiente(p),
  };
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
    const c = ctx.corpo as Partial<Record<ChaveParametrosPedidos, unknown>>;
    const enviados: Record<string, number | string> = {};
    const checagens: Array<[ChaveParametrosPedidos, (v: unknown) => { ok: true; valor: number | string } | { ok: false; codigo: string; mensagem: string }]> = [
      ['titulo_vencido_dias', validarTituloVencidoDias],
      ['validade_orcamento_dias', validarValidadeOrcamentoDias],
      ['pedido_minimo_cents', validarPedidoMinimoCents],
      ['credito_excedido_acao', validarAcaoCreditoExcedido],
      ['estoque_insuficiente_acao', validarAcaoEstoqueInsuficiente],
    ];
    for (const [chave, validar] of checagens) {
      const valor = c[chave];
      if (valor === undefined) continue;
      const r = validar(valor);
      if (!r.ok) throw new ErroHttpModulo(422, r.codigo, r.mensagem);
      enviados[chave] = r.valor;
    }
    if (Object.keys(enviados).length === 0) throw new ErroHttpModulo(422, 'RN-VEN-13', 'Envie ao menos um parâmetro de Parâmetros › Pedidos.');
    await ctx.gravarParametros!(enviados, { acao: 'alcada.gerenciar' });
    return lidos({ ...ctx.parametros(), ...enviados });
  },
};

export const rotasParametrosPedidos: RotaModulo[] = [rotaLerParametrosPedidos, rotaGravarParametrosPedidos];
