/**
 * Privacidade da localização (ADR 0061, decisão 8; RN-CORE-13; desenho `docs/desenho/tracking.md` §9): nenhuma coordenada
 * em log, mensagem de erro, Diagnóstico, Sentry ou telemetria; só id do usuário, contagem e tempo.
 *
 * - API: `CAMINHOS_COORDENADA_LOG` entra na redação do pino (`apps/api/src/config.ts`).
 * - Shell e módulos: `semCoordenadas` antes de mandar qualquer objeto ao Diagnóstico ou ao envio de erro;
 *   `textoSemCoordenadas` em mensagem livre.
 */

/** Marca que substitui a coordenada (mesma do `censor` do pino da API). */
export const COORDENADA_OMITIDA = '[omitido]';

/** Chaves que guardam coordenada (fonte única: a regra das chaves e a redação do pino da API saem daqui). */
export const CHAVES_COORDENADA = ['latitude', 'longitude', 'lat', 'lng', 'lon', 'coords'] as const;

const CHAVE_EXATA = new RegExp(`^(${CHAVES_COORDENADA.join('|')})$`, 'i');
/** Sufixo `_lat`, `_lng`... (`checkin_lat`); `coords` só vale como chave inteira. */
const CHAVE_SUFIXO = new RegExp(`_(${CHAVES_COORDENADA.filter((c) => c !== 'coords').join('|')})$`, 'i');

/** A chave guarda coordenada (`latitude`, `lng`, `coords`, `checkin_lat`...). */
export function ehChaveDeCoordenada(chave: string): boolean {
  return CHAVE_EXATA.test(chave) || CHAVE_SUFIXO.test(chave);
}

/** Decimal com 4 casas ou mais (≈ 11 m): o que identifica um lugar. Preço, versão e hora têm menos casas. */
const DECIMAL_PRECISO = /(?<![\d.])-?\d{1,3}\.\d{4,}(?![\d.])/g;

/** Troca todo decimal com 4 casas ou mais pela marca (mensagem de erro, texto do Diagnóstico). */
export function textoSemCoordenadas(texto: string): string {
  return texto.replace(DECIMAL_PRECISO, COORDENADA_OMITIDA);
}

/**
 * Cópia do valor sem coordenadas: chave de coordenada vira `COORDENADA_OMITIDA` em qualquer nível (lista inclusive), texto
 * passa por `textoSemCoordenadas`, `Error` vira `{ name, message }` sem a pilha. Não altera a entrada e nunca lança.
 */
export function semCoordenadas(valor: unknown): unknown {
  const vistos = new WeakSet<object>();
  const limpar = (v: unknown): unknown => {
    if (typeof v === 'string') return textoSemCoordenadas(v);
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return v;
    if (vistos.has(v)) return '[circular]';
    vistos.add(v);
    if (v instanceof Error) return { name: v.name, message: textoSemCoordenadas(v.message) };
    if (Array.isArray(v)) return v.map(limpar);
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) saida[k] = ehChaveDeCoordenada(k) ? COORDENADA_OMITIDA : limpar(x);
    return saida;
  };
  return limpar(valor);
}

/**
 * Caminhos de redação do pino (fast-redact: `*` vale um nível): a chave solta, no 2º nível e dentro de `payload`
 * (item do push). Reforço: o código não registra corpo nem payload do trajeto.
 */
export const CAMINHOS_COORDENADA_LOG: readonly string[] = CHAVES_COORDENADA.flatMap((c) => [
  c,
  `*.${c}`,
  `payload.${c}`,
  `*.payload.${c}`,
]);
