/**
 * Parâmetros › Pedidos (v1.0.37): `GET|PUT /v1/vendedor/parametros/pedidos`, ação `parametro.pedidos` (admin, analista e gerente; a licença do
 * módulo e o tenant são do SDK). Grava `orcamento.validade_dias` (RN-VEN-18, 1 a 90; padrão 7) e `titulo_vencido_dias` (0 a 365; padrão 5) pelo
 * SDK (`ctx.gravarParametros`: idempotente e auditado); os mesmos `validadeOrcamentoDias` e `tituloVencidoDias` do domain leem as chaves.
 */
import { ErroRegraNegocio, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { FAIXA_TITULO_VENCIDO_DIAS, FAIXA_VALIDADE_ORCAMENTO_DIAS, ParametrosPedidos, PutParametrosPedidosRequest } from '../contracts';
import { PARAMETRO_VALIDADE_ORCAMENTO, tituloVencidoDias, validadeOrcamentoDias } from '../domain';

const CHAVE_ATRASO = 'titulo_vencido_dias';

const ler = (ctx: Pick<ContextoBase, 'parametros'>): ParametrosPedidos => {
  const p = { ...ctx.parametros() };
  return { validade_orcamento_dias: validadeOrcamentoDias(p), titulo_vencido_dias: tituloVencidoDias(p) };
};

export const rotasParametrosPedidos: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/pedidos',
    acao: 'parametro.pedidos',
    carteira: 'nao_se_aplica',
    executar: async (ctx): Promise<ParametrosPedidos> => ler(ctx),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/pedidos',
    acao: 'parametro.pedidos',
    carteira: 'nao_se_aplica',
    corpo: PutParametrosPedidosRequest,
    async executar(ctx): Promise<ParametrosPedidos> {
      const c = ctx.corpo as PutParametrosPedidosRequest;
      const dentro = (v: number, f: { min: number; max: number }) => Number.isInteger(v) && v >= f.min && v <= f.max;
      const { validade_orcamento_dias: val, titulo_vencido_dias: atraso } = c;
      if (val === undefined && atraso === undefined) throw new ErroRegraNegocio('RN-VEN-18', 'Informe ao menos um parâmetro.');
      if (val !== undefined && !dentro(val, FAIXA_VALIDADE_ORCAMENTO_DIAS)) throw new ErroRegraNegocio('RN-VEN-18', `Informe a validade do orçamento de ${FAIXA_VALIDADE_ORCAMENTO_DIAS.min} a ${FAIXA_VALIDADE_ORCAMENTO_DIAS.max} dias.`);
      if (atraso !== undefined && !dentro(atraso, FAIXA_TITULO_VENCIDO_DIAS)) throw new ErroRegraNegocio('RN-VEN-13', `Informe os dias de atraso de ${FAIXA_TITULO_VENCIDO_DIAS.min} a ${FAIXA_TITULO_VENCIDO_DIAS.max}.`);
      const valores: Record<string, unknown> = {};
      if (c.validade_orcamento_dias !== undefined) valores[PARAMETRO_VALIDADE_ORCAMENTO] = c.validade_orcamento_dias;
      if (c.titulo_vencido_dias !== undefined) valores[CHAVE_ATRASO] = c.titulo_vencido_dias;
      await ctx.gravarParametros!(valores, { acao: 'parametro.pedidos' });
      return ler(ctx);
    },
  },
];
