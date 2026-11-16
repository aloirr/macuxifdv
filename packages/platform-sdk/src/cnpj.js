/**
 * Consulta de CNPJ na base pública da Receita Federal (ADR 0048; pedido do dono do produto, R-20261114-132600-alexandre):
 * no passo Empresa do portal `config.`, o CNPJ digitado preenche razão social, endereço, situação e CNAE.
 *   POST /v1/plataforma/cnpj  { cnpj }  (super-admin ou admin do cliente)
 * POST, e não GET com o CNPJ na URL, para o número não cair no log de acesso. Fonte grátis: BrasilAPI; reserva: CNPJá
 * (API aberta). Sem sócios/QSA (dado pessoal): a resposta é `.strict()` e só traz o que o cadastro da empresa usa.
 */
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { z } from 'zod';
export const ROTA_PORTAL_CNPJ = '/v1/plataforma/cnpj';
/** Erros da consulta (corpo `ErroApi`). */
export const CODIGOS_CNPJ = {
    /** 400: dígitos errados; a fonte nem é chamada. */
    invalido: 'CNPJ_INVALIDO',
    /** 404: a Receita não tem esse CNPJ (nas duas fontes). */
    naoEncontrado: 'CNPJ_NAO_ENCONTRADO',
    /** 503: as duas fontes fora (prazo, 5xx, 429, rede ou resposta fora do formato). */
    fonteFora: 'CNPJ_FONTE_FORA',
    /** 429 com `Retry-After`: consultas demais da mesma sessão do portal. */
    limite: 'CNPJ_LIMITE',
    /** 422 no `POST /v1/plataforma/empresas`: situação na Receita diferente de ATIVA (R-20261114-144000, item 3). */
    inativo: 'CNPJ_INATIVO',
};
/** Consultas por sessão do portal por minuto. */
export const CONSULTAS_CNPJ_POR_MINUTO = 20;
export const SITUACOES_CADASTRAIS = ['ativa', 'suspensa', 'inapta', 'baixada', 'nula'];
/**
 * "CNPJ inválido não se cria empresa" (dono do produto, R-20261114-144000, item 3): o passo Empresa só cria com o CNPJ
 * ATIVO na Receita. Dígito errado, não encontrado, situação baixada/suspensa/inapta/nula ou a Receita fora = não cria.
 */
export function situacaoCriaEmpresa(s) {
    return s === 'ativa';
}
export const FONTES_CNPJ = ['brasilapi', 'cnpja'];
/** Com ou sem máscara; sai só com os 14 dígitos. */
export const ConsultaCnpjPedidoSchema = z
    .object({
    cnpj: z
        .string()
        .max(30)
        .transform((v) => somenteDigitos(v))
        .refine(cnpjValido, 'CNPJ inválido: confira os dígitos.'),
})
    .strict();
const Texto = z.string().min(1).max(500);
const TextoOuNulo = Texto.nullable();
export const ConsultaCnpjRespostaSchema = z
    .object({
    cnpj: z.string().regex(/^\d{14}$/),
    razao_social: Texto,
    nome_fantasia: TextoOuNulo,
    endereco: z
        .object({ logradouro: TextoOuNulo, numero: TextoOuNulo, complemento: TextoOuNulo, bairro: TextoOuNulo })
        .strict(),
    municipio: TextoOuNulo,
    /** Nula só para sede no exterior (ou UF fora da lista). */
    uf: z.enum(UFS_BRASIL).nullable(),
    cep: z.string().regex(/^\d{8}$/).nullable(),
    situacao_cadastral: z.enum(SITUACOES_CADASTRAIS),
    cnae_principal: z.object({ codigo: z.string().regex(/^\d{7}$/), descricao: Texto }).strict().nullable(),
    /** O primeiro telefone, só dígitos com DDD (10 ou 11). */
    telefone: z.string().regex(/^\d{10,11}$/).nullable(),
    email: z.string().max(254).email().nullable(),
    fonte: z.enum(FONTES_CNPJ),
})
    .strict();
