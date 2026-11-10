/**
 * Filial (RN-CORE-39; T-0149; ADR 0040). Funções puras, sem banco.
 * - A empresa nasce com uma filial padrão; cada cliente tem uma filial (sem informação, a padrão).
 * - Cadastro (BKO): código (1 a 20, único entre as vivas), nome (1 a 80), cidade (1 a 80) e UF válida.
 * - A padrão não é inativada nem apagada; filial com cliente ativo não é inativada.
 * - Cliente que veio do ERP (`external_id`) tem a filial do ERP: o BKO não a troca.
 */
import { ehUf } from '@macuxi/comum/endereco';

export const CODIGO_FILIAL_MAX = 20;
export const NOME_FILIAL_MAX = 80;
export const CIDADE_FILIAL_MAX = 80;

export interface FilialLike {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  padrao: boolean;
  ativo: boolean;
}

export type CodigoErroFilial = 'FILIAL_INVALIDA' | 'FILIAL_DUPLICADA' | 'FILIAL_PADRAO' | 'FILIAL_EM_USO';
export interface ErroDeFilial {
  ok: false;
  codigo: CodigoErroFilial;
  mensagem: string;
}
const erro = (codigo: CodigoErroFilial, mensagem: string): ErroDeFilial => ({ ok: false, codigo, mensagem });

/** RN-CORE-39: filial do cliente viva e ativa vale; nula, apagada (fora da lista) ou inativa cai na padrão. Sempre devolve uma filial. */
export function filialEfetiva<F extends Pick<FilialLike, 'id' | 'padrao' | 'ativo'>>(filialIdDoCliente: string | null | undefined, filiais: readonly F[]): F {
  const propria = filialIdDoCliente ? filiais.find((f) => f.id === filialIdDoCliente && f.ativo) : undefined;
  if (propria) return propria;
  const padrao = filiais.find((f) => f.padrao);
  if (!padrao) throw new Error('RN-CORE-39: o tenant não tem filial padrão.');
  return padrao;
}

/** RN-CORE-39: cliente com `external_id` veio do ERP e a filial dele vem do ERP; sem `external_id` o BKO edita. */
export function podeEditarFilialDoCliente(cliente: { external_id: string | null | undefined }): boolean {
  return !cliente.external_id;
}

/** RN-CORE-39: "0002 · Boa Vista/RR"; sem cidade, "0001 · Filial padrão". */
export function rotuloDaFilial(f: Pick<FilialLike, 'codigo' | 'nome' | 'cidade' | 'uf'>): string {
  const lugar = f.cidade ? (f.uf ? `${f.cidade}/${f.uf}` : f.cidade) : f.nome;
  return `${f.codigo} · ${lugar}`;
}

/**
 * RN-CORE-39: valida o cadastro da filial no BKO. `nova.id` igual ao de uma existente = edição dela (não conta como duplicada).
 * `clientesAtivos` é a contagem de clientes ativos que apontam para a filial (inativar com cliente ativo é recusado).
 */
export function validarFilial(
  nova: { id: string; codigo: string; nome: string; cidade: string | null | undefined; uf: string | null | undefined; ativo?: boolean },
  existentes: readonly FilialLike[],
  opcoes: { clientesAtivos?: number } = {},
): { ok: true; filial: { codigo: string; nome: string; cidade: string; uf: string; ativo: boolean } } | ErroDeFilial {
  const codigo = (nova.codigo ?? '').trim();
  const nome = (nova.nome ?? '').trim();
  const cidade = (nova.cidade ?? '').trim();
  const uf = (nova.uf ?? '').trim().toUpperCase();
  if (codigo === '' || codigo.length > CODIGO_FILIAL_MAX) return erro('FILIAL_INVALIDA', `Informe o código da filial, com até ${CODIGO_FILIAL_MAX} caracteres.`);
  if (nome === '' || nome.length > NOME_FILIAL_MAX) return erro('FILIAL_INVALIDA', `Informe o nome da filial, com até ${NOME_FILIAL_MAX} caracteres.`);
  if (cidade === '' || cidade.length > CIDADE_FILIAL_MAX) return erro('FILIAL_INVALIDA', `Informe a cidade da filial, com até ${CIDADE_FILIAL_MAX} caracteres.`);
  if (!ehUf(uf)) return erro('FILIAL_INVALIDA', 'Informe a UF da filial com 2 letras (ex.: AM, RR).');
  if (existentes.some((f) => f.id !== nova.id && f.codigo.trim().toLowerCase() === codigo.toLowerCase())) {
    return erro('FILIAL_DUPLICADA', `Já existe uma filial com o código ${codigo}. Use outro código ou edite a existente.`);
  }
  const ativo = nova.ativo ?? true;
  const atual = existentes.find((f) => f.id === nova.id);
  if (!ativo && atual?.padrao) return erro('FILIAL_PADRAO', 'A filial padrão não pode ser inativada. Marque outra como padrão antes.');
  if (!ativo && atual?.ativo && (opcoes.clientesAtivos ?? 0) > 0) return erro('FILIAL_EM_USO', 'Mude os clientes de filial antes de inativar.');
  return { ok: true, filial: { codigo, nome, cidade, uf, ativo } };
}

/** RN-CORE-39: a filial padrão não se apaga; filial com cliente também não. */
export function decidirApagarFilial(f: Pick<FilialLike, 'padrao'>, clientes: number): { ok: true } | ErroDeFilial {
  if (f.padrao) return erro('FILIAL_PADRAO', 'A filial padrão não pode ser apagada. Marque outra como padrão antes.');
  if (clientes > 0) return erro('FILIAL_EM_USO', 'Mude os clientes de filial antes de apagar.');
  return { ok: true };
}

/**
 * RN-CORE-39 (T-0149): o que o ERP mandou da filial do cliente. `filial_external_id` ausente = não altera (`{}`); `null` (ou em branco)
 * = filial padrão da empresa; texto = a filial com essa chave do ERP (a ordem de carga põe `filial` antes de `cliente`).
 */
export function filialDoClienteDoErp(registro: { filial_external_id?: string | null }): { filial_external_id: string | null } | Record<string, never> {
  if (!('filial_external_id' in registro) || registro.filial_external_id === undefined) return {};
  const chave = registro.filial_external_id?.trim();
  return { filial_external_id: chave ? chave : null };
}
