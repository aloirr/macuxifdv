/**
 * Limite de FALHAS de login (RF-CORE-01, T-0026): 10 falhas em 5 min por IP real + código da empresa + e-mail.
 * Entradas certas não consomem o limite (e zeram a chave). IP = `ctx.ip` (request.ip: com `trustProxy` no servidor
 * vem de X-Forwarded-For/CF-Connecting-IP; atrás do túnel, cada aparelho tem a sua chave).
 * Janela fixa em memória do processo (uma instância, como o limitador da plataforma).
 */
export interface LimiteDeFalhas {
  /** Segundos até reabrir se a chave já estourou; 0 = pode tentar. */
  bloqueadoPor(chave: string, agora: Date): number;
  registrarFalha(chave: string, agora: Date): void;
  zerar(chave: string): void;
}

export function criarLimiteDeFalhas(max = 10, janelaMs = 5 * 60_000): LimiteDeFalhas {
  const janelas = new Map<string, { inicio: number; falhas: number }>();
  const vigente = (chave: string, t: number) => {
    const j = janelas.get(chave);
    if (!j) return null;
    if (t - j.inicio >= janelaMs) {
      janelas.delete(chave);
      return null;
    }
    return j;
  };
  return {
    bloqueadoPor(chave, agora) {
      const t = agora.getTime();
      const j = vigente(chave, t);
      return j && j.falhas >= max ? Math.max(1, Math.ceil((j.inicio + janelaMs - t) / 1000)) : 0;
    },
    registrarFalha(chave, agora) {
      const t = agora.getTime();
      if (janelas.size >= 10_000) for (const k of [...janelas.keys()]) vigente(k, t);
      const j = vigente(chave, t);
      if (j) j.falhas += 1;
      else janelas.set(chave, { inicio: t, falhas: 1 });
    },
    zerar: (chave) => void janelas.delete(chave),
  };
}

export const chaveDeLogin = (ip: string, codigo: string, email: string): string => `${ip}|${codigo.toLowerCase()}|${email.toLowerCase()}`;
