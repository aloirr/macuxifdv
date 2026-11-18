/**
 * Administração de licenças de módulo (RF-CORE-02; painel Módulos do BKO). Só `admin`
 * (ação `modulo.gerir_licencas`); a API revalida. Três níveis: tenant → perfil → usuário (RN-CORE-01).
 *
 * - `GET /v1/core/licencas` — estado completo (módulos, tenant, perfis, usuários com exceções).
 * - `PUT /v1/core/licencas/tenant/:modulo` { ativo }
 * - `PUT /v1/core/licencas/perfis/:perfil/:modulo` { ativo }
 * - `PUT /v1/core/licencas/usuarios/:id/:modulo` { ativo } — exceção do usuário: só REMOVE (ativo=false remove).
 * - `GET /v1/core/licencas/usuarios/:id/efetivos` — módulos efetivos do usuário, para a lista de conferência.
 * O `core` nunca desliga (422 `RN-CORE-01`). Cada mudança publica `core.usuario.modulos_alterados@1`.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { ModuloIdSchema } from './modulos';

export const LicencasEstadoSchema = z
  .object({
    /** Módulos instalados, em ordem de dependência. */
    modulos: z.array(ModuloIdSchema),
    /** Módulo → módulos de que ele depende (RN-CORE-03): desligar um desliga os dependentes. */
    dependencias: z.record(z.array(ModuloIdSchema)).default({}),
    /** Ativo no tenant. */
    tenant: z.record(z.boolean()),
    /** Perfil → módulos ligados no padrão do perfil. */
    perfis: z.record(z.array(ModuloIdSchema)),
    usuarios: z.array(
      z.object({
        id: z.string().uuid(),
        nome: z.string(),
        email: z.string(),
        perfil: PerfilSchema,
        /** Exceções (módulos removidos só deste usuário). */
        removidos: z.array(ModuloIdSchema),
      }),
    ),
  })
  .strict();
export type LicencasEstado = z.infer<typeof LicencasEstadoSchema>;

export const AlterarLicencaRequestSchema = z.object({ ativo: z.boolean() }).strict();
export type AlterarLicencaRequest = z.infer<typeof AlterarLicencaRequestSchema>;

export const EfetivosDoUsuarioRespostaSchema = z.object({ usuario_id: z.string().uuid(), modulos: z.array(ModuloIdSchema) }).strict();
export type EfetivosDoUsuarioResposta = z.infer<typeof EfetivosDoUsuarioRespostaSchema>;

export const NIVEIS_LICENCA = ['tenant', 'perfil', 'usuario'] as const;
export type NivelLicenca = (typeof NIVEIS_LICENCA)[number];

/** Payload de `core.usuario.modulos_alterados@1`. */
export const ModulosAlteradosSchema = z
  .object({
    nivel: z.enum(NIVEIS_LICENCA),
    modulo: ModuloIdSchema,
    ativo: z.boolean(),
    perfil: PerfilSchema.nullable(),
    usuario_id: z.string().uuid().nullable(),
  })
  .strict();
export type ModulosAlterados = z.infer<typeof ModulosAlteradosSchema>;
