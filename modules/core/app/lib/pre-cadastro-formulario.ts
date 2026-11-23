/**
 * Formulário do pré-cadastro (v1.0.30; RN-CORE-78 e RN-CORE-79; ADR 0069): colunas, valores digitados, dados normalizados para o
 * contrato e os erros por campo da recusa do ERP marcados na coluna exata. Puro (sem react-native nem rede), do formulário do Campo
 * (`telas/novo-cliente.tsx`).
 */
import { somenteDigitos } from '@macuxi/comum';
import type { ErroCampoCadastro } from '../../contracts';
import { FALTA_OBRIGATORIO_PRE_CADASTRO, validarPreCadastro } from '../../domain';

/** Colunas do formulário, na ordem do Campo (spec `campo-cliente-pre-cadastro.md` §2); são também os nomes canônicos do cadastro. */
export const COLUNAS_FORMULARIO = ['documento', 'razao_social', 'nome_fantasia', 'telefone', 'email', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'inscricao_estadual'] as const;
export type ColunaFormulario = (typeof COLUNAS_FORMULARIO)[number];

/** Texto digitado em cada coluna (a máscara é só da tela; o valor vai sem pontuação onde o contrato pede). */
export type ValoresPreCadastro = Partial<Record<ColunaFormulario, string>>;

const ouNulo = (v: string | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);
const somenteDigitosOuNulo = (v: string | undefined): string | null => (ouNulo(v) === null ? null : somenteDigitos(v));

/** Dados do cliente para o contrato (`PreCadastroClienteSchema` / `CorrecaoPreCadastroSchema`), sem id, origem nem revisão. */
export function dadosDoFormulario(v: ValoresPreCadastro) {
  return {
    razao_social: v.razao_social ?? '',
    nome_fantasia: ouNulo(v.nome_fantasia),
    documento: v.documento ?? '',
    inscricao_estadual: ouNulo(v.inscricao_estadual),
    telefone: somenteDigitosOuNulo(v.telefone),
    email: ouNulo(v.email),
    logradouro: ouNulo(v.logradouro),
    numero: ouNulo(v.numero),
    bairro: ouNulo(v.bairro),
    cidade: ouNulo(v.cidade),
    uf: ouNulo(v.uf),
    cep: somenteDigitosOuNulo(v.cep),
  };
}

/** Valores do formulário a partir dos dados gravados (linha do pull, payload da fila ou a revisão atual do BKO). */
export function valoresDosDados(d: Partial<Record<ColunaFormulario, string | null | undefined>>): ValoresPreCadastro {
  return Object.fromEntries(COLUNAS_FORMULARIO.map((c) => [c, d[c] ?? ''])) as ValoresPreCadastro;
}

const EH_COLUNA = new Set<string>(COLUNAS_FORMULARIO);

/**
 * RN-CORE-78: erros por campo da recusa na coluna exata do formulário (o primeiro de cada coluna). O erro de um campo que o formulário
 * não tem fica só no motivo e no histórico.
 */
export function errosDaRecusaPorColuna(erros: readonly Pick<ErroCampoCadastro, 'campo' | 'mensagem'>[] | null | undefined): Partial<Record<ColunaFormulario, string>> {
  const r: Partial<Record<ColunaFormulario, string>> = {};
  for (const e of erros ?? []) {
    const c = e.campo.trim();
    if (EH_COLUNA.has(c)) r[c as ColunaFormulario] ??= e.mensagem;
  }
  return r;
}

/** Primeira coluna (na ordem do formulário) com marca; nula se nenhuma. */
export function primeiraColunaMarcada(marcas: Partial<Record<ColunaFormulario, unknown>>): ColunaFormulario | null {
  return COLUNAS_FORMULARIO.find((c) => marcas[c]) ?? null;
}

/**
 * RN-CORE-16 e RN-CORE-79: a coluna é exigida agora se, vazia, a `validarPreCadastro` do domain acusa "Obrigatório" (IE só com CNPJ
 * válido, como na `cadastroCompleto`). O rótulo leva "(opcional)" quando não é.
 */
export function colunaExigida(valores: ValoresPreCadastro, exigidos: Parameters<typeof validarPreCadastro>[1], coluna: ColunaFormulario): boolean {
  return validarPreCadastro({ ...valores, [coluna]: '' }, exigidos).erros[coluna] === FALTA_OBRIGATORIO_PRE_CADASTRO;
}
