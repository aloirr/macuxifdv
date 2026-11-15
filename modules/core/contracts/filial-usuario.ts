/**
 * Filial do usuário (T-0176; RN-CORE-39 revista, R-20261115-093000 e R-20261115-094500). Aditivo: `core.filiais@1` não muda.
 * - Filial de CADASTRO (`core.usuario.filial_cadastro_id`): obrigatória em qualquer perfil. Nula = usuário BLOQUEADO (`sem_filial`):
 *   o app abre só a tela de bloqueio e as rotas respondem 403 `USUARIO_SEM_FILIAL`.
 * - Filiais de VENDA (`core.usuario_filial`): no mínimo 1, sempre com a de cadastro (marcada "padrão" na tela), sem limite por cargo.
 * - Só admin e analista informam ou trocam a filial dos usuários (`PERFIS_QUE_EDITAM_FILIAL`). Admin/analista sem filial se destrava
 *   pela rota mínima `PUT /v1/core/eu/filial-cadastro`, a única (com o `GET` irmão) liberada para bloqueado.
 */
import { z } from 'zod';

/** Textos provisórios; a simulação aprovada do designer-ux os substitui. */
export const MENSAGEM_FILIAL_CADASTRO_OBRIGATORIA = 'Escolha a filial de cadastro.';
export const MENSAGEM_FILIAL_VENDA_VAZIA = 'Escolha ao menos uma filial de venda.';
export const MENSAGEM_FILIAL_VENDA_SEM_CADASTRO = 'A filial de cadastro precisa estar entre as filiais de venda.';
export const MENSAGEM_FILIAL_INVALIDA = 'Escolha uma filial da lista.';
export const MENSAGEM_SEM_PERMISSAO_FILIAL = 'Só o administrador ou o analista definem a filial do usuário.';
export const MENSAGEM_USUARIO_SEM_FILIAL = 'Seu usuário está sem filial. Peça ao administrador para informar a filial.';
export const MENSAGEM_FILIAL_JA_INFORMADA = 'Sua filial de cadastro já está definida. Peça a troca ao administrador.';

export const CODIGOS_FILIAL_USUARIO = {
  /** 422 — usuário criado/editado sem filial de cadastro (ao editar, só se tentar zerá-la). */
  cadastroObrigatoria: 'USUARIO_FILIAL_CADASTRO_OBRIGATORIA',
  /** 422 — lista de venda vazia (a API já inclui a de cadastro; só aparece sem cadastro). */
  vendaVazia: 'USUARIO_FILIAL_VENDA_VAZIA',
  /** 422 — a lista de venda não contém a de cadastro (banco: 23514 `usuario_filial_inclui_cadastro`, checado no COMMIT). */
  vendaSemCadastro: 'USUARIO_FILIAL_VENDA_SEM_CADASTRO',
  /** 422 — filial inexistente, excluída ou de outro tenant. */
  invalida: 'USUARIO_FILIAL_INVALIDA',
  /** 403 — quem não é admin nem analista tentou informar filial. */
  semPermissao: 'USUARIO_FILIAL_SEM_PERMISSAO',
  /** 403 — usuário sem filial de cadastro (qualquer perfil) em rota de dados. */
  semFilial: 'USUARIO_SEM_FILIAL',
  /** 409 — `PUT eu/filial-cadastro` só serve a quem está bloqueado. */
  jaInformada: 'USUARIO_FILIAL_JA_INFORMADA',
  /** Carga do ERP: filial_external_id sem filial no tenant (erro registrado, sem dado pessoal). */
  inexistenteNaCarga: 'FILIAL_INEXISTENTE',
} as const;

/** Perfis (base) que editam a filial do usuário. */
/** Ação do catálogo (manifesto do Core; ADR 0033): informar/trocar a filial de cadastro e de venda, a própria (destravamento) ou a de outro usuário. */
export const ACAO_FILIAL_USUARIO_EDITAR = 'usuario.filial_editar';
export const PERFIS_QUE_EDITAM_FILIAL = ['admin', 'analista'] as const;

const Id = z.string().uuid();
/** `filial_venda_ids`: uuids; a API deduplica e inclui a de cadastro. */
export const FilialVendaIdsSchema = z.array(Id).max(200);
export type FilialVendaIds = z.infer<typeof FilialVendaIdsSchema>;

/** Estado de filial do usuário (leitura). */
export const FilialDoUsuarioSchema = z.object({ filial_cadastro_id: Id.nullable(), filial_venda_ids: z.array(Id), sem_filial: z.boolean() });
export type FilialDoUsuario = z.infer<typeof FilialDoUsuarioSchema>;

/** `PUT /v1/core/eu/filial-cadastro`: o admin/analista bloqueado informa a PRÓPRIA filial de cadastro. */
export const InformarFilialCadastroRequestSchema = z.object({ filial_cadastro_id: Id }).strict();
export type InformarFilialCadastroRequest = z.infer<typeof InformarFilialCadastroRequestSchema>;

/** `GET /v1/core/eu/filial-cadastro`: estado do próprio usuário e, só para quem pode informar, as filiais para escolher. */
export const MinhaFilialCadastroSchema = FilialDoUsuarioSchema.extend({
  pode_informar: z.boolean(),
  filiais: z.array(z.object({ id: Id, codigo: z.string(), nome: z.string() })),
});
export type MinhaFilialCadastro = z.infer<typeof MinhaFilialCadastroSchema>;
