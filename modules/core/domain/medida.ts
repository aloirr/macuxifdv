/**
 * Medidas do produto (RN-CORE-19; RF-CORE-14). Funções puras, sem banco.
 * - Sigla: 1 a 4 letras maiúsculas, única no tenant (`core.medida`); a descrição é obrigatória (até 40 caracteres).
 * - Medida não se apaga em uso: inativa-se. INATIVAR é permitido mesmo em uso (o produto mantém a sigla; a medida só
 *   some das escolhas novas). APAGAR e TROCAR A SIGLA em uso são recusados.
 * - Produto: medida da unidade obrigatória, cadastrada e ativa; embalagem opcional e tudo-ou-nada (medida + quantidade
 *   de unidades, inteira e maior que 1), com medida diferente da unidade.
 */

export const DESCRICAO_MEDIDA_MAX = 40;
const SIGLA = /^[A-Z]{1,4}$/;

export type CodigoErroMedida =
  | 'MEDIDA_INVALIDA'
  | 'MEDIDA_NAO_CADASTRADA'
  | 'MEDIDA_INATIVA'
  | 'MEDIDA_EM_USO'
  | 'EMBALAGEM_INCOMPLETA'
  | 'EMBALAGEM_INVALIDA';

export interface ErroDeMedida {
  ok: false;
  codigo: CodigoErroMedida;
  mensagem: string;
}
const erro = (codigo: CodigoErroMedida, mensagem: string): ErroDeMedida => ({ ok: false, codigo, mensagem });

/** RN-CORE-19: aparar e pôr em maiúsculas (a sigla é sempre guardada assim). */
export function normalizarSigla(sigla: string | null | undefined): string {
  return (sigla ?? '').trim().toUpperCase();
}

/** RN-CORE-19: sigla (1 a 4 letras A-Z, sem acento, número ou espaço) e descrição obrigatória (até 40). */
export function validarMedida(entrada: { sigla: string; descricao: string }): { ok: true; medida: { sigla: string; descricao: string } } | ErroDeMedida {
  const sigla = normalizarSigla(entrada.sigla);
  const descricao = (entrada.descricao ?? '').trim();
  if (!SIGLA.test(sigla)) return erro('MEDIDA_INVALIDA', 'A sigla da medida deve ter de 1 a 4 letras, sem número, espaço ou acento (ex.: UN, CX). Corrija e tente de novo.');
  if (descricao === '') return erro('MEDIDA_INVALIDA', 'Informe a descrição da medida (ex.: Caixa).');
  if (descricao.length > DESCRICAO_MEDIDA_MAX) return erro('MEDIDA_INVALIDA', `A descrição da medida pode ter até ${DESCRICAO_MEDIDA_MAX} caracteres. Encurte o texto.`);
  return { ok: true, medida: { sigla, descricao } };
}

/** RN-CORE-19: só a medida cadastrada e ativa entra em produto ou embalagem novos. */
export function podeUsarMedida(medida: { ativo: boolean } | null | undefined): boolean {
  return Boolean(medida && medida.ativo);
}

export interface MedidasDoProdutoEntrada {
  unidade: string;
  embalagem_medida?: string | null;
  embalagem_quantidade?: number | null;
}
export interface MedidasDoProduto {
  unidade: string;
  embalagem_medida: string | null;
  embalagem_quantidade: number | null;
}

/**
 * RN-CORE-19: confere a unidade e a embalagem do produto contra as medidas do tenant (`sigla -> { ativo }`).
 * `atuais` = o que o produto já guarda: uma sigla que NÃO mudou é aceita mesmo inativa (inativar a medida não trava a edição
 * do produto); trocar para sigla inativa continua recusado.
 */
export function validarMedidasDoProduto(
  entrada: MedidasDoProdutoEntrada,
  medidas: ReadonlyMap<string, { ativo: boolean }>,
  atuais?: { unidade?: string | null; embalagem_medida?: string | null },
): { ok: true; valor: MedidasDoProduto } | ErroDeMedida {
  const unidade = normalizarSigla(entrada.unidade);
  if (unidade === '') return erro('MEDIDA_INVALIDA', 'Escolha a medida da unidade do produto.');
  const embalagem = normalizarSigla(entrada.embalagem_medida);
  const quantidade = entrada.embalagem_quantidade ?? null;

  const conferir = (sigla: string, atual: string | null | undefined, onde: string): ErroDeMedida | null => {
    const m = medidas.get(sigla);
    if (!m) return erro('MEDIDA_NAO_CADASTRADA', `A medida ${sigla} (${onde}) não está cadastrada. Cadastre-a em Parâmetros → Produtos → Medidas ou escolha outra.`);
    if (!podeUsarMedida(m) && normalizarSigla(atual) !== sigla) return erro('MEDIDA_INATIVA', `A medida ${sigla} (${onde}) está inativa. Reative-a em Parâmetros → Produtos → Medidas ou escolha outra.`);
    return null;
  };

  const eUnidade = conferir(unidade, atuais?.unidade, 'unidade');
  if (eUnidade) return eUnidade;

  if (embalagem === '' && quantidade === null) return { ok: true, valor: { unidade, embalagem_medida: null, embalagem_quantidade: null } };
  if (embalagem === '' || quantidade === null) return erro('EMBALAGEM_INCOMPLETA', 'Para cadastrar a embalagem, informe a medida e a quantidade de unidades; ou deixe os dois campos vazios.');
  if (!Number.isInteger(quantidade) || quantidade <= 1) return erro('EMBALAGEM_INVALIDA', 'A quantidade de unidades da embalagem deve ser um número inteiro maior que 1.');
  if (embalagem === unidade) return erro('EMBALAGEM_INVALIDA', 'A embalagem deve ter uma medida diferente da unidade (ex.: unidade UN, embalagem CX).');
  const eEmbalagem = conferir(embalagem, atuais?.embalagem_medida, 'embalagem');
  if (eEmbalagem) return eEmbalagem;
  return { ok: true, valor: { unidade, embalagem_medida: embalagem, embalagem_quantidade: quantidade } };
}

/** RN-CORE-19: apagar é só sem uso; em uso, a saída é inativar. */
export function decidirApagarMedida(uso: { emUso: number }): { ok: true } | ErroDeMedida {
  if (uso.emUso > 0) return erro('MEDIDA_EM_USO', `Medida em uso por ${uso.emUso} produto(s): inative em vez de apagar.`);
  return { ok: true };
}

/** RN-CORE-19: a sigla só muda se ninguém usa a medida; a descrição muda sempre. */
export function decidirTrocaDeSigla(entrada: { siglaAtual: string; siglaNova: string; emUso: number }): { ok: true } | ErroDeMedida {
  if (normalizarSigla(entrada.siglaAtual) === normalizarSigla(entrada.siglaNova)) return { ok: true };
  if (entrada.emUso > 0) return erro('MEDIDA_EM_USO', `A sigla não pode mudar: a medida está em uso por ${entrada.emUso} produto(s). Altere só a descrição ou crie outra medida e inative esta.`);
  return { ok: true };
}
