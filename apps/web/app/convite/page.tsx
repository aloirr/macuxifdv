import type { Metadata } from 'next';
import { TelaConvite } from '@/components/tela-convite';

/** Sem indexação e sem `Referer` (o proxy.ts também manda os cabeçalhos). */
export const metadata: Metadata = { title: 'Criar senha', referrer: 'no-referrer', robots: { index: false, follow: false } };

/**
 * Aceite do convite de 1º acesso (T-0087 fatia E; RN-CORE-31): `/convite#<token>` (R-20261106-044125: o token no fragmento não
 * chega ao servidor). Página pública do BKO, fora do layout com sessão; a pessoa cria a senha e segue para o login normal.
 */
export default function ConvitePage() {
  return <TelaConvite />;
}
