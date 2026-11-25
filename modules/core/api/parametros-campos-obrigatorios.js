import { PARAMETRO_CAMPOS_OBRIGATORIOS, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS, ParametroCamposObrigatoriosClienteSchema, } from '../contracts';
import { camposExigidos, comFixos, projecaoLegadaObrigatorios } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';
export const ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS = 'parametro.campos_obrigatorios';
export const ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS_EDITAR = 'parametro.campos_obrigatorios_editar';
const CAMINHO = 'parametros/campos-obrigatorios';
export const rotasDeParametrosCamposObrigatorios = [
    {
        metodo: 'GET',
        caminho: CAMINHO,
        superficie: 'bko',
        acao: ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS,
        carteira: 'nao_se_aplica',
        executar: (ctx) => ctx.comTenant(async (db) => ParametroCamposObrigatoriosClienteSchema.parse({ obrigatorios: camposExigidos((await lerParametroCore(db, PARAMETRO_CAMPOS_OBRIGATORIOS))[0]?.valor) })),
    },
    {
        metodo: 'PUT',
        caminho: CAMINHO,
        superficie: 'bko',
        acao: ACAO_PARAMETRO_CAMPOS_OBRIGATORIOS_EDITAR,
        carteira: 'nao_se_aplica',
        corpo: ParametroCamposObrigatoriosClienteSchema,
        executar: (ctx) => {
            // RN-CORE-16: a lista gravada leva sempre os fixos (nunca vazia: vazia voltaria ao padrão)
            const novo = comFixos(ctx.corpo.obrigatorios);
            return ctx.comTenant(async (db) => {
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
