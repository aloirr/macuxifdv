/**
 * Conferência do pacote baixado (T-0116): SHA-256 do arquivo igual ao anunciado pela política do Hub e assinatura
 * destacada (base64) válida para uma chave PÚBLICA embutida (`chaves.ts`). Função sem I/O: recebe os bytes já baixados,
 * e são esses mesmos bytes que vão para a extração (sem janela entre conferir e usar).
 *
 * O que é assinado: os bytes do arquivo do pacote (`.zip`), como no `openssl dgst -sha256 -sign` da v1 (§7.4).
 * Ed25519 assina os bytes direto (Ed25519 puro); RSA usa SHA-256 com PKCS#1 v1.5.
 */
import { createHash, createPublicKey, verify, constants, type KeyObject } from 'node:crypto';
import type { PacoteConector } from '@macuxi/integracao/contracts';
import type { MotivoMantido } from './resultado';

export type ConferenciaPacote = { ok: true; chaveId: string } | { ok: false; motivo: MotivoMantido };

/** RSA abaixo disso é recusado (o pacote da v1 usa 3072). */
export const RSA_BITS_MINIMO = 3072;

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Escolhe a chave: pelo id do pacote; sem id, só se houver exatamente uma chave embutida. */
function escolherChave(
  pacote: PacoteConector,
  chaves: Readonly<Record<string, string>>,
): [string, string] | null {
  const id = pacote.chave_publica_id ?? undefined;
  if (id !== undefined) {
    const pem = Object.hasOwn(chaves, id) ? chaves[id] : undefined;
    return pem ? [id, pem] : null;
  }
  const todas = Object.entries(chaves);
  return todas.length === 1 ? (todas[0] as [string, string]) : null;
}

function lerChavePublica(pem: string): KeyObject | null {
  // createPublicKey deriva a pública de uma PRIVADA sem reclamar: recusar deixa o erro (segredo embutido) à vista
  if (!pem.trimStart().startsWith('-----BEGIN PUBLIC KEY-----')) return null;
  try {
    const k = createPublicKey(pem);
    if (k.asymmetricKeyType === 'ed25519') return k;
    if (k.asymmetricKeyType === 'rsa' && (k.asymmetricKeyDetails?.modulusLength ?? 0) >= RSA_BITS_MINIMO)
      return k;
    return null;
  } catch {
    return null;
  }
}

const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function conferirPacote(
  bytes: Uint8Array,
  pacote: PacoteConector,
  chaves: Readonly<Record<string, string>>,
): ConferenciaPacote {
  if (sha256Hex(bytes) !== pacote.sha256) return { ok: false, motivo: 'sha256_diferente' };
  const assinatura = pacote.assinatura?.trim();
  if (!assinatura) return { ok: false, motivo: 'assinatura_ausente' };
  if (!RE_BASE64.test(assinatura)) return { ok: false, motivo: 'assinatura_invalida' };
  const escolhida = escolherChave(pacote, chaves);
  if (!escolhida) return { ok: false, motivo: 'chave_desconhecida' };
  const [chaveId, pem] = escolhida;
  const chave = lerChavePublica(pem);
  if (!chave) return { ok: false, motivo: 'chave_invalida' };
  const sig = Buffer.from(assinatura, 'base64');
  let valida = false;
  try {
    valida =
      chave.asymmetricKeyType === 'ed25519'
        ? verify(null, bytes, chave, sig)
        : verify('sha256', bytes, { key: chave, padding: constants.RSA_PKCS1_PADDING }, sig);
  } catch {
    valida = false;
  }
  return valida ? { ok: true, chaveId } : { ok: false, motivo: 'assinatura_invalida' };
}
