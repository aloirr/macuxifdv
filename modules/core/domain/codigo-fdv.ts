/**
 * RN-CORE-59 (T-0175): Código FDV. O vendedor e o promotor têm dois códigos: o "Código ERP" (`external_id`, RN-CORE-57/58) e o
 * "Código FDV", o código próprio do Macuxi para controle. É gerado pelo banco, em sequência por empresa (`FDV-0001`, `FDV-0002`…,
 * no mínimo 4 dígitos, crescendo além de 9999), único por empresa, só de leitura (criar e editar com `codigo_fdv` no corpo = 422)
 * e nunca reaproveitado (usuário apagado ou provisório desativado no vínculo do ERP não libera o número; o real mantém o seu).
 * Funções puras, sem banco.
 */

export const PREFIXO_CODIGO_FDV = 'FDV-';
export const DIGITOS_MINIMOS_CODIGO_FDV = 4;

export const CODIGOS_CODIGO_FDV = { somenteLeitura: 'CODIGO_FDV_SOMENTE_LEITURA' } as const;

/** Número da sequência da empresa (inteiro seguro a partir de 1) -> `FDV-0001`. */
export function formatarCodigoFdv(sequencial: number): string {
  if (!Number.isSafeInteger(sequencial) || sequencial < 1) throw new RangeError('O sequencial do Código FDV é um inteiro a partir de 1.');
  return `${PREFIXO_CODIGO_FDV}${String(sequencial).padStart(DIGITOS_MINIMOS_CODIGO_FDV, '0')}`;
}

export type ResultadoCodigoFdv = { ok: true; sequencial: number; codigo: string } | { ok: false; mensagem: string };

/** Só o formato canônico vale: `FDV-` + 4 dígitos ou mais, sem zeros a mais à esquerda, sequencial ≥ 1. */
export function validarCodigoFdv(texto: string): ResultadoCodigoFdv {
  const m = /^FDV-(\d{4,})$/.exec(texto);
  const sequencial = m ? Number(m[1]) : 0;
  if (!m || !Number.isSafeInteger(sequencial) || sequencial < 1 || formatarCodigoFdv(sequencial) !== texto) {
    return { ok: false, mensagem: 'Código FDV inválido. O formato é FDV-0001.' };
  }
  return { ok: true, sequencial, codigo: texto };
}

/** Próximo número da empresa: o maior já emitido (vivos e apagados) + 1; nunca reaproveita. Espelha o contador do banco. */
export function proximoSequencialFdv(maiorEmitido: number | null): number {
  return (maiorEmitido && maiorEmitido > 0 ? maiorEmitido : 0) + 1;
}

/** `codigo_fdv` no corpo de criar/editar é recusado (422), mesmo igual ao gravado: o campo é só de leitura. */
export function recusarCodigoFdvNoCorpo(corpo: Record<string, unknown>): { codigo: typeof CODIGOS_CODIGO_FDV.somenteLeitura; campo: 'codigo_fdv'; mensagem: string } | null {
  if (corpo.codigo_fdv === undefined) return null;
  return { codigo: CODIGOS_CODIGO_FDV.somenteLeitura, campo: 'codigo_fdv', mensagem: 'O Código FDV é gerado pelo sistema e não pode ser alterado. Tire o campo e salve de novo.' };
}
