/**
 * Campos obrigatórios do cliente, lista única do cadastro e do pré-cadastro (v1.0.29, ADR 0069 §6; RN-CORE-16, RN-CORE-79; RN-AUD-01):
 * `GET|PUT /v1/core/parametros/campos-obrigatorios`. GET: `parametro.campos_obrigatorios` (analista, admin), devolve a lista efetiva já
 * com os fixos (sem linha = o padrão da RN-CORE-16); PUT: `parametro.campos_obrigatorios_editar` (admin), aceita sem os fixos e o
 * servidor os acrescenta (razão social e CPF/CNPJ sempre). Substitui `parametros/pre-cadastro`.
 * Guardado em `plataforma.parametro` (módulo `core`, chave `cliente.campos_obrigatorios`). Até a versão mínima do Campo passar de 1.0.28,
 * o PUT grava na mesma transação o espelho `cliente.pre_cadastro.obrigatorios` (`projecaoLegadaObrigatorios`), que o APK antigo lê no
 * pull. Escrita idempotente: só audita (antes/depois) quando a lista muda. Licença do módulo pelo SDK; RLS do tenant da transação.
 */
import type { RotaModulo } from '@macuxi/platform-sdk';
import {
  CAMPOS_CADASTRO_CLIENTE,
  CAMPOS_CADASTRO_FIXOS,
  PARAMETRO_CAMPOS_OBRIGATORIOS,
  PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
  ParametroCamposObrigatoriosClienteSchema,
  type CampoCadastroCliente,
  type ParametroCamposObrigatoriosCliente,
} from '../contracts';
import { camposExigidos, projecaoLegadaObrigatorios } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

export const ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS = 'parametro.campos_obrigatorios';
export const ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS_EDITAR = 'parametro.campos_obrigatorios_editar';
const CAMINHO = 'parametros/campos-obrigatorios';

/** RN-CORE-16: a lista gravada leva sempre os fixos, na ordem canônica (nunca vazia: vazia voltaria ao padrão). */
function listaParaGravar(pedidos: readonly CampoCadastroCliente[]): CampoCadastroCliente[] {
  const conjunto = new Set<CampoCadastroCliente>([...CAMPOS_CADASTRO_FIXOS, ...pedidos]);
  return CAMPOS_CADASTRO_CLIENTE.filter((c) => conjunto.has(c));
}

export const rotasDeParametrosCamposObrigatorios: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: CAMINHO,
    superficie: 'bko',
    acao: ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS,
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<ParametroCamposObrigatoriosCliente> =>
        ParametroCamposObrigatoriosClienteSchema.parse({ obrigatorios: camposExigidos((await lerParametroCore(db, PARAMETRO_CAMPOS_OBRIGATORIOS))[0]?.valor) }),
      ),
  },
  {
    metodo: 'PUT',
    caminho: CAMINHO,
    superficie: 'bko',
    acao: ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS_EDITAR,
    carteira: 'nao_se_aplica',
    corpo: ParametroCamposObrigatoriosClienteSchema,
    executar: (ctx) => {
      const novo = listaParaGravar((ctx.corpo as ParametroCamposObrigatoriosCliente).obrigatorios);
      return ctx.comTenant(async (db): Promise<ParametroCamposObrigatoriosCliente> => {
        const antes = camposExigidos((await lerParametroCore(db, PARAMETRO_CAMPOS_OBRIGATORIOS))[0]?.valor);
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await gravarParametroCore(db, PARAMETRO_CAMPOS_OBRIGATORIOS, novo);
          await auditar(db, ctx, { acao: ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS_EDITAR, entidade: 'parametro', entidadeId: null, antes: { obrigatorios: antes }, depois: { obrigatorios: novo } });
        }
        // Espelho do APK v1.0.28 (RN-CORE-79): igual ou mais exigente que a lista nova; gravar o mesmo valor não muda a linha.
        await gravarParametroCore(db, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS, projecaoLegadaObrigatorios(novo));
        return { obrigatorios: novo };
      });
    },
  },
];
