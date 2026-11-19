/**
 * Provedores de sync do rastreamento (T-0156; ADR 0061; desenho `tracking.md` §3.4 e §6). SEM dependência dos de `sync.ts`:
 * - push, só de envio (ADR 0009), `somente_insercao`: `aceite_termo_rastreamento` (antes dos pontos), `ponto_trajeto` e `pausa_trajeto`;
 * - pull `termo_rastreamento` (escopo tenant; vigente = a maior versão; as removidas vão junto) e `ausencia_usuario` (escopo `proprio`:
 *   só as do próprio usuário). O parâmetro `rastreamento` vai no pull `parametro` (lista em `sync.ts`).
 * Os pontos nunca voltam ao aparelho.
 */
import { definirEntidadeSync, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import {
  AceiteTermoRastreamentoSchema,
  AusenciaUsuarioSchema,
  ENTIDADE_ACEITE_TERMO_RASTREAMENTO,
  ENTIDADE_AUSENCIA_USUARIO,
  ENTIDADE_PAUSA_TRAJETO,
  ENTIDADE_PONTO_TRAJETO,
  ENTIDADE_TERMO_RASTREAMENTO,
  PausaTrajetoSchema,
  PontoTrajetoSchema,
  TermoRastreamentoSchema,
} from '../contracts';
import { dataLocal } from '../domain';
import { sqlDoPull, type Tabela } from './sync';
import { receberAceitesTermo, receberPausasTrajeto, receberPontosTrajeto } from './trajeto-push';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

export const TABELAS_SYNC_TRAJETO = {
  termo_rastreamento: {
    tabela: 'core.termo_rastreamento',
    colunas: `versao, texto, to_char(publicado_em at time zone 'UTC', ${UTC}) as publicado_em`,
    colunaCliente: null,
  },
  ausencia_usuario: {
    tabela: 'core.ausencia_usuario',
    colunas: "usuario_id, to_char(de, 'YYYY-MM-DD') as de, to_char(ate, 'YYYY-MM-DD') as ate",
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
  },
} as const satisfies Record<string, Tabela>;

function puxarDe(t: Tabela, soProprio: boolean) {
  return async (ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> => {
    const visiveis = soProprio ? new Set([ctx.usuario.id]) : ('tenant' as const);
    const { sql, valores } = sqlDoPull(t, pedido, visiveis, dataLocal(ctx.agora(), ctx.fuso()));
    return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as unknown as LinhaSync[]);
  };
}

const envio = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) => definirEntidadeSync({ nome, modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema });
const leitura = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) => definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });

export const entidadeAceiteTermo = envio(ENTIDADE_ACEITE_TERMO_RASTREAMENTO, AceiteTermoRastreamentoSchema);
export const entidadePontoTrajeto = envio(ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema);
export const entidadePausaTrajeto = envio(ENTIDADE_PAUSA_TRAJETO, PausaTrajetoSchema);
export const entidadeTermoRastreamento = leitura(ENTIDADE_TERMO_RASTREAMENTO, TermoRastreamentoSchema);
export const entidadeAusenciaUsuario = leitura(ENTIDADE_AUSENCIA_USUARIO, AusenciaUsuarioSchema);

export const provedoresSyncTrajeto: readonly ProvedorSync[] = [
  { entidade: entidadeAceiteTermo, receber: receberAceitesTermo },
  { entidade: entidadePontoTrajeto, receber: receberPontosTrajeto },
  { entidade: entidadePausaTrajeto, receber: receberPausasTrajeto },
  { entidade: entidadeTermoRastreamento, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC_TRAJETO.termo_rastreamento, false) },
  { entidade: entidadeAusenciaUsuario, escopo: 'proprio', puxar: puxarDe(TABELAS_SYNC_TRAJETO.ausencia_usuario, true) },
];
