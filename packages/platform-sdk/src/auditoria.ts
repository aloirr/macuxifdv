/**
 * Leitura da trilha de auditoria (RN-AUD-01; T-0030 D-B29) — rota de plataforma, como `/v1/arquivos`:
 *   GET /v1/auditoria?modulo=&entidade=&limite=&cursor=
 *
 * Quem grava é o módulo, com `tx.auditar` na transação do fato (`plataforma.auditoria`). A leitura:
 *   - perfis do BKO que veem a trilha (`PERFIS_AUDITORIA`); os demais → 403 PERFIL_SEM_ACESSO;
 *   - licença: só linhas de módulos efetivos do usuário AGORA (RN-CORE-01/02); pedir `modulo` inativo → 403 MODULO_INATIVO;
 *   - escopo (RN-CORE-04; ADR 0009 §6): perfis de escopo `tenant` veem tudo; o gerente só o que os usuários visíveis
 *     a ele fizeram (ele + equipes abaixo). Linha sem autor (sistema, Hub) só no escopo `tenant`;
 *   - mais recentes primeiro, paginado por cursor (`ocorrido_em` + `id`), no máximo `LIMITE_AUDITORIA_MAX` por página.
 * O nome do autor vem do Core (`core.cadastro_resumo@1`), nunca de leitura direta de `core.*`.
 */
import { z } from 'zod';
import { MODULOS, type Perfil } from './nomes';

export const ROTA_AUDITORIA = '/v1/auditoria';

/** Perfis do BKO que leem a trilha (igual ao menu "Plataforma → Auditoria" do shell web). */
export const PERFIS_AUDITORIA = ['admin', 'analista', 'assistente', 'gerente'] as const satisfies readonly Perfil[];

export const LIMITE_AUDITORIA_PADRAO = 100;
export const LIMITE_AUDITORIA_MAX = 300;

export const AuditoriaQuerySchema = z
  .object({
    modulo: z.enum(MODULOS).optional(),
    entidade: z.string().trim().min(1).max(60).optional(),
    limite: z.coerce.number().int().min(1).max(LIMITE_AUDITORIA_MAX).default(LIMITE_AUDITORIA_PADRAO),
    cursor: z.string().max(80).optional(),
  })
  .strict();
export type AuditoriaQuery = z.infer<typeof AuditoriaQuerySchema>;

export const LinhaAuditoriaSchema = z.object({
  id: z.string().uuid(),
  modulo: z.enum(MODULOS),
  acao: z.string(),
  entidade: z.string(),
  entidade_id: z.string().uuid().nullable(),
  usuario_id: z.string().uuid().nullable(),
  /** Nome do autor no Core; `null` = sem autor (sistema) ou usuário removido. */
  usuario_nome: z.string().nullable(),
  antes: z.unknown().nullable(),
  depois: z.unknown().nullable(),
  ocorrido_em: z.string().datetime({ offset: true }),
});
export type LinhaAuditoria = z.infer<typeof LinhaAuditoriaSchema>;

export const AuditoriaRespostaSchema = z.object({
  itens: z.array(LinhaAuditoriaSchema),
  /** Passe em `cursor` para a próxima página; `null` = acabou. */
  proximo_cursor: z.string().nullable(),
});
export type AuditoriaResposta = z.infer<typeof AuditoriaRespostaSchema>;

// ---------- cursor (opaco para o cliente: `<ocorrido_em ISO>_<id>`) ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cursorAuditoria(l: { ocorrido_em: string; id: string }): string {
  return `${new Date(l.ocorrido_em).toISOString()}_${l.id.toLowerCase()}`;
}

/** `null` = cursor malformado (a rota responde 400). */
export function lerCursorAuditoria(c: string): { ocorrido_em: string; id: string } | null {
  const i = c.lastIndexOf('_');
  if (i <= 0) return null;
  const quando = c.slice(0, i);
  const id = c.slice(i + 1);
  const t = Date.parse(quando);
  if (!UUID_RE.test(id) || Number.isNaN(t) || new Date(t).toISOString() !== quando) return null;
  return { ocorrido_em: quando, id: id.toLowerCase() };
}

/**
 * Filtro de licença e escopo (RN-AUD-01 + RN-CORE-01/04), puro: quais módulos e quais autores o usuário vê.
 * `usuarios: 'todos'` = escopo tenant (inclui linhas sem autor). `negado` = pediu um módulo que não está ativo para ele.
 */
export function filtroAuditoria(e: {
  efetivos: readonly string[];
  visiveis: ReadonlySet<string> | 'tenant';
  modulo?: string;
}): { negado: false; modulos: string[]; usuarios: 'todos' | string[] } | { negado: true; modulo: string } {
  if (e.modulo && !e.efetivos.includes(e.modulo)) return { negado: true, modulo: e.modulo };
  const modulos = e.modulo ? [e.modulo] : [...e.efetivos];
  const usuarios = e.visiveis === 'tenant' ? ('todos' as const) : [...e.visiveis].map((u) => u.toLowerCase()).sort();
  return { negado: false, modulos, usuarios };
}
