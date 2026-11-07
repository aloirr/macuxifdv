/**
 * Cifra da carga da fila de e-mail (T-0094, RN-CORE-34): AES-256-GCM do pedido (destinatário + dados) antes de ir para o
 * job. O banco (tabela do pg-boss) nunca guarda e-mail, nome ou senha em claro.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>` (base64url; IV de 12 bytes aleatório por cifra). O `idEnvio` entra como dado
 * associado (AAD): a carga de um job não decifra em outro (troca de carga entre jobs é detectada).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CODIGOS_EMAIL, PedidoEmailSchema, type PedidoEmail } from '@macuxi/platform-sdk';
import { ErroEmail } from './erros';

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';

export interface CifraEmail {
  cifrar(pedido: PedidoEmail, idEnvio: string): string;
  /** Lança `ErroEmail` `EMAIL_CIFRA_INVALIDA` (não retentável) se a carga não decifra ou não valida. */
  decifrar(carga: string, idEnvio: string): PedidoEmail;
}

function erroCifra(motivo: string): ErroEmail {
  return new ErroEmail(CODIGOS_EMAIL.CIFRA_INVALIDA, `carga do e-mail ${motivo}`, { retentavel: false, etapa: 'cifra' });
}

export function criarCifraEmail(chave: Uint8Array): CifraEmail {
  if (chave.length !== 32) throw new ErroEmail(CODIGOS_EMAIL.CONFIG_INVALIDA, 'chave da fila de e-mail deve ter 32 bytes', { retentavel: false, etapa: 'config' });
  const k = Buffer.from(chave);
  return {
    cifrar(pedido, idEnvio) {
      const iv = randomBytes(12);
      const c = createCipheriv(ALGORITMO, k, iv);
      c.setAAD(Buffer.from(idEnvio, 'utf8'));
      const cifrado = Buffer.concat([c.update(JSON.stringify(pedido), 'utf8'), c.final()]);
      return [VERSAO, iv.toString('base64url'), c.getAuthTag().toString('base64url'), cifrado.toString('base64url')].join('.');
    },
    decifrar(carga, idEnvio) {
      const partes = typeof carga === 'string' ? carga.split('.') : [];
      if (partes.length !== 4 || partes[0] !== VERSAO) throw erroCifra('em formato desconhecido');
      const [, ivB, tagB, dadosB] = partes as [string, string, string, string];
      let texto: string;
      try {
        const iv = Buffer.from(ivB, 'base64url');
        const tag = Buffer.from(tagB, 'base64url');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('tamanho');
        const d = createDecipheriv(ALGORITMO, k, iv);
        d.setAAD(Buffer.from(idEnvio, 'utf8'));
        d.setAuthTag(tag);
        texto = Buffer.concat([d.update(Buffer.from(dadosB, 'base64url')), d.final()]).toString('utf8');
      } catch {
        throw erroCifra('não decifra (chave diferente ou adulterada)');
      }
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        throw erroCifra('decifrada não é JSON');
      }
      const r = PedidoEmailSchema.safeParse(json);
      if (!r.success) throw erroCifra('decifrada não valida');
      return r.data;
    },
  };
}
