/**
 * Hash de senha argon2id em formato PHC ($argon2id$v=19$m=...,t=...,p=...$sal$hash), usado pelos
 * seeds e fixtures. Usa o argon2 nativo do Node (>= 24.7); a API (T-0003) pode usar outra biblioteca
 * desde que leia/escreva o mesmo formato PHC.
 */
import * as crypto from 'node:crypto';

interface ParametrosArgon2 {
  message: string | Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}
type Argon2Sync = (algoritmo: 'argon2id', p: ParametrosArgon2) => Buffer;

/** Parâmetros mínimos recomendados pela OWASP para argon2id (19 MiB, 2 passadas, 1 via). */
const PADRAO = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

function argon2(): Argon2Sync {
  const fn = (crypto as unknown as { argon2Sync?: Argon2Sync }).argon2Sync;
  if (!fn) throw new Error('Este Node não tem crypto.argon2Sync (precisa de Node >= 24.7) — necessário para gerar senhas do seed.');
  return fn;
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export function hashSenha(senha: string, sal: Buffer = crypto.randomBytes(16)): string {
  const tag = argon2()('argon2id', { message: senha, nonce: sal, ...PADRAO });
  return `$argon2id$v=19$m=${PADRAO.memory},t=${PADRAO.passes},p=${PADRAO.parallelism}$${b64(sal)}$${b64(tag)}`;
}

export function verificarSenha(senha: string, phc: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return false;
  const [, mem, t, p, sal, hash] = m as unknown as [string, string, string, string, string, string];
  const esperado = Buffer.from(hash, 'base64');
  const tag = argon2()('argon2id', {
    message: senha,
    nonce: Buffer.from(sal, 'base64'),
    memory: Number(mem),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: esperado.length,
  });
  return crypto.timingSafeEqual(tag, esperado);
}
