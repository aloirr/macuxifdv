import type { Metadata } from 'next';
import { TelaConvite } from '@/components/tela-convite';

/** Sem indexação e sem `Referer`: o token está no endereço (o proxy.ts também manda os cabeçalhos). */
export const metadata: Metadata = { title: 'Criar senha', referrer: 'no-referrer', robots: { index: false, follow: false } };

/**
 * Formato antigo do link do convite (`/convite/<token>`, T-0087 fatia E): continua aceito; a tela tira o token do endereço na
 * chegada. O formato combinado é `/convite#<token>` (app/convite/page.tsx).
 */
export default async function ConviteNoCaminhoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TelaConvite tokenDoCaminho={token} />;
}
