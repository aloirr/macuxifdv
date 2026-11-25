/**
 * Provedores de sync do rastreamento (T-0156; ADR 0061; desenho `tracking.md` §3.4 e §6). SEM dependência dos de `sync.ts`:
 * - push, só de envio (ADR 0009), `somente_insercao`: `ponto_trajeto`;
 * - pull `ausencia_usuario` (escopo `proprio`: só as do próprio usuário). O parâmetro `rastreamento` vai no pull `parametro` (lista em `sync.ts`).
 * Os pontos nunca voltam ao aparelho.
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { AusenciaUsuarioSchema, ENTIDADE_AUSENCIA_USUARIO, ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema, } from '../contracts';
import { dataLocal } from '../domain';
import { sqlDoPull } from './sync';
import { receberPontosTrajeto } from './trajeto-push';
export const TABELAS_SYNC_TRAJETO = {
    ausencia_usuario: {
        tabela: 'core.ausencia_usuario',
        colunas: "usuario_id, to_char(de, 'YYYY-MM-DD') as de, to_char(ate, 'YYYY-MM-DD') as ate",
        colunaCliente: null,
        colunaUsuario: 'usuario_id',
    },
};
function puxarDe(t, soProprio) {
    return async (ctx, pedido) => {
        const visiveis = soProprio ? new Set([ctx.usuario.id]) : 'tenant';
        const { sql, valores } = sqlDoPull(t, pedido, visiveis, dataLocal(ctx.agora(), ctx.fuso()));
        return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows);
    };
}
const envio = (nome, schema) => definirEntidadeSync({ nome, modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema });
const leitura = (nome, schema) => definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });
export const entidadePontoTrajeto = envio(ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema);
export const entidadeAusenciaUsuario = leitura(ENTIDADE_AUSENCIA_USUARIO, AusenciaUsuarioSchema);
export const provedoresSyncTrajeto = [
    { entidade: entidadePontoTrajeto, receber: receberPontosTrajeto },
    { entidade: entidadeAusenciaUsuario, escopo: 'proprio', puxar: puxarDe(TABELAS_SYNC_TRAJETO.ausencia_usuario, true) },
];
