/**
 * Limite de tentativas das rotas públicas (login, refresh) por IP + chave — desenho T-0002 §6 item 4.
 * Janela fixa em memória do processo: suficiente para uma instância (Sprint 0). Com mais de uma instância,
 * troca-se por um contador no Postgres/Redis com a mesma interface (registrado no desenho T-0004 §6).
 */
export interface Limitador {
  /** Conta a tentativa; `false` = estourou o limite na janela (responder 429). */
  tentar(chave: string): boolean;
  /** Segundos até a janela da chave reabrir (cabeçalho Retry-After). */
  esperaSegundos(chave: string): number;
}

export function criarLimitador(max: number, janelaMs: number, agora: () => number = Date.now): Limitador {
  const janelas = new Map<string, { inicio: number; contagem: number }>();
  const limpar = (t: number) => {
    if (janelas.size < 10_000) return;
    for (const [k, v] of janelas) if (t - v.inicio >= janelaMs) janelas.delete(k);
  };
  return {
    tentar(chave) {
      const t = agora();
      limpar(t);
      const j = janelas.get(chave);
      if (!j || t - j.inicio >= janelaMs) {
        janelas.set(chave, { inicio: t, contagem: 1 });
        return true;
      }
      j.contagem += 1;
      return j.contagem <= max;
    },
    esperaSegundos(chave) {
      const j = janelas.get(chave);
      if (!j) return 0;
      return Math.max(0, Math.ceil((j.inicio + janelaMs - agora()) / 1000));
    },
  };
}
