/**
 * Peças compartilhadas das rotas do BKO da Integração (`/v1/integracao/*`): leitura e montagem do `ConectorResumo`, política de
 * versão do tenant e conversões de linha do Postgres. SQL só no schema `integracao`.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { ConectorResumo, Entidade, PoliticaVersaoConector } from '../contracts';
import { avaliarSaudeConector, avaliarVersaoConector, politicaEfetiva } from '../domain';

export const iso = (v: Date | string | null | undefined): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export interface LinhaConector {
  id: string;
  identificador: string;
  nome: string;
  tipo: 'conector' | 'nuvem' | 'arquivo';
  ativo: boolean;
  recebe_pedidos: boolean;
  aceita_cancelamento: boolean;
  entidades: Entidade[];
  ips_permitidos: string[];
  versao_conector: string | null;
  parado_por_versao: boolean;
  ultimo_sinal_em: Date | null;
  created_at: Date;
}

export const COLUNAS_CONECTOR = `id, identificador, nome, tipo, ativo, recebe_pedidos, aceita_cancelamento, entidades, ips_permitidos::text[] as ips_permitidos,
  versao_conector, parado_por_versao, ultimo_sinal_em, created_at`;

/** RN-INT-11: o tenant tem algum Conector ativo que recebe pedidos (então vale o piso 1.2.1). */
export async function tenantRecebePedidos(db: ClienteBanco, tenantId: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>(
    'select exists (select 1 from integracao.conector where tenant_id = $1 and ativo and recebe_pedidos and deleted_at is null) as existe',
    [tenantId],
  );
  return rows[0]?.existe === true;
}

export async function lerPolitica(db: ClienteBanco, tenantId: string): Promise<PoliticaVersaoConector | null> {
  const { rows } = await db.query<{ versao_minima: string; versao_recomendada: string; mensagem: string | null; pacote: PoliticaVersaoConector['pacote'] | null }>(
    'select versao_minima, versao_recomendada, mensagem, pacote from integracao.politica_versao where tenant_id = $1 and deleted_at is null',
    [tenantId],
  );
  const p = rows[0];
  return p ? { versao_minima: p.versao_minima, versao_recomendada: p.versao_recomendada, mensagem: p.mensagem, pacote: p.pacote } : null;
}

interface LinhaChave {
  conector_id: string;
  papel: 'atual' | 'anterior';
  prefixo: string;
  created_at: Date;
  expira_em: Date | null;
  anterior_valida_ate: Date | null;
}

/** Chaves não revogadas dos Conectores indicados (a atual e, na convivência, a anterior). */
export async function lerChaves(db: ClienteBanco, tenantId: string, conectores: readonly string[]): Promise<Map<string, { atual?: LinhaChave; anterior?: LinhaChave }>> {
  const mapa = new Map<string, { atual?: LinhaChave; anterior?: LinhaChave }>();
  if (conectores.length === 0) return mapa;
  const { rows } = await db.query<LinhaChave>(
    `select conector_id, papel, prefixo, created_at, expira_em, anterior_valida_ate
       from integracao.credencial where tenant_id = $1 and conector_id = any($2::uuid[]) and revogada_em is null and deleted_at is null`,
    [tenantId, conectores],
  );
  for (const c of rows) {
    const e = mapa.get(c.conector_id) ?? {};
    e[c.papel] = c;
    mapa.set(c.conector_id, e);
  }
  return mapa;
}

export function montarResumo(
  c: LinhaConector,
  chaves: { atual?: LinhaChave; anterior?: LinhaChave } | undefined,
  /** A política GRAVADA pela empresa (ou `null`); a que vale para este Conector sai de `politicaEfetiva` (RN-INT-11: piso 1.2.1 se recebe pedidos). */
  politicaGravada: PoliticaVersaoConector | null,
  agora: string,
): ConectorResumo {
  const situacao = avaliarVersaoConector(c.versao_conector, politicaEfetiva(politicaGravada, c.recebe_pedidos)).situacao;
  const atual = chaves?.atual;
  const anterior = chaves?.anterior;
  return {
    id: c.id,
    conector_id: c.identificador,
    nome: c.nome,
    tipo: c.tipo,
    ativo: c.ativo,
    recebe_pedidos: c.recebe_pedidos,
    aceita_cancelamento: c.aceita_cancelamento,
    entidades: c.entidades,
    ips_permitidos: c.ips_permitidos.map((ip) => ip.replace(/\/(32|128)$/, '')),
    versao_conector: c.versao_conector,
    situacao_versao: situacao,
    ultimo_sinal_em: iso(c.ultimo_sinal_em),
    saude: avaliarSaudeConector({ ativo: c.ativo, ultimo_sinal_em: iso(c.ultimo_sinal_em), parado_por_versao: c.parado_por_versao }, agora),
    chave: atual
      ? {
          prefixo: atual.prefixo,
          criada_em: iso(atual.created_at) as string,
          anterior_prefixo: anterior?.prefixo ?? null,
          anterior_valida_ate: iso(anterior?.anterior_valida_ate),
          expira_em: iso(atual.expira_em),
        }
      : null,
    criado_em: iso(c.created_at) as string,
  };
}
