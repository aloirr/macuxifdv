/** Equipe do Gestor (RF-GES-01, RN-CORE-04): árvore gerente → supervisor → vendedor/promotor, vinda do Core. */
import { z } from 'zod';
import { PerfilContrato, Uuid } from './base';

export const MembroEquipe = z
  .object({
    id: Uuid,
    nome: z.string().min(1).max(200),
    perfil: PerfilContrato,
    /** Superior direto (supervisor do vendedor, gerente do supervisor); `null` = topo. */
    superior_id: Uuid.nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type MembroEquipe = z.infer<typeof MembroEquipe>;
