/**
 * Formulário do pré-cadastro (v1.0.30; RN-CORE-78 e RN-CORE-79; ADR 0069): colunas, valores digitados, dados normalizados para o
 * contrato, os rótulos e os erros por campo da recusa do ERP marcados na coluna exata. Puro (sem react-native nem rede): fonte única
 * do formulário do Campo (`telas/novo-cliente.tsx`) e do "Editar e reenviar" do BKO (`web/lib/pre-cadastro.ts`).
 */
import { somenteDigitos } from '@macuxi/comum';
import { ROTULOS_CAMPOS_PRE_CADASTRO, type CampoPreCadastro, type ErroCampoCadastro } from '../../contracts';
import { FALTA_OBRIGATORIO_PRE_CADASTRO, validarPreCadastro } from '../../domain';

/** Colunas do formulário, na ordem do Campo (spec `campo-cliente-pre-cadastro.md` §2); são também os nomes canônicos do cadastro. */
export const COLUNAS_FORMULARIO = ['documento', 'razao_social', 'nome_fantasia', 'telefone', 'email', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'inscricao_estadual'] as const;
export type ColunaFormulario = (typeof COLUNAS_FORMULARIO)[number];

/** Texto digitado em cada coluna (a máscara é só da tela; o valor vai sem pontuação onde o contrato pede). */
export type ValoresPreCadastro = Partial<Record<ColunaFormulario, string>>;

/** Rótulos das colunas do endereço (o contrato só rotula o grupo "Endereço"); os mesmos no Campo, no BKO e no endereço do usuário. */
export const ROTULOS_ENDERECO = { cep: 'CEP', logradouro: 'Logradouro', numero: 'Número', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF' } as const;

/** Campo do Código ERP de quem fez a primeira tentativa (cliente-cadastro.ts): não é coluna do formulário; a recusa dele aparece no campo "Vendedor". */
export const CAMPO_VENDEDOR = 'vendedor_external_id';

/** Rótulo de uma coluna ou do campo citado no erro (os do contrato e os do endereço); campo que o formulário não tem aparece com o nome que veio. */
export function rotuloDoCampo(campo: string): string {
  if (campo.trim() === CAMPO_VENDEDOR) return 'Vendedor';
  return ROTULOS_CAMPOS_PRE_CADASTRO[campo as CampoPreCadastro] ?? ROTULOS_ENDERECO[campo as keyof typeof ROTULOS_ENDERECO] ?? campo;
}

const ouNulo = (v: string | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);
const somenteDigitosOuNulo = (v: string | undefined): string | null => (ouNulo(v) === null ? null : somenteDigitos(v));

/** Dados do cliente para o contrato (`PreCadastroClienteSchema` / `CorrecaoPreCadastroSchema`), sem id, origem nem revisão: CPF/CNPJ, telefone e CEP só com dígitos; vazio = nulo. */
export function dadosDoFormulario(v: ValoresPreCadastro) {
  return {
    razao_social: v.razao_social ?? '',
    nome_fantasia: ouNulo(v.nome_fantasia),
    documento: somenteDigitos(v.documento),
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
 * não tem fica só no motivo e no histórico; o de `vendedor_external_id` sai também na linha Vendedor (`erroDoVendedor`).
 */
export function errosDaRecusaPorColuna(erros: readonly Pick<ErroCampoCadastro, 'campo' | 'mensagem'>[] | null | undefined): Partial<Record<ColunaFormulario, string>> {
  const r: Partial<Record<ColunaFormulario, string>> = {};
  for (const e of erros ?? []) {
    const c = e.campo.trim();
    if (EH_COLUNA.has(c)) r[c as ColunaFormulario] ??= e.mensagem;
  }
  return r;
}

/**
 * RN-CORE-78: a recusa do ERP por `vendedor_external_id` (Código ERP de quem fez a primeira tentativa) não é coluna do formulário: nunca
 * marca outra coluna; a mensagem sai por aqui, no campo "Vendedor" (`rotuloDoCampo`), junto do motivo e do histórico.
 */
export function erroDoVendedor(erros: readonly Pick<ErroCampoCadastro, 'campo' | 'mensagem'>[] | null | undefined): string | null {
  return (erros ?? []).find((e) => e.campo.trim() === CAMPO_VENDEDOR)?.mensagem ?? null;
}

/** Primeira coluna com marca, na `ordem` da tela (padrão: a do Campo; o BKO passa a da grade); nula se nenhuma. */
export function primeiraColunaMarcada(marcas: Partial<Record<ColunaFormulario, unknown>>, ordem: readonly ColunaFormulario[] = COLUNAS_FORMULARIO): ColunaFormulario | null {
  return ordem.find((c) => marcas[c]) ?? null;
}

/**
 * RN-CORE-16 e RN-CORE-79: a coluna é exigida agora se, vazia, a `validarPreCadastro` do domain acusa "Obrigatório" (IE só com CNPJ
 * válido, como na `cadastroCompleto`). O rótulo leva "(opcional)" quando não é.
 */
export function colunaExigida(valores: ValoresPreCadastro, exigidos: Parameters<typeof validarPreCadastro>[1], coluna: ColunaFormulario): boolean {
  return validarPreCadastro({ ...valores, [coluna]: '' }, exigidos).erros[coluna] === FALTA_OBRIGATORIO_PRE_CADASTRO;
}
