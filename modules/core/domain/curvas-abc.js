/**
 * Curvas ABC do cliente (RN-CORE-49): mês atual contra a média dos 3 meses anteriores, em três dimensões
 * (faturamento, volume, frequência). Funções puras; faixas por tenant pelo mecanismo `parametro` (módulo `core`).
 * Decisão do dono do produto (14/11/2026, 6h16): "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média.
 * Curva C abaixo da media." Ou seja: A ≥ +20%; B de 0% (inclusive, na média) até abaixo de +20%; C abaixo de 0%.
 */
import { CURVA_ABC_PCT_MAX, CURVA_ABC_PCT_MIN, DIMENSOES_CURVA_ABC, PARAMETRO_CURVA_ABC_FATURAMENTO, PARAMETRO_CURVA_ABC_FREQUENCIA, PARAMETRO_CURVA_ABC_VOLUME, } from '../contracts/curvas-abc';
export const FAIXAS_CURVA_ABC_PADRAO = { a_min_pct: 20, b_min_pct: 0 };
/** Padrão por dimensão (RN-CORE-49): cada dimensão começa igual. */
export const PARAMETROS_CURVA_ABC_PADRAO = {
    faturamento: { ...FAIXAS_CURVA_ABC_PADRAO },
    volume: { ...FAIXAS_CURVA_ABC_PADRAO },
    frequencia: { ...FAIXAS_CURVA_ABC_PADRAO },
};
export const CHAVE_DA_DIMENSAO = {
    faturamento: PARAMETRO_CURVA_ABC_FATURAMENTO,
    volume: PARAMETRO_CURVA_ABC_VOLUME,
    frequencia: PARAMETRO_CURVA_ABC_FREQUENCIA,
};
const PCT_MIN = CURVA_ABC_PCT_MIN;
const PCT_MAX = CURVA_ABC_PCT_MAX;
const DIMENSOES = [
    { dimensao: 'faturamento', nome: 'Faturamento', campo: 'valor_cents' },
    { dimensao: 'volume', nome: 'Volume', campo: 'itens' },
    { dimensao: 'frequencia', nome: 'Frequência', campo: 'pedidos' },
];
export function curvaPelaVariacao(pct, faixas) {
    if (pct >= faixas.a_min_pct)
        return 'A';
    if (pct >= faixas.b_min_pct)
        return 'B';
    return 'C';
}
function mesAnterior(anoMes, n) {
    const [a, m] = anoMes.split('-').map(Number);
    const idx = a * 12 + (m - 1) - n;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
/** Soma (ERP + Macuxi) do campo no mês. */
const somaDoMes = (h, mes, campo) => h.filter((x) => x.ano_mes === mes).reduce((s, x) => s + x[campo], 0);
export function totalDoMes(historico, anoMes) {
    return somaDoMes(historico, anoMes, 'valor_cents');
}
/** `hoje` = 'AAAA-MM-DD' (dia local do tenant). Sem histórico até o 3º mês anterior, `[]`. */
export function curvasAbcDoCliente(historico, hoje, parametros) {
    const atual = hoje.slice(0, 7);
    const anteriores = [1, 2, 3].map((n) => mesAnterior(atual, n));
    const limite = anteriores[2];
    if (!historico.some((x) => x.ano_mes <= limite))
        return [];
    const saida = [];
    for (const d of DIMENSOES) {
        const media = anteriores.reduce((s, m) => s + somaDoMes(historico, m, d.campo), 0) / 3;
        if (media <= 0)
            continue;
        const pct = ((somaDoMes(historico, atual, d.campo) - media) / media) * 100;
        const curva = curvaPelaVariacao(pct, parametros[d.dimensao]);
        saida.push({ dimensao: d.dimensao, curva, rotulo: `${d.nome} ${curva}` });
    }
    return saida;
}
const pctValido = (v) => typeof v === 'number' && Number.isFinite(v) && v >= PCT_MIN && v <= PCT_MAX;
const faixaValida = (v) => {
    if (typeof v !== 'object' || v === null)
        return false;
    const { a_min_pct: a, b_min_pct: b } = v;
    return pctValido(a) && pctValido(b) && a > b;
};
/** Faixas efetivas das 3 dimensões a partir das linhas `parametro`; cada dimensão ausente, apagada ou inválida cai no padrão sozinha. */
export function faixasCurvaAbcDasLinhas(linhas) {
    const faixa = (d) => {
        const v = linhas.find((x) => x.modulo === 'core' && x.chave === CHAVE_DA_DIMENSAO[d] && !x.deleted_at)?.valor;
        return faixaValida(v) ? { a_min_pct: v.a_min_pct, b_min_pct: v.b_min_pct } : { ...FAIXAS_CURVA_ABC_PADRAO };
    };
    return { faturamento: faixa('faturamento'), volume: faixa('volume'), frequencia: faixa('frequencia') };
}
export const ROTULOS_DIMENSAO_CURVA = { faturamento: 'Faturamento', volume: 'Volume', frequencia: 'Frequência' };
/** RN-CORE-49: valida a edição do BKO. Mensagens em português com a ação seguinte; o campo é `<dimensao>.<a_min_pct|b_min_pct>`. */
export function validarParametrosCurvaAbc(e) {
    const erros = [];
    for (const d of DIMENSOES_CURVA_ABC) {
        const f = e[d];
        const nome = ROTULOS_DIMENSAO_CURVA[d];
        const bom = { a_min_pct: pctValido(f.a_min_pct), b_min_pct: pctValido(f.b_min_pct) };
        for (const c of ['a_min_pct', 'b_min_pct']) {
            if (!bom[c])
                erros.push({ campo: `${d}.${c}`, mensagem: `${nome}: informe um percentual de ${PCT_MIN} a ${PCT_MAX} para a curva ${c === 'a_min_pct' ? 'A' : 'B'}.` });
        }
        if (bom.a_min_pct && bom.b_min_pct && f.a_min_pct <= f.b_min_pct)
            erros.push({ campo: `${d}.a_min_pct`, mensagem: `${nome}: a curva A deve começar acima da curva B. Aumente o valor de A ou diminua o de B.` });
    }
    if (erros.length > 0)
        return { ok: false, erros };
    return { ok: true, valores: { faturamento: { ...e.faturamento }, volume: { ...e.volume }, frequencia: { ...e.frequencia } } };
}
