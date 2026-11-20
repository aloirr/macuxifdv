/**
 * Consulta `gestor.membros_da_equipe@1` (ADR 0012; T-0187 §1.4, RN-VEN-35): quem está no escopo de quem está logado no
 * aparelho (RN-CORE-04: supervisor = a equipe; gerente = as equipes abaixo), para o Vendedor montar "Em nome de".
 * Só no aparelho: lê o cache da visão da equipe, sem rede e sem dado pessoal novo. O próprio usuário não sai na lista.
 * Sem cache (ou módulo inativo) a lista vem vazia. A equipe é identificada pelo líder (`equipe_id` = id do superior direto).
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { PerfilContrato, Uuid } from './base';

export const MembroDaEquipeSchema = z
  .object({
    usuario_id: Uuid,
    nome: z.string().min(1).max(200),
    perfil: PerfilContrato,
    /** Líder da equipe (superior direto); `null` = sem superior no cadastro. */
    equipe_id: Uuid.nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type MembroDaEquipe = z.infer<typeof MembroDaEquipeSchema>;

export const EquipeDaListaSchema = z.object({ equipe_id: Uuid, nome: z.string().min(1).max(200) }).strict();
export type EquipeDaLista = z.infer<typeof EquipeDaListaSchema>;

export const MembrosDaEquipeEntradaSchema = z.object({}).strict();
export const MembrosDaEquipeSaidaSchema = z.object({ membros: z.array(MembroDaEquipeSchema), equipes: z.array(EquipeDaListaSchema) }).strict();
export type MembrosDaEquipe = z.infer<typeof MembrosDaEquipeSaidaSchema>;

export const CONSULTA_MEMBROS_DA_EQUIPE = definirConsulta({
  nome: 'gestor.membros_da_equipe@1',
  entrada: MembrosDaEquipeEntradaSchema,
  saida: MembrosDaEquipeSaidaSchema,
});
