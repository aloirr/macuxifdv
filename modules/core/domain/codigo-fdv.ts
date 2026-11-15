/**
 * RN-CORE-59 (T-0175): Código FDV. Todo usuário, de qualquer perfil, tem o "Código FDV", o código próprio do Macuxi, além do "Código ERP"
 * (`external_id`, RN-CORE-57/58). É gerado pelo banco ao criar o usuário, em sequência por empresa, só dígitos e sem prefixo (`00001`,
 * `00002`…, no mínimo 5 dígitos, crescendo para `100000` além de 99999), único por empresa, só de leitura (criar e editar com
 * `codigo_fdv` no corpo = 422) e nunca reaproveitado (o provisório inativado no vínculo do ERP mantém o seu; o real mantém o seu).
 * Funções puras, sem banco.
 */

export const DIGITOS_MINIMOS_CODIGO_FDV = 5;

export const CODIGOS_CODIGO_FDV = { somenteLeitura: 'CODIGO_FDV_SOMENTE_LEITURA' } as const;

/** Número da sequência da empresa (inteiro seguro a partir de 1) -> `00001`. */
export function formatarCodigoFdv(sequencial: number): string {
  if (!Number.isSafeInteger(sequencial) || sequencial < 1) throw new RangeError('O sequencial do Código FDV é um inteiro a partir de 1.');
  return String(sequencial).padStart(DIGITOS_MINIMOS_CODIGO_FDV, '0');
}

export type ResultadoCodigoFdv = { ok: true; sequencial: number; codigo: string } | { ok: false; mensagem: string };

/** Só o formato do CHECK da 0080 vale: 00001 a 99999 e, acima, sem zero à esquerda (100000...). */
export function validarCodigoFdv(texto: string): ResultadoCodigoFdv {
  const m = /^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$/.exec(texto);
  const sequencial = m ? Number(m[1]) : 0;
  if (!m || !Number.isSafeInteger(sequencial) || sequencial < 1 || formatarCodigoFdv(sequencial) !== texto) {
    return { ok: false, mensagem: 'Código FDV inválido. O formato é 00001 (5 dígitos ou mais).' };
  }
  return { ok: true, sequencial, codigo: texto };
}

/** `codigo_fdv` no corpo de criar/editar é recusado (422), mesmo igual ao gravado: o campo é só de leitura. */
export function recusarCodigoFdvNoCorpo(corpo: Record<string, unknown>): { codigo: typeof CODIGOS_CODIGO_FDV.somenteLeitura; campo: 'codigo_fdv'; mensagem: string } | null {
  if (corpo.codigo_fdv === undefined) return null;
  return { codigo: CODIGOS_CODIGO_FDV.somenteLeitura, campo: 'codigo_fdv', mensagem: 'O Código FDV é gerado pelo sistema e não pode ser alterado. Tire o campo e salve de novo.' };
}
