/**
 * Contrato de `GET /v1/me/modulos` e do erro `MODULO_INATIVO` (RF-CORE-02, RN-CORE-01/02; S0-041, S0-052..056).
 *
 * - A lista é calculada a cada requisição (tenant ∩ perfil − exceções + dependências); NUNCA vem do JWT.
 * - O app compara `versao_licencas` no sync para saber quando desmontar/remontar módulos (RN-CORE-02).
 * - Erros usam o corpo comum da API v1 (`ErroApiSchema` do platform-sdk): `{ codigo, mensagem, detalhes? }`.
 */
import { MODULOS, PerfilDaRequisicaoSchema } from '@macuxi/platform-sdk';
import { z } from 'zod';
export const ModuloIdSchema = z.enum(MODULOS);
/** Um módulo efetivo do usuário. `parametros` são os parâmetros do módulo no tenant (ex.: raio de check-in). */
export const ModuloEfetivoSchema = z
    .object({
    id: ModuloIdSchema,
    /** Versão do manifesto instalado (semver). */
    versao: z.string().regex(/^\d+\.\d+\.\d+$/),
    parametros: z.record(z.unknown()).default({}),
})
    .strict();
export const MeusModulosRespostaSchema = z
    .object({
    /** Em ordem de dependência (core primeiro); sempre contém o `core`. */
    modulos: z.array(ModuloEfetivoSchema).min(1),
    /** Muda quando a licença do usuário muda (tenant, perfil ou exceção); o app usa para detectar desativação. */
    versao_licencas: z.string().min(1),
    /** Instante UTC do cálculo (ISO 8601). */
    calculado_em: z.string(),
    /** T-0111 (aditivo): perfis de acesso do usuário já resolvidos (fábrica + o que a empresa mudou), para o shell decidir telas e ações. Ausente = fábrica. */
    perfis: z.array(PerfilDaRequisicaoSchema).optional(),
})
    .strict()
    .superRefine((r, ctx) => {
    if (!r.modulos.some((m) => m.id === 'core'))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modulos'], message: 'o core está sempre ativo (RN-CORE-01)' });
    const ids = r.modulos.map((m) => m.id);
    if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modulos'], message: 'módulo repetido' });
});
export const ROTA_ME_MODULOS = '/v1/me/modulos';
/** 403 de rota de módulo inativo (tenant, perfil ou usuário — o mesmo código nos três casos, S0-053). */
export const CODIGO_MODULO_INATIVO = 'MODULO_INATIVO';
export const ErroModuloInativoSchema = z
    .object({
    codigo: z.literal(CODIGO_MODULO_INATIVO),
    mensagem: z.string().min(1),
    detalhes: z.object({ modulo: ModuloIdSchema }).passthrough().optional(),
})
    .strict();
export const STATUS_MODULO_INATIVO = 403;
/** Monta o corpo do 403 (mensagem em português com a ação seguinte). */
export function erroModuloInativo(modulo) {
    return {
        codigo: CODIGO_MODULO_INATIVO,
        mensagem: `O módulo ${modulo} não está ativo para você. Fale com o administrador da sua empresa.`,
        detalhes: { modulo },
    };
}
