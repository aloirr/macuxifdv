/**
 * Saldo do produto na filial (RN-VEN-20, RN-CORE-39), base de `catalogo.estoque_filial@1`. A regra é única e mora em
 * `contracts/estoque-filial.ts` (o app do Vendedor usa a mesma; RD-0126); aqui só o reexporte para o domain e a API.
 */
export { depositosDaFilial, saldoPorProdutoDaFilial } from '../contracts/estoque-filial';
