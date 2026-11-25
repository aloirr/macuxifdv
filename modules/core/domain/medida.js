/**
 * Medidas do produto (RN-CORE-19; RF-CORE-14). Funções puras, sem banco.
 * - Sigla: 1 a 4 letras maiúsculas, única no tenant (`core.medida`); a descrição é obrigatória (até 40 caracteres).
 * - Medida não se apaga em uso: inativa-se. INATIVAR é permitido mesmo em uso (o produto mantém a sigla; a medida só
 *   some das escolhas novas). APAGAR e TROCAR A SIGLA em uso são recusados.
 * - Produto: medida da unidade obrigatória, cadastrada e ativa; embalagem opcional e tudo-ou-nada (medida + quantidade
 *   de unidades, inteira de 2 a 9999), com medida diferente da unidade.
 * - Embalagem x unidade de venda do ERP (`core.produto_unidade`, RN-VEN-15): a embalagem do produto é a fonte para o BKO; se existe
 *   unidade de venda viva com a MESMA sigla, a quantidade tem de ser igual ao `fator` (o BKO recusa com 422; no consumidor do ERP,
 *   o ERP prevalece e a embalagem do produto é ajustada ao fator).
 */
import { EMBALAGEM_QUANTIDADE_MAX, EMBALAGEM_QUANTIDADE_MIN } from '../contracts/medida';
export { EMBALAGEM_QUANTIDADE_MAX, EMBALAGEM_QUANTIDADE_MIN };
export const DESCRICAO_MEDIDA_MAX = 40;
const SIGLA = /^[A-Z]{1,4}$/;
const erro = (codigo, mensagem) => ({ ok: false, codigo, mensagem });
/** RN-CORE-19: aparar e pôr em maiúsculas (a sigla é sempre guardada assim). */
export function normalizarSigla(sigla) {
    return (sigla ?? '').trim().toUpperCase();
}
/** RN-CORE-19: sigla (1 a 4 letras A-Z, sem acento, número ou espaço) e descrição obrigatória (até 40). */
export function validarMedida(entrada) {
    const sigla = normalizarSigla(entrada.sigla);
    const descricao = (entrada.descricao ?? '').trim();
    if (!SIGLA.test(sigla))
        return erro('MEDIDA_INVALIDA', 'A sigla da medida deve ter de 1 a 4 letras, sem número, espaço ou acento (ex.: UN, CX). Corrija e tente de novo.');
    if (descricao === '')
        return erro('MEDIDA_INVALIDA', 'Informe a descrição da medida (ex.: Caixa).');
    if (descricao.length > DESCRICAO_MEDIDA_MAX)
        return erro('MEDIDA_INVALIDA', `A descrição da medida pode ter até ${DESCRICAO_MEDIDA_MAX} caracteres. Encurte o texto.`);
    return { ok: true, medida: { sigla, descricao } };
}
/** RN-CORE-19: só a medida cadastrada e ativa entra em produto ou embalagem novos. */
export function podeUsarMedida(medida) {
    return Boolean(medida && medida.ativo);
}
/**
 * RN-CORE-19: confere a unidade e a embalagem do produto contra as medidas do tenant (`sigla -> { ativo }`).
 * `atuais` = o que o produto já guarda: uma sigla que NÃO mudou é aceita mesmo inativa (inativar a medida não trava a edição
 * do produto); trocar para sigla inativa continua recusado.
 */
