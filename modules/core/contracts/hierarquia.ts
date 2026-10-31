/**
 * Hierarquia da equipe (RF-CORE-02; RN-CORE-04): árvore gerente → supervisor → vendedor/promotor, derivada de
 * `core.equipe` (responsável e equipe-pai) e `core.usuario.equipe_id`. É o contrato que o Gestor usa para o escopo
 * (`GET /v1/core/equipe/hierarquia`). Mesmos nomes de campo do `MembroEquipe` do Gestor, para ele parsear sem tradução.
 * Cada usuário enxerga só a sua subárvore: `superior_id` fora dela vem `null` (não revela quem está acima).
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';

export const MembroHierarquiaSchema = z
  .object({
    id: z.string().uuid(),
    nome: z.string().min(1).max(200),
    perfil: PerfilSchema,
    /** Superior direto (responsável pela equipe do membro; o responsável sobe para o responsável da equipe-pai); `null` = topo. */
    superior_id: z.string().uuid().nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type MembroHierarquia = z.infer<typeof MembroHierarquiaSchema>;

export const HierarquiaEquipeSchema = z.object({ membros: z.array(MembroHierarquiaSchema) }).strict();
export type HierarquiaEquipe = z.infer<typeof HierarquiaEquipeSchema>;

export const ROTA_HIERARQUIA = '/v1/core/equipe/hierarquia';
