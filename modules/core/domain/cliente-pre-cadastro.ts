/**
 * RN-CORE-78 e RN-CORE-79: pré-cadastro de cliente (o FDV só pré-cadastra; o ERP aprova). Funções puras; a API revalida.
 * Razão social e CPF/CNPJ são sempre obrigatórios; a empresa marca os demais em Parâmetros.
 */
import {
  CAMPOS_PRE_CADASTRO_CONFIGURAVEIS,
  CAMPOS_PRE_CADASTRO_SEMPRE,
  COLUNAS_DO_CAMPO_PRE_CADASTRO,
  type CampoPreCadastro,
  type CampoPreCadastroConfiguravel,
  type StatusCadastro,
} from '../contracts/cliente-pre-cadastro';

export type DadosPreCadastro = Readonly<Record<string, string | number | null | undefined>>;

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Campos obrigatórios que faltam (sempre os dois travados + os configurados), na ordem de `CAMPOS_PRE_CADASTRO_*`.
 * `endereco` falta se qualquer coluna do grupo (logradouro, número, bairro, cidade, UF, CEP) estiver vazia.
 */
export function camposFaltantesPreCadastro(dados: DadosPreCadastro, obrigatorios: readonly CampoPreCadastroConfiguravel[]): CampoPreCadastro[] {
  const exigidos = new Set<CampoPreCadastro>([...CAMPOS_PRE_CADASTRO_SEMPRE, ...obrigatorios]);
  const ordem: CampoPreCadastro[] = [...CAMPOS_PRE_CADASTRO_SEMPRE, ...CAMPOS_PRE_CADASTRO_CONFIGURAVEIS];
  return ordem.filter((campo) => exigidos.has(campo) && COLUNAS_DO_CAMPO_PRE_CADASTRO[campo].some((coluna) => vazio(dados[coluna])));
}

/** Motivo da recusa do ERP guardado até 500 caracteres (RN-CORE-78); vazio vira nulo. */
export const MOTIVO_RECUSA_MAX = 500;
export function motivoRecusaCortado(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim();
  return m === '' ? null : m.slice(0, MOTIVO_RECUSA_MAX);
}

/**
 * Reenvio após recusa (RN-CORE-78): ao procurar o documento, cliente 'recusado' não bloqueia; os recusados vivos com o mesmo documento
 * saem (deleted_at, na mesma transação) e o novo segue. Pendente, aprovado ou sem situação (legado) bloqueia com 409.
 */
export function decidirDocumentoDuplicado(iguais: readonly { id: string; status_cadastro: StatusCadastro | null }[]): { bloqueia: boolean; remover: string[] } {
  const bloqueia = iguais.some((c) => c.status_cadastro !== 'recusado');
  return { bloqueia, remover: bloqueia ? [] : iguais.map((c) => c.id) };
}

/** O motivo da recusa do ERP só vai ao vendedor (RN-CORE-78); os demais perfis recebem nulo. */
export function motivoRecusaVisivel(perfil: string, motivo: string | null | undefined): string | null {
  return perfil === 'vendedor' ? (motivo ?? null) : null;
}
