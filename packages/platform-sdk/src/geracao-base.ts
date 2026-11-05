/**
 * Geração da base do tenant (ADR 0021, T-0079). `plataforma.tenant.geracao_base` gira em toda operação que apaga ou volta
 * dados do tenant (seed `--recriar`, restauração de backup, servidor novo). O servidor manda o valor em toda página do pull
 * (`PaginaSync.geracao_base`) e em `GET /v1/sync/novidades`; o aparelho guarda o último visto. Geração diferente = a cópia
 * local pode ter linhas que o servidor não tem mais (o "pedido fantasma"): o motor reenvia a fila, apaga o resto e puxa tudo.
 *
 * Funções puras (rodam no app e nos testes); o motor (`motor-sync.ts`) aplica.
 */
import type { ItemAceito, ItemOutbox } from './motor-sync';

/**
 * - `sem_marcador`: o servidor não mandou o campo (servidor antigo ou antes da migração) → nada muda;
 * - `adotar`: o aparelho ainda não guardou geração (instalação nova ou app atualizado) → grava, sem apagar nada;
 * - `igual`: nada muda;
 * - `trocou`: a base do servidor foi recriada ou restaurada → troca de geração (ADR 0021 §5).
 */
export type DecisaoGeracao = 'sem_marcador' | 'adotar' | 'igual' | 'trocou';

const normalizar = (g: string) => g.trim().toLowerCase();

export function decidirGeracao(guardada: string | null, recebida: string | null | undefined): DecisaoGeracao {
  if (typeof recebida !== 'string' || recebida.trim() === '') return 'sem_marcador';
  if (guardada === null || guardada.trim() === '') return 'adotar';
  return normalizar(guardada) === normalizar(recebida) ? 'igual' : 'trocou';
}

/** Forma guardada da geração (comparação sem caixa e sem espaço). */
export function normalizarGeracao(g: string): string {
  return normalizar(g);
}

/**
 * Fila depois da troca de geração (ADR 0021 §5.1): os aceitos ainda sobrepostos (D-3) voltam como `pendente` — a base nova
 * pode não os ter; o reenvio é idempotente pelo UUID do aparelho. Itens da fila ficam como estão (o `falhou` continua
 * visível ao usuário). Mesmo id nos dois (o app caiu entre as gravações) = vale o da fila. Ordem: criação (FIFO).
 */
export function filaNaTrocaDeGeracao(fila: readonly ItemOutbox[], aceitos: readonly ItemAceito[]): ItemOutbox[] {
  const naFila = new Set(fila.map((i) => i.id));
  const voltam: ItemOutbox[] = aceitos
    .filter((a) => !naFila.has(a.id))
    .map(({ aceito_em: _aceitoEm, aceito_servidor_em: _aceitoServidorEm, ...resto }) => ({
      ...resto,
      situacao: 'pendente' as const,
      codigo: null,
      ultimo_erro: '',
    }));
  // sort estável: no empate de `criado_em`, o que já estava antes (aceito) vem primeiro
  return [...voltam, ...fila].sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
}
