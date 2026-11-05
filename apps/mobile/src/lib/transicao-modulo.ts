/**
 * Transição "avançar" das telas de módulo (T-0072, docs/design/componentes.md §6). Puro: roda em Node (Vitest).
 *
 * As telas dos módulos moram todas numa rota só do shell (`(tabs)/m/[...caminho]`), então a pilha nativa não anima
 * lista → detalhe. O shell anima a entrada da tela pela chave da rota (caminho + parâmetros):
 * - avançar (tela nova): entra pela direita, 240 ms;
 * - voltar (a chave é a da tela anterior): entra pela esquerda, 240 ms (a tela de cima "sai pela direita");
 * - troca de aba pela barra: sem animação (volta ao topo da pilha guardada da aba);
 * - "reduzir movimento": nunca desloca (duração 0, `transicaoDeAvancar`/`duracaoMovimento` do kit).
 * A pilha de cada aba (o que é "tela nova" e o que é "a anterior") mora em lib/historico-telas.ts.
 */
import { duracaoMovimento } from '@macuxi/ui/mobile/puro';

export type DirecaoTransicao = 'avancar' | 'voltar' | 'nenhuma';

/** Fração da largura da tela que a tela nova percorre ao entrar (o resto é o esmaecer). */
export const FRACAO_DESLOCAMENTO = 0.25;

/** Chave estável da rota: caminho + parâmetros em ordem alfabética (`pedido?id=1`). */
export function chaveDaRota(caminho: string | string[] | undefined, params: Record<string, string | string[] | null | undefined>): string {
  const base = (Array.isArray(caminho) ? caminho.join('/') : (caminho ?? '')).replace(/^\/+|\/+$/g, '');
  const extras = Object.keys(params)
    .filter((k) => k !== 'caminho' && !k.startsWith('__') && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => {
      const v = params[k];
      return `${k}=${Array.isArray(v) ? v.join(',') : v}`;
    });
  return extras.length ? `${base}?${extras.join('&')}` : base;
}

/** Animação de entrada: de onde parte (dp no eixo X) e quanto dura; zero com "reduzir movimento". */
export function animacaoDeEntrada(direcao: DirecaoTransicao, largura: number, reduzir: boolean): { deslocamento: number; duracaoMs: number } {
  const duracaoMs = direcao === 'nenhuma' ? 0 : duracaoMovimento('avancar', reduzir);
  if (duracaoMs === 0) return { deslocamento: 0, duracaoMs: 0 };
  const passo = Math.round(Math.max(0, largura) * FRACAO_DESLOCAMENTO);
  return { deslocamento: direcao === 'avancar' ? passo : -passo, duracaoMs };
}
