/**
 * Unidades de venda do produto vindas do ERP (RN-VEN-15; T-0061; ADR-0005: `core.produto_unidade` é do Core).
 * O Core consome `integracao.produto_unidade.atualizado@1` e aplica com esta regra pura:
 * - `criado`/`atualizado` → upsert por `external_id` (idempotente); sigla em maiúsculas (1 a 6 letras/números), fator inteiro > 0;
 * - `inativado` → `ativo = false` (nunca apaga, RN-INT-06); unidade inativa nunca é `padrao` (check do banco);
 * - no máximo uma `padrao` viva por produto: marcar uma nova pede para desmarcar a anterior na mesma transação.
 * As regras de leitura (unidade padrão, rótulo, lista com a padrão primeiro) são públicas e moram em `contracts/enderecos.ts`
 * (o Vendedor só importa `contracts`); aqui são reexportadas.
 */
export { fatorValido, rotuloDaUnidade, unidadePadraoDoProduto, unidadesDoProduto } from '../contracts/enderecos';
const SIGLA = /^[A-Z0-9]{1,6}$/;
function eanValido(ean) {
    const v = (ean ?? '').trim();
    return /^[0-9]{8,14}$/.test(v) ? v : null;
}
/** Decide o que fazer com o evento. Pura: o consumidor só executa o plano. */
export function planejarProdutoUnidadeDoErp(evento) {
    if (evento.acao === 'inativado')
        return { tipo: 'inativar', external_id: evento.external_id };
    const r = evento.registro;
    if (!r)
        return { tipo: 'ignorar', motivo: 'sem_registro' };
    const unidade = r.unidade.trim().toUpperCase();
    if (!SIGLA.test(unidade))
        return { tipo: 'ignorar', motivo: 'unidade_invalida' };
    if (!(typeof r.fator === 'number' && Number.isInteger(r.fator) && r.fator > 0))
        return { tipo: 'ignorar', motivo: 'fator_invalido' };
    const ativo = r.ativo !== false;
    const padrao = ativo && r.padrao === true;
    return {
        tipo: 'upsert',
        linha: { external_id: evento.external_id, produto_external_id: r.produto_external_id, unidade, fator: r.fator, ean: eanValido(r.ean), padrao, ativo },
        desmarcar_outras_padrao: padrao,
    };
}
