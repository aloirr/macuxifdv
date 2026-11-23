/**
 * Parâmetro dos campos obrigatórios do pré-cadastro de cliente (v1.0.28; RN-CORE-79; RN-AUD-01):
 * `GET|PUT /v1/core/parametros/pre-cadastro`, GET: `parametro.pre_cadastro` (admin, analista); PUT: `parametro.pre_cadastro_editar` (admin).
 * Guardado em `plataforma.parametro` (módulo `core`, chave `cliente.pre_cadastro.obrigatorios`); sem linha, nenhum campo configurável é obrigatório.
 * Escrita idempotente: só grava e audita (antes/depois) o que mudou. A licença do módulo é checada pelo SDK; RLS do tenant da transação.
 */
import type { RotaModulo } from '@macuxi/platform-sdk';
import {
  PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
  ParametroPreCadastroSchema,
  obrigatoriosPreCadastroDasLinhas,
  type ParametroPreCadastro,
} from '../contracts';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

export const ACAO_PARAMETRO_PRE_CADASTRO = 'parametro.pre_cadastro';
export const ACAO_PARAMETRO_PRE_CADASTRO_EDITAR = 'parametro.pre_cadastro_editar';
const CAMINHO = 'parametros/pre-cadastro';

export const rotasDeParametrosPreCadastro: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: CAMINHO,
    superficie: 'bko',
    acao: ACAO_PARAMETRO_PRE_CADASTRO,
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<ParametroPreCadastro> => ParametroPreCadastroSchema.parse({ obrigatorios: obrigatoriosPreCadastroDasLinhas(await lerParametroCore(db, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS)) })),
  },
  {
    metodo: 'PUT',
    caminho: CAMINHO,
    superficie: 'bko',
    acao: ACAO_PARAMETRO_PRE_CADASTRO_EDITAR,
    carteira: 'nao_se_aplica',
    corpo: ParametroPreCadastroSchema,
    executar: (ctx) => {
      const novo = ctx.corpo as ParametroPreCadastro;
      return ctx.comTenant(async (db): Promise<ParametroPreCadastro> => {
        const antes = obrigatoriosPreCadastroDasLinhas(await lerParametroCore(db, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS));
        if (JSON.stringify([...antes].sort()) !== JSON.stringify([...novo.obrigatorios].sort())) {
          await gravarParametroCore(db, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS, novo.obrigatorios);
          await auditar(db, ctx, { acao: ACAO_PARAMETRO_PRE_CADASTRO_EDITAR, entidade: 'parametro', entidadeId: null, antes: { obrigatorios: antes }, depois: novo });
        }
        return novo;
      });
    },
  },
];
