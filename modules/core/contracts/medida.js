/**
 * Medidas do produto (RN-CORE-19; RF-CORE-14). Rotas BKO `/v1/core/medidas` e `PUT /v1/core/produtos/:id/medidas`.
 * Tabela `core.medida` (sigla única no tenant, 1 a 4 letras maiúsculas). Medida não se apaga em uso: inativa-se.
 * Os textos de entrada são tolerantes de propósito: quem valida (e devolve a mensagem em português) é o domínio, na API.
 * A consulta pública `core.medidas@1` está em `consultas.ts` (CONSULTA_MEDIDAS); o pull leva a entidade `medida` (sync.ts).
 */
import { z } from 'zod';
/** Códigos de erro 422 das medidas (a API devolve `ErroRegraNegocio` com estes códigos). */
export const ERROS_MEDIDA = {
    invalida: 'MEDIDA_INVALIDA',
    duplicada: 'MEDIDA_DUPLICADA',
    inativa: 'MEDIDA_INATIVA',
    naoCadastrada: 'MEDIDA_NAO_CADASTRADA',
    emUso: 'MEDIDA_EM_USO',
    embalagemIncompleta: 'EMBALAGEM_INCOMPLETA',
    embalagemInvalida: 'EMBALAGEM_INVALIDA',
    /** A embalagem do produto diverge da unidade de venda que veio do ERP (`core.produto_unidade.fator`). */
    embalagemDivergeErp: 'EMBALAGEM_DIVERGE_ERP',
};
/** Quantidade de unidades da embalagem do produto: inteira de 2 a 9999 (o banco tem o mesmo CHECK; RN-CORE-19, RN-VEN-15). */
export const EMBALAGEM_QUANTIDADE_MIN = 2;
export const EMBALAGEM_QUANTIDADE_MAX = 9999;
export const MedidaSchema = z.object({
    id: z.string().uuid(),
    sigla: z.string(),
    descricao: z.string(),
    ativo: z.boolean(),
    /** Quantos produtos usam a medida (unidade ou embalagem): com uso > 0 não apaga nem troca a sigla; só inativa. */
    em_uso: z.number().int().nonnegative(),
});
export const MedidasListaSchema = z.object({ itens: z.array(MedidaSchema) });
/** Criar: o `id` (UUID) nasce no cliente; repetir o mesmo `id` devolve a medida já criada (escrita idempotente). */
export const MedidaCriarSchema = z.object({
    id: z.string().uuid(),
    sigla: z.string().max(40),
    descricao: z.string().max(200),
});
/** Editar: descrição, sigla (só sem uso) e/ou ativo (inativar e reativar). Ao menos um campo. */
export const MedidaEditarSchema = z
    .object({
    sigla: z.string().max(40).optional(),
    descricao: z.string().max(200).optional(),
    ativo: z.boolean().optional(),
})
    .refine((c) => c.sigla !== undefined || c.descricao !== undefined || c.ativo !== undefined, { message: 'Informe o que mudar: descrição, sigla ou ativo.' });
export const MedidaIdParamSchema = z.object({ id: z.string().uuid() });
/**
 * Medida da unidade e embalagem opcional de um produto (`PUT /v1/core/produtos/:id/medidas`). `unidade` obrigatória;
 * embalagem tudo-ou-nada (medida + quantidade de unidades, inteira > 1). A API só aceita medida cadastrada e ativa no tenant.
 */
export const ProdutoMedidasPutSchema = z.object({
    unidade: z.string().max(40),
    embalagem_medida: z.string().max(40).nullable().optional(),
    // Tolerante de propósito (como os demais textos): quem recusa fora de 2 a 9999 é o domínio, com 422 EMBALAGEM_INVALIDA.
    embalagem_quantidade: z.number().nullable().optional(),
});
