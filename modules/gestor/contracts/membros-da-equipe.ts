/**
 * Lista de membros no escopo de quem está logado (RN-CORE-04: supervisor = a equipe; gerente = as equipes abaixo), no
 * formato que o Gestor entrega aos slots de outros módulos (pedido em nome, RN-VEN-35). Montada no aparelho a partir da
 * visão em cache, sem dado pessoal novo. A equipe é identificada pelo líder (`equipe_id` = id do superior direto).
 */
import { z } from 'zod';
import { PerfilContrato, Uuid } from './base';

export const MembroDaEquipeSchema = z
  .object({
    usuario_id: Uuid,
    nome: z.string().min(1).max(200),
    perfil: PerfilContrato,
    /** Líder da equipe (superior direto); `null` = sem superior no cadastro. */
    equipe_id: Uuid.nullable(),
    equipe_nome: z.string().min(1).max(200),
    ativo: z.boolean(),
  })
  .strict();
export type MembroDaEquipe = z.infer<typeof MembroDaEquipeSchema>;