export function validarMedidasDoProduto(entrada, medidas, atuais, 
/** Unidades de venda vivas do produto vindas do ERP: sigla -> fator (RN-VEN-15). */
unidadesDeVenda) {
    const unidade = normalizarSigla(entrada.unidade);
    if (unidade === '')
        return erro('MEDIDA_INVALIDA', 'Escolha a medida da unidade do produto.');
    const embalagem = normalizarSigla(entrada.embalagem_medida);
    const quantidade = entrada.embalagem_quantidade ?? null;
    const conferir = (sigla, atual, onde) => {
        const m = medidas.get(sigla);
        if (!m)
            return erro('MEDIDA_NAO_CADASTRADA', `A medida ${sigla} (${onde}) não está cadastrada. Cadastre-a em Parâmetros → Produtos → Medidas ou escolha outra.`);
        if (!podeUsarMedida(m) && normalizarSigla(atual) !== sigla)
            return erro('MEDIDA_INATIVA', `A medida ${sigla} (${onde}) está inativa. Reative-a em Parâmetros → Produtos → Medidas ou escolha outra.`);
        return null;
    };
    const eUnidade = conferir(unidade, atuais?.unidade, 'unidade');
    if (eUnidade)
        return eUnidade;
    if (embalagem === '' && quantidade === null)
        return { ok: true, valor: { unidade, embalagem_medida: null, embalagem_quantidade: null } };
    if (embalagem === '' || quantidade === null)
        return erro('EMBALAGEM_INCOMPLETA', 'Para cadastrar a embalagem, informe a medida e a quantidade de unidades; ou deixe os dois campos vazios.');
    if (!Number.isInteger(quantidade) || quantidade < EMBALAGEM_QUANTIDADE_MIN || quantidade > EMBALAGEM_QUANTIDADE_MAX) {
        return erro('EMBALAGEM_INVALIDA', `A quantidade de unidades da embalagem deve ser um número inteiro de ${EMBALAGEM_QUANTIDADE_MIN} a ${EMBALAGEM_QUANTIDADE_MAX}.`);
    }
    if (embalagem === unidade)
        return erro('EMBALAGEM_INVALIDA', 'A embalagem deve ter uma medida diferente da unidade (ex.: unidade UN, embalagem CX).');
    const eEmbalagem = conferir(embalagem, atuais?.embalagem_medida, 'embalagem');
    if (eEmbalagem)
        return eEmbalagem;
    const fatorErp = fatorDoErpParaEmbalagem(embalagem, unidadesDeVenda);
    if (fatorErp !== null && fatorErp !== quantidade) {
        return erro('EMBALAGEM_DIVERGE_ERP', `A embalagem ${embalagem} deste produto já vem do ERP com ${fatorErp} unidades. Informe ${fatorErp} ou corrija a unidade de venda no ERP.`);
    }
    return { ok: true, valor: { unidade, embalagem_medida: embalagem, embalagem_quantidade: quantidade } };
}
/** Fator da unidade de venda do ERP com a sigla da embalagem, se couber como embalagem (2 a 9999); senão `null` (UN = 1 não é embalagem). */
function fatorDoErpParaEmbalagem(sigla, unidadesDeVenda) {
    const fator = unidadesDeVenda?.get(sigla);
    return fator !== undefined && Number.isInteger(fator) && fator >= EMBALAGEM_QUANTIDADE_MIN && fator <= EMBALAGEM_QUANTIDADE_MAX ? fator : null;
}
/**
 * RN-VEN-15 / RN-CORE-19: no consumidor do ERP, o ERP prevalece. Se a embalagem do produto tem a mesma sigla de uma unidade de venda
 * viva do ERP, a quantidade passa a ser o `fator`; `ajustada` diz se houve troca (o consumidor registra no log, sem dado pessoal).
 */
export function reconciliarEmbalagemComErp(embalagem, unidadesDeVenda) {
    if (!embalagem.embalagem_medida || embalagem.embalagem_quantidade === null)
        return { embalagem_medida: null, embalagem_quantidade: null, ajustada: false };
    const fator = fatorDoErpParaEmbalagem(embalagem.embalagem_medida, unidadesDeVenda);
    if (fator === null || fator === embalagem.embalagem_quantidade)
        return { ...embalagem, ajustada: false };
    return { embalagem_medida: embalagem.embalagem_medida, embalagem_quantidade: fator, ajustada: true };
}
/** RN-CORE-19: apagar é só sem uso; em uso, a saída é inativar. */
export function decidirApagarMedida(uso) {
    if (uso.emUso > 0)
        return erro('MEDIDA_EM_USO', `Medida em uso por ${uso.emUso} produto(s): inative em vez de apagar.`);
    return { ok: true };
}
/** RN-CORE-19: a sigla só muda se ninguém usa a medida; a descrição muda sempre. */
export function decidirTrocaDeSigla(entrada) {
    if (normalizarSigla(entrada.siglaAtual) === normalizarSigla(entrada.siglaNova))
        return { ok: true };
    if (entrada.emUso > 0)
        return erro('MEDIDA_EM_USO', `A sigla não pode mudar: a medida está em uso por ${entrada.emUso} produto(s). Altere só a descrição ou crie outra medida e inative esta.`);
    return { ok: true };
}
