/**
 * Limite de tentativas das rotas públicas (login, refresh) por IP + chave — desenho T-0002 §6 item 4.
 * Janela fixa em memória do processo: suficiente para uma instância (Sprint 0). Com mais de uma instância,
 * troca-se por um contador no Postgres/Redis com a mesma interface (registrado no desenho T-0004 §6).
 */
import type { FastifyReply } from 'fastify';
import { ErroHttp } from './erros';

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

/**
 * Contador de FALHAS por chave (rotas de Conector, ADR 0013 §3 item 1): só a falha de autenticação conta; a chamada que
 * autentica não consome. Com `max` falhas na janela, `bloqueado` devolve os segundos do `Retry-After` até a janela reabrir.
 */
export interface ContadorFalhas {
  /** Segundos até liberar (> 0) se a chave estourou o limite na janela; `null` = liberada. */
  bloqueado(chave: string): number | null;
  registrarFalha(chave: string): void;
}

export function criarContadorFalhas(max: number, janelaMs: number, agora: () => number = Date.now): ContadorFalhas {
  const janelas = new Map<string, { inicio: number; contagem: number }>();
  const viva = (chave: string, t: number) => {
    const j = janelas.get(chave);
    if (j && t - j.inicio >= janelaMs) {
      janelas.delete(chave);
      return undefined;
    }
    return j;
  };
  return {
    bloqueado(chave) {
      const t = agora();
      const j = viva(chave, t);
      if (!j || j.contagem < max) return null;
      return Math.max(1, Math.ceil((j.inicio + janelaMs - t) / 1000));
    },
    registrarFalha(chave) {
      const t = agora();
      if (janelas.size >= 10_000) for (const [k, v] of janelas) if (t - v.inicio >= janelaMs) janelas.delete(k);
      const j = viva(chave, t);
      if (j) j.contagem += 1;
      else janelas.set(chave, { inicio: t, contagem: 1 });
    },
  };
}

/** 429 das rotas públicas (RD-0404): `Retry-After` + `detalhes.retry_after_s`, o mesmo formato do 429 do módulo (o app mostra a espera real). */
export function recusarPorLimite(reply: FastifyReply, esperaS: number): never {
  reply.header('retry-after', String(esperaS));
  throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente de novo.', { retry_after_s: esperaS });
}
