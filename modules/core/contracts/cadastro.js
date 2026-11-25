/**
 * Cadastro mínimo do cliente (RN-CORE-16/17; T-0060, desenho docs/desenho/T-0060.md §2.1). Fonte única da lista de
 * campos: o domain (`domain/cadastro.ts`) reexporta daqui; a integração e o Vendedor leem pela consulta
 * `core.cadastro_resumo@1`/`core.cadastro_cliente@1`.
 */
import { z } from 'zod';
export const CAMPOS_CADASTRO_CLIENTE = [
    'razao_social',
    'documento',
    'inscricao_estadual',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'cep',
    // extras que o tenant pode exigir
    'nome_fantasia',
    'telefone',
    'email',
    'complemento',
    'geolocalizacao',
];
export const CampoCadastroCliente = z.enum(CAMPOS_CADASTRO_CLIENTE);
/** Padrão do doc 03 (RN-CORE-16). `inscricao_estadual` só vale para CNPJ ("ISENTO" conta como preenchida). */
export const CAMPOS_CADASTRO_PADRAO = [
    'razao_social',
    'documento',
    'inscricao_estadual',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'cep',
];
/** Sempre obrigatórios (RN-CORE-16 e RN-CORE-79): o tenant não pode tirá-los, nem do cadastro nem do pré-cadastro. */
export const CAMPOS_CADASTRO_FIXOS = ['razao_social', 'documento'];
/**
 * plataforma.parametro (core, 'cliente.campos_obrigatorios'); sem os fixos o domain acrescenta. Lista única do cadastro e do
 * pré-cadastro desde a v1.0.30 (ADR 0069).
 */
export const PARAMETRO_CAMPOS_OBRIGATORIOS = 'cliente.campos_obrigatorios';
export const ParametroCamposObrigatorios = z.array(CampoCadastroCliente).min(1).max(CAMPOS_CADASTRO_CLIENTE.length);
/**
 * `GET|PUT /v1/core/parametros/campos-obrigatorios` (Parâmetros › Clientes, RN-CORE-16/79). O GET devolve a lista efetiva, já com
 * os fixos; o PUT aceita sem eles e o servidor acrescenta.
 */
export const ParametroCamposObrigatoriosClienteSchema = z
    .object({
    obrigatorios: z
        .array(CampoCadastroCliente)
        .max(CAMPOS_CADASTRO_CLIENTE.length)
        .refine((v) => new Set(v).size === v.length, 'Campo repetido na lista de obrigatórios.'),
})
    .strict();
