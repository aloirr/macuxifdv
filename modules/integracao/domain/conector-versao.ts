/**
 * Política de versão do Conector (RN-INT-11, proposta T-0025; decisão do Alexandre de 2026-10-31): abaixo da MÍNIMA o Hub recusa
 * os dados (426) e o Conector para de enviar; abaixo da RECOMENDADA só avisa "desatualizado". O sinal de vida segue sempre.
 * A comparação é semver 2.0, a mesma do Conector (`apps/conector/src/versao.ts`).
 */
import { REGEX_SEMVER, type PoliticaVersaoConector } from '../contracts';

export interface Semver {
  maior: number;
  menor: number;
  patch: number;
  pre: string[];
}

/** `null` se o texto não for semver `MAIOR.MENOR.PATCH[-pre]` (um `v` na frente é tolerado). */
export function lerSemver(texto: string): Semver | null {
  const m = REGEX_SEMVER.exec(texto.trim().replace(/^v/i, ''));
  if (!m) return null;
  return { maior: Number(m[1]), menor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function compararPre(a: string[], b: string[]): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // estável vem depois do pré-lançamento
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx) return -1;
    if (ny) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function compararSemver(a: string, b: string): -1 | 0 | 1 {
  const x = lerSemver(a);
  const y = lerSemver(b);
  if (!x || !y) throw new Error(`Versão inválida para comparar: "${x ? b : a}" (use MAIOR.MENOR.PATCH).`);
  for (const k of ['maior', 'menor', 'patch'] as const) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  return compararPre(x.pre, y.pre);
}

export type SituacaoVersaoConector = 'sem_politica' | 'versao_ilegivel' | 'em_dia' | 'desatualizado' | 'abaixo_da_minima';

export interface AvaliacaoVersaoConector {
  situacao: SituacaoVersaoConector;
  /** Abaixo da mínima: as rotas de dados respondem 426. */
  bloqueia: boolean;
  /** Texto para o operador (BKO e corpo do 426); `null` quando está tudo bem. */
  aviso: string | null;
}

type PoliticaMinima = Pick<PoliticaVersaoConector, 'versao_minima' | 'versao_recomendada' | 'mensagem'>;

/**
 * Sem política ou versão ausente/ilegível NUNCA bloqueia (um erro de cadastro não pode parar o cliente). Política inconsistente
 * (mínima > recomendada): a mínima manda. Política com versão ilegível é ignorada.
 */
export function avaliarVersaoConector(versao: string | null | undefined, politica: PoliticaMinima | null | undefined): AvaliacaoVersaoConector {
  if (!politica) return { situacao: 'sem_politica', bloqueia: false, aviso: null };
  if (typeof versao !== 'string' || lerSemver(versao) === null) return { situacao: 'versao_ilegivel', bloqueia: false, aviso: null };
  if (lerSemver(politica.versao_minima) === null || lerSemver(politica.versao_recomendada) === null) return { situacao: 'sem_politica', bloqueia: false, aviso: null };
  const extra = politica.mensagem ? ` ${politica.mensagem}` : '';
  if (compararSemver(versao, politica.versao_minima) < 0) {
    return {
      situacao: 'abaixo_da_minima',
      bloqueia: true,
      aviso: `A versão ${versao} do Conector está abaixo da mínima exigida (${politica.versao_minima}). Atualize o Conector; os dados ficam na fila local até lá.${extra}`,
    };
  }
  if (compararSemver(versao, politica.versao_recomendada) < 0) {
    return { situacao: 'desatualizado', bloqueia: false, aviso: `Há uma versão mais nova do Conector (${politica.versao_recomendada}); a ${versao} segue funcionando. Planeje a atualização.${extra}` };
  }
  return { situacao: 'em_dia', bloqueia: false, aviso: null };
}

/** Só o sinal de vida passa quando o Conector está abaixo da mínima (o Hub precisa vê-lo parado e poder liberá-lo). */
export function rotaBloqueadaPorVersao(rotaId: string, situacao: SituacaoVersaoConector): boolean {
  return situacao === 'abaixo_da_minima' && rotaId !== 'sinal';
}

/** A versão que vale numa chamada: o cabeçalho `X-Macuxi-Conector-Versao` se for semver legível; senão a do corpo; senão nenhuma. */
export function versaoInformada(cabecalho: string | null | undefined, corpo: string | null | undefined): string | null {
  for (const v of [cabecalho, corpo]) {
    if (typeof v === 'string' && lerSemver(v.trim()) !== null) return v.trim();
  }
  return null;
}

export type ResultadoPolitica = { ok: true } | { ok: false; erros: string[] };

/** O BKO só grava política coerente: versões legíveis, mínima <= recomendada e pacote não abaixo da recomendada. */
export function validarPoliticaVersao(p: PoliticaVersaoConector): ResultadoPolitica {
  const erros: string[] = [];
  const min = lerSemver(p.versao_minima);
  const rec = lerSemver(p.versao_recomendada);
  if (!min) erros.push('A versão mínima deve seguir o formato MAIOR.MENOR.PATCH (ex.: 1.1.0).');
  if (!rec) erros.push('A versão recomendada deve seguir o formato MAIOR.MENOR.PATCH (ex.: 1.2.0).');
  if (min && rec && compararSemver(p.versao_minima, p.versao_recomendada) > 0) {
    erros.push(`A versão mínima (${p.versao_minima}) não pode ser maior que a recomendada (${p.versao_recomendada}).`);
  }
  if (rec && p.pacote && lerSemver(p.pacote.versao) !== null && compararSemver(p.pacote.versao, p.versao_recomendada) < 0) {
    erros.push(`O pacote cadastrado (${p.pacote.versao}) está abaixo da versão recomendada (${p.versao_recomendada}). Cadastre o pacote da versão recomendada ou mais nova.`);
  }
  return erros.length === 0 ? { ok: true } : { ok: false, erros };
}
