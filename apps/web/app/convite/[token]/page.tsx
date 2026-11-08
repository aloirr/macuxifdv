import type { Metadata } from 'next';
import { AvisoLinkAntigo } from '@/components/aviso-link-antigo';

export const metadata: Metadata = { title: 'Link antigo', referrer: 'no-referrer', robots: { index: false, follow: false } };

/** Formato antigo do link (`/convite/<token>`, T-0087): o token não é lido; o mesmo aviso de `/convite`. */
export default function ConviteNoCaminhoPage() {
  return <AvisoLinkAntigo />;
}
