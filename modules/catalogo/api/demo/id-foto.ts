import { createHash } from 'node:crypto';

/** UUID estável por produto (mesmo produto, mesmo id e mesmos bytes: a carga repetida da foto não duplica). */
export function idDaFoto(produtoId: string): string {
  const h = createHash('sha256').update(`macuxi:demo:foto:${produtoId.toLowerCase()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
