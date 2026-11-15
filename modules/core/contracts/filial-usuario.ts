/**
 * Filial do usuário (T-0176; RN-CORE-39 revista, R-20261115-073000 e R-20261115-080000). Aditivo: `core.filiais@1` não muda.
 * - Vendedor: exatamente UMA filial. Supervisor, promotor e gerente: UMA OU MAIS. Admin e analista (cargo administrativo): opcional.
 * - Vendedor sem filial (carga do ERP, cadastro antigo) existe, mas fica BLOQUEADO no app até a filial ser informada.
 * - Só admin e analista informam ou trocam a filial (`PERFIS_QUE_EDITAM_FILIAL`); a API revalida e responde 422/403.
 * Dados: `core.usuario_filial` (migração 0077). Nomes novos: `FilialIdsSchema` (`filial_ids` em criar, editar e na leitura),
 * `filial_id` e `sem_filial` no sync `usuario` e `sem_filial` na sessão do login.
 */
import { z } from 'zod';

/** Textos provisórios; a simulação aprovada do designer-ux os substitui. */
export const MENSAGEM_FILIAL_DO_VENDEDOR = 'Escolha a filial do vendedor.';
export const MENSAGEM_AO_MENOS_UMA_FILIAL = 'Escolha ao menos uma filial.';
export const MENSAGEM_FILIAL_INVALIDA = 'Escolha uma filial da lista.';
export const MENSAGEM_SEM_PERMISSAO_FILIAL = 'Só o administrador ou o analista definem a filial do usuário.';

export const CODIGOS_FILIAL_USUARIO = {
  /** 422 — a quantidade de filiais não bate com o cargo (vendedor 1; supervisor, promotor e gerente 1 ou mais). */
  quantidade: 'USUARIO_FILIAL_QUANTIDADE',
  /** 422 — filial inexistente, excluída ou de outro tenant. */
  invalida: 'USUARIO_FILIAL_INVALIDA',
  /** 403 — quem não é admin nem analista tentou informar `filial_ids`. */
  semPermissao: 'USUARIO_FILIAL_SEM_PERMISSAO',
} as const;

/** Perfis (base) que editam a filial do usuário. */
export const PERFIS_QUE_EDITAM_FILIAL = ['admin', 'analista'] as const;

/** `filial_ids` do usuário: uuids; a API deduplica. */
export const FilialIdsSchema = z.array(z.string().uuid()).max(200);
export type FilialIds = z.infer<typeof FilialIdsSchema>;
