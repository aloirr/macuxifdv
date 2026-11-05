/**
 * Transição "avançar" das telas de módulo (T-0072, docs/design/componentes.md §6). Puro: roda em Node (Vitest).
 *
 * As telas dos módulos moram todas numa rota só do shell (`(tabs)/m/[...caminho]`), então a pilha nativa não anima
 * lista → detalhe. O shell anima a entrada da tela pela chave da rota (caminho + parâmetros):
 * - avançar (tela nova): entra pela direita, 240 ms;
 * - voltar (a chave é a da tela anterior): entra pela esquerda, 240 ms (a tela de cima "sai pela direita");
 * - troca de aba pela barra: sem animação (a pilha recomeça na aba);
 * - "reduzir movimento": nunca desloca (duração 0, `transicaoDeAvancar`/`duracaoMovimento` do kit).
 */
import { duracaoMovimento } from '@macuxi/ui/mobile/puro';

export type DirecaoTransicao = 'avancar' | 'voltar' | 'nenhuma';

/** Telas guardadas no histórico do shell (só chaves: nada de dado de cliente em memória além do caminho). */
export const LIMITE_HISTORICO = 30;

/** Fração da largura da tela que a tela nova percorre ao entrar (o resto é o esmaecer). */
export const FRACAO_DESLOCAMENTO = 0.25;

/** Chave estável da rota: caminho + parâmetros em ordem alfabética (`pedido?id=1`). */
export function chaveDaRota(caminho: string | string[] | undefined, params: Record<string, string | string[] | undefined>): string {
  const base = (Array.isArray(caminho) ? caminho.join('/') : (caminho ?? '')).replace(/^\/+|\/+$/g, '');
  const extras = Object.keys(params)
    .filter((k) => k !== 'caminho' && params[k] !== undefined)
    .sort()
    .map((k) => {
      const v = params[k];
      return `${k}=${Array.isArray(v) ? v.join(',') : v}`;
    });
  return extras.length ? `${base}?${extras.join('&')}` : base;
}

/** Próximo histórico e direção da animação para a tela que acabou de abrir. */
export function proximaNavegacao(
  historico: readonly string[],
  chave: string,
  trocaDeAba: boolean,
): { historico: string[]; direcao: DirecaoTransicao } {
  const atual = historico[historico.length - 1];
  if (atual === chave) return { historico: [...historico], direcao: 'nenhuma' };
  if (trocaDeAba || historico.length === 0) return { historico: [chave], direcao: 'nenhuma' };
  if (historico[historico.length - 2] === chave) return { historico: historico.slice(0, -1), direcao: 'voltar' };
  return { historico: [...historico, chave].slice(-LIMITE_HISTORICO), direcao: 'avancar' };
}

/** Animação de entrada: de onde parte (dp no eixo X) e quanto dura; zero com "reduzir movimento". */
export function animacaoDeEntrada(direcao: DirecaoTransicao, largura: number, reduzir: boolean): { deslocamento: number; duracaoMs: number } {
  const duracaoMs = direcao === 'nenhuma' ? 0 : duracaoMovimento('avancar', reduzir);
  if (duracaoMs === 0) return { deslocamento: 0, duracaoMs: 0 };
  const passo = Math.round(Math.max(0, largura) * FRACAO_DESLOCAMENTO);
  return { deslocamento: direcao === 'avancar' ? passo : -passo, duracaoMs };
}

// ---------- estado do shell (um histórico por app) ----------
/**
 * A marca da troca de aba vale por pouco tempo: se a aba tocada já era a atual (a rota não muda), a marca expira e
 * não come a animação da próxima navegação de verdade.
 */
export const VALIDADE_MARCA_ABA_MS = 1000;

let historicoDoShell: string[] = [];
let marcaDaAba: number | null = null;

/** A barra de abas chama antes de navegar para uma aba de módulo: a tela abre sem animação e o histórico recomeça. */
export function marcarTrocaDeAba(agora: number = Date.now()): void {
  marcaDaAba = agora;
}

/** Registra a tela aberta e devolve a direção da animação (consome a marca de troca de aba). */
export function registrarTelaAberta(chave: string, agora: number = Date.now()): DirecaoTransicao {
  const trocaDeAba = marcaDaAba !== null && agora - marcaDaAba <= VALIDADE_MARCA_ABA_MS;
  const r = proximaNavegacao(historicoDoShell, chave, trocaDeAba);
  historicoDoShell = r.historico;
  marcaDaAba = null;
  return r.direcao;
}

/** Zera o histórico do shell: no fim da sessão (logout ou aparelho bloqueado), para a 1ª tela do próximo login não animar como "voltar"; e nos testes. */
export function limparHistoricoDoShell(): void {
  historicoDoShell = [];
  marcaDaAba = null;
}
