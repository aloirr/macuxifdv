/**
 * Versão do Conector (enviada em todo lote, sinal de vida e cabeçalho) e a comparação semver da política de versão do Hub.
 * Tudo aqui é função pura (sem I/O); a política vem do Hub na resposta do sinal (`contracts/conector.ts`).
 */
import { REGEX_SEMVER, type PoliticaVersaoConector } from '@macuxi/integracao/contracts';

export const VERSAO_CONECTOR = '1.5.0';

/** T-0099: primeira versão que lê `"nulo": "limpa"` no conector.json (o esquema das versões anteriores é estrito e recusa a chave). */
export const VERSAO_MINIMA_NULO = '1.3.0';

export interface Semver {
  maior: number;
  menor: number;
  patch: number;
  /** Identificadores de pré-lançamento (`rc`, `1`…); vazio = versão estável. */
  pre: string[];
}

/** `null` se o texto não for semver `MAIOR.MENOR.PATCH[-pre]` (um `v` na frente é tolerado). */
export function lerSemver(texto: string): Semver | null {
  const m = REGEX_SEMVER.exec(texto.trim().replace(/^v/i, ''));
  if (!m) return null;
  return { maior: Number(m[1]), menor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** Ordem do semver 2.0: números; versão estável vem DEPOIS do pré-lançamento da mesma base (1.2.0-rc.1 < 1.2.0). */
export function compararVersoes(a: string, b: string): -1 | 0 | 1 {
  const x = lerSemver(a);
  const y = lerSemver(b);
  if (!x || !y) throw new Error(`Versão inválida para comparar: "${x ? b : a}" (use MAIOR.MENOR.PATCH).`);
  for (const k of ['maior', 'menor', 'patch'] as const) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1; // conjunto menor vence se o resto é igual
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn) return -1; // identificador numérico < alfanumérico
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export type SituacaoVersao = 'ok' | 'desatualizado' | 'abaixo_da_minima' | 'sem_politica';

export interface AvaliacaoVersao {
  situacao: SituacaoVersao;
  /** O Conector deve parar de enviar dados ao Hub. */
  deveParar: boolean;
  /** Texto para `conector status` e log (sem dado pessoal). */
  mensagem: string;
}

/**
 * Compara a versão em uso com a política do Hub:
 *  - abaixo da MÍNIMA → `abaixo_da_minima` e `deveParar` (não envia lotes, retornos nem busca pedidos; só o sinal de vida segue);
 *  - abaixo da RECOMENDADA → `desatualizado` (segue funcionando, só avisa);
 *  - sem política (Hub antigo ou ainda não respondeu) → `sem_politica`, nada a restringir.
 * Política com mínima maior que a recomendada é inconsistente: a mínima manda e a recomendada sobe até ela.
 */
export function avaliarVersao(atual: string, politica: Pick<PoliticaVersaoConector, 'versao_minima' | 'versao_recomendada' | 'mensagem'> | null | undefined): AvaliacaoVersao {
  if (!politica) return { situacao: 'sem_politica', deveParar: false, mensagem: `Versão ${atual}. O Hub ainda não informou versão mínima nem recomendada.` };
  if (!lerSemver(atual) || !lerSemver(politica.versao_minima) || !lerSemver(politica.versao_recomendada)) {
    return { situacao: 'sem_politica', deveParar: false, mensagem: `Versão ${atual}. A política de versão recebida do Hub é ilegível e foi ignorada.` };
  }
  const minimaEfetiva = politica.versao_minima;
  const recomendada = compararVersoes(politica.versao_minima, politica.versao_recomendada) > 0 ? politica.versao_minima : politica.versao_recomendada;
  const nota = politica.mensagem ? ` ${politica.mensagem}` : '';
  if (compararVersoes(atual, minimaEfetiva) < 0) {
    return {
      situacao: 'abaixo_da_minima',
      deveParar: true,
      mensagem: `Versão ${atual} abaixo da mínima ${minimaEfetiva}: o Conector parou de enviar dados ao Hub. Instale a versão ${recomendada} ou mais nova (procedimento em docs/modulos/integracao/conector.md, seção "Pacote e atualização").${nota}`,
    };
  }
  if (compararVersoes(atual, recomendada) < 0) {
    return { situacao: 'desatualizado', deveParar: false, mensagem: `Versão ${atual} desatualizada: a recomendada é ${recomendada}. O Conector segue funcionando; planeje a atualização.${nota}` };
  }
  return { situacao: 'ok', deveParar: false, mensagem: `Versão ${atual} em dia (mínima ${minimaEfetiva}, recomendada ${recomendada}).` };
}
