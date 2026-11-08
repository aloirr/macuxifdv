/**
 * Cifra da carga da outbox de e-mail (T-0094; ADR 0032; desenho §10 item 1; RN-CORE-34): AES-256-GCM do destinatário e dos
 * dados do modelo (`CargaEmail`) antes do `insert` em `plataforma.email_saida.carga` (`bytea`). O banco nunca guarda e-mail, nome
 * ou senha em claro.
 *
 * Formato (bytes): `0x01` (versão) | IV (12, aleatório por cifra) | tag (16) | texto cifrado. Dado associado (AAD) =
 * `id|tenant_id|modelo` da linha: a carga de uma linha não decifra em outra (troca de carga entre linhas ou tenants é detectada).
 * Chave: `derivarChaveEmail(MACUXI_JWT_SEGREDO)` (`config.ts`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CODIGOS_EMAIL, validarCargaEmail, type CargaEmail, type ModeloEmail } from '@macuxi/platform-sdk';
import { ErroEmail } from './erros';

const VERSAO = 0x01;
const ALGORITMO = 'aes-256-gcm';
const TAM_IV = 12;
const TAM_TAG = 16;

/** O que amarra a carga à linha da outbox. */
export interface AadEmail {
  id: string;
  tenant_id: string;
  modelo: ModeloEmail;
}

export interface CifraEmail {
  cifrar(carga: CargaEmail, aad: AadEmail): Buffer;
  /** Lança `ErroEmail` `EMAIL_CIFRA_INVALIDA` (não retentável) se a carga não decifra ou não valida. */
  decifrar(carga: Uint8Array, aad: AadEmail): CargaEmail;
}

const aadDe = (a: AadEmail) => Buffer.from(`${a.id.toLowerCase()}|${a.tenant_id.toLowerCase()}|${a.modelo}`, 'utf8');

function erroCifra(motivo: string): ErroEmail {
  return new ErroEmail(CODIGOS_EMAIL.CIFRA_INVALIDA, `carga do e-mail ${motivo}`, { retentavel: false, etapa: 'cifra' });
}

export function criarCifraEmail(chave: Uint8Array): CifraEmail {
  if (chave.length !== 32) throw new ErroEmail(CODIGOS_EMAIL.CONFIG_INVALIDA, 'chave da outbox de e-mail deve ter 32 bytes', { retentavel: false, etapa: 'config' });
  const k = Buffer.from(chave);
  return {
    cifrar(carga, aad) {
      const iv = randomBytes(TAM_IV);
      const c = createCipheriv(ALGORITMO, k, iv);
      c.setAAD(aadDe(aad));
      const cifrado = Buffer.concat([c.update(JSON.stringify(carga), 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([VERSAO]), iv, c.getAuthTag(), cifrado]);
    },
    decifrar(bruto, aad) {
      const b = Buffer.from(bruto);
      if (b.length < 1 + TAM_IV + TAM_TAG + 1 || b[0] !== VERSAO) throw erroCifra('em formato desconhecido');
      let texto: string;
      try {
        const d = createDecipheriv(ALGORITMO, k, b.subarray(1, 1 + TAM_IV));
        d.setAAD(aadDe(aad));
        d.setAuthTag(b.subarray(1 + TAM_IV, 1 + TAM_IV + TAM_TAG));
        texto = Buffer.concat([d.update(b.subarray(1 + TAM_IV + TAM_TAG)), d.final()]).toString('utf8');
      } catch {
        throw erroCifra('não decifra (segredo diferente ou adulterada)');
      }
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        throw erroCifra('decifrada não é JSON');
      }
      try {
        return validarCargaEmail(aad.modelo, json);
      } catch {
        throw erroCifra('decifrada não valida');
      }
    },
  };
}
