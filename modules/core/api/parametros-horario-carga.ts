/**
 * Horário esperado da carga do ERP por tenant (RN-CORE-65; RN-AUD-01; T-0189): `GET|PUT /v1/core/parametros/horario-carga`, ação
 * `parametro.inicio` (analista e admin; a licença do módulo é checada pelo SDK). Uma linha `integracao.horario_carga` em `plataforma.parametro`
 * (modulo `core`, RLS do tenant), valor `{ padrao, entidades }`; ausente = 06:00 para todas. A API revalida com `validarHorarioCarga` (domain).
 * Escrita idempotente: só grava e audita (antes/depois) o que mudou.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { HorarioCargaPutSchema, HorarioCargaSchema, PARAMETRO_HORARIO_CARGA, type HorarioCarga, type HorarioCargaPut } from '../contracts';
import { horarioCargaDasLinhas, validarHorarioCarga } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

export async function lerHorarioCarga(db: ClienteBanco): Promise<HorarioCarga> {
  return horarioCargaDasLinhas(await lerParametroCore(db, PARAMETRO_HORARIO_CARGA));
}

export const rotasDeParametrosHorarioCarga: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/horario-carga',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<HorarioCarga> => HorarioCargaSchema.parse(await lerHorarioCarga(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/horario-carga',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    corpo: HorarioCargaPutSchema,
    executar: async (ctx) => {
      const v = validarHorarioCarga(ctx.corpo as HorarioCargaPut);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-65', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo = v.valores;
      return ctx.comTenant(async (db): Promise<HorarioCarga> => {
        const antes = await lerHorarioCarga(db);
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await gravarParametroCore(db, PARAMETRO_HORARIO_CARGA, novo);
          await auditar(db, ctx, { acao: 'parametro.inicio', entidade: 'parametro', entidadeId: null, antes: { horario_carga: antes }, depois: { horario_carga: novo } });
        }
        return novo;
      });
    },
  },
];
