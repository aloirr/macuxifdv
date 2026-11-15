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
/** plataforma.parametro (core, 'cliente.campos_obrigatorios'); sem `documento` o domain acrescenta. */
export const PARAMETRO_CAMPOS_OBRIGATORIOS = 'cliente.campos_obrigatorios';
export const ParametroCamposObrigatorios = z.array(CampoCadastroCliente).min(1).max(CAMPOS_CADASTRO_CLIENTE.length);
