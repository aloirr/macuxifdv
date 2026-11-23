/**
 * RN-CORE-78 e RN-CORE-79: pré-cadastro de cliente (o FDV só pré-cadastra; o ERP aprova). Funções puras; a API revalida.
 * Razão social e CPF/CNPJ são sempre obrigatórios; a empresa marca os demais em Parâmetros.
 */
import {
  CAMPOS_PRE_CADASTRO_SEMPRE,
  COLUNAS_DO_CAMPO_PRE_CADASTRO,
  type CampoPreCadastro,
  type CampoPreCadastroConfiguravel,
} from '../contracts/cliente-pre-cadastro';

export type DadosPreCadastro = Readonly<Record<string, string | number | null | undefined>>;

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Campos obrigatórios que faltam (sempre os dois travados + os configurados), na ordem de `CAMPOS_PRE_CADASTRO_*`.
 * `endereco` falta se qualquer coluna do grupo (logradouro, número, bairro, cidade, UF, CEP) estiver vazia.
 */
export function camposFaltantesPreCadastro(dados: DadosPreCadastro, obrigatorios: readonly CampoPreCadastroConfiguravel[]): CampoPreCadastro[] {
  const exigidos = new Set<CampoPreCadastro>([...CAMPOS_PRE_CADASTRO_SEMPRE, ...obrigatorios]);
  const ordem: CampoPreCadastro[] = [...CAMPOS_PRE_CADASTRO_SEMPRE, 'nome_fantasia', 'inscricao_estadual', 'telefone', 'email', 'endereco'];
  return ordem.filter((campo) => exigidos.has(campo) && COLUNAS_DO_CAMPO_PRE_CADASTRO[campo].some((coluna) => vazio(dados[coluna])));
}

/** Motivo da recusa do ERP guardado até 500 caracteres (RN-CORE-78); vazio vira nulo. */
export const MOTIVO_RECUSA_MAX = 500;
export function motivoRecusaCortado(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim();
  return m === '' ? null : m.slice(0, MOTIVO_RECUSA_MAX);
}
