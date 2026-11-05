/**
 * Verificador SCRAM-SHA-256 calculado no cliente (dono: banco-dados). Mesmo algoritmo de db/dbaas/relatorio.ts
 * (verificadorScram do teste do DBaaS, T-0075); fica aqui para o @macuxi/db não depender do script do DBaaS.
 *
 * Formato do pg_authid: `SCRAM-SHA-256$<iteracoes>:<sal base64>$<StoredKey base64>:<ServerKey base64>` (RFC 5802/7677).
 * O CREATE/ALTER ROLE ... PASSWORD que leva o verificador guarda exatamente o que o servidor guardaria com
 * password_encryption = scram-sha-256, e a senha em texto nunca chega ao servidor (nem a log_statement/pgaudit).
 * Só ASCII imprimível sem espaço: dispensa o SASLprep (RFC 4013), que o servidor aplicaria a outros caracteres.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** Senha que o verificador calculado no cliente cobre sem SASLprep (ASCII 0x21..0x7e). */
export const senhaAceitaPeloScramLocal = (senha: string): boolean => /^[\x21-\x7e]+$/.test(senha);

export function verificadorScram(senha: string, sal: Buffer = randomBytes(16), iteracoes = 4096): string {
  if (!senhaAceitaPeloScramLocal(senha)) throw new Error('verificadorScram: só senha ASCII imprimível, sem espaço');
  if (!Number.isInteger(iteracoes) || iteracoes < 1) throw new Error('verificadorScram: iterações inválidas');
  const salgada = pbkdf2Sync(senha, sal, iteracoes, 32, 'sha256');
  const chaveCliente = createHmac('sha256', salgada).update('Client Key').digest();
  const chaveGuardada = createHash('sha256').update(chaveCliente).digest();
  const chaveServidor = createHmac('sha256', salgada).update('Server Key').digest();
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString('base64')}$${chaveGuardada.toString('base64')}:${chaveServidor.toString('base64')}`;
}
