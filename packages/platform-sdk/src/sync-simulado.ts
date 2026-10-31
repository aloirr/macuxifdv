/**
 * Servidor de sync simulado (rede injetável) para testes do motor, dos shells e das telas dos módulos.
 * Aplica as mesmas regras da API real que já estão no SDK: `rejeitarItensInvalidos` (entidade
 * desconhecida, MODULO_INATIVO, payload inválido) e `paginar` (cursor `(updated_at, id)`, inclui removidos).
 */
import type { ModuloId } from './nomes';
import type { TransporteSync } from './motor-sync';
import type { ItemPush, LinhaSync, RegistroSync, ResultadoItemPush } from './sync';
import { paginar, PushRequestSchema, rejeitarItensInvalidos } from './sync';

export class ErroRedeSimulada extends Error {
  constructor() {
    super('Sem conexão com o servidor.');
    this.name = 'ErroRedeSimulada';
  }
}

export interface ServidorSyncSimulado extends TransporteSync {
  /** `false` = toda chamada falha como falta de rede. */
  online: boolean;
  /** Módulos efetivos do usuário no servidor (licença checada por requisição). */
  modulosAtivos: ModuloId[];
  /** Linhas por entidade servidas no pull. */
  linhas: Record<string, LinhaSync[]>;
  /** Itens aceitos, por id (idempotente: reenvio não duplica). */
  recebidos: Map<string, ItemPush>;
  /** Rejeição forçada por id (ex.: regra de negócio RN-VEN-...). */
  rejeitar: Map<string, { codigo: string; mensagem: string }>;
  chamadas: { push: number; pull: number };
  tamanhoPagina: number;
}

export function criarServidorSyncSimulado(registro: RegistroSync, inicial: Partial<Pick<ServidorSyncSimulado, 'modulosAtivos' | 'linhas' | 'tamanhoPagina'>> = {}): ServidorSyncSimulado {
  const s: ServidorSyncSimulado = {
    online: true,
    modulosAtivos: inicial.modulosAtivos ?? [],
    linhas: inicial.linhas ?? {},
    recebidos: new Map(),
    rejeitar: new Map(),
    chamadas: { push: 0, pull: 0 },
    tamanhoPagina: inicial.tamanhoPagina ?? 1000,
    async push(itens) {
      s.chamadas.push++;
      if (!s.online) throw new ErroRedeSimulada();
      const req = PushRequestSchema.parse({ itens });
      const { validos, rejeitados } = rejeitarItensInvalidos(req, registro, s.modulosAtivos);
      const saida: ResultadoItemPush[] = [...rejeitados];
      for (const it of validos) {
        const forcado = s.rejeitar.get(it.id);
        if (forcado) saida.push({ id: it.id, status: 'rejeitado', ...forcado });
        else {
          s.recebidos.set(it.id, it);
          saida.push({ id: it.id, status: 'aceito' });
        }
      }
      return itens.map((i) => saida.find((r) => r.id === i.id)!).filter(Boolean);
    },
    async pull(entidade, cursor) {
      s.chamadas.pull++;
      if (!s.online) throw new ErroRedeSimulada();
      return paginar(s.linhas[entidade] ?? [], cursor, s.tamanhoPagina);
    },
  };
  return s;
}
