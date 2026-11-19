/**
 * Regra do parâmetro `rastreamento` ao salvar no BKO (T-0156; desenho `tracking.md` §4.1). RN-CORE-13.
 * Função pura; a API revalida e o BKO mostra a mesma mensagem.
 */
import type { ParametrosRastreamento } from '../contracts';

export type ResultadoParametrosRastreamento = { ok: true } | { ok: false; erros: Array<{ campo: string; mensagem: string }> };

/** RN-CORE-13: "sem expediente cadastrado, o tracking não liga, mesmo com `rastreamento.ativo`" (§4.1). */
export function validarParametrosRastreamento(p: ParametrosRastreamento): ResultadoParametrosRastreamento {
  const temFaixa = Object.values(p.expediente).some((faixas) => faixas.length > 0);
  if (p.ativo && !temFaixa) {
    return { ok: false, erros: [{ campo: 'expediente', mensagem: 'Para ligar o rastreamento, defina o expediente de pelo menos um dia da semana.' }] };
  }
  return { ok: true };
}
