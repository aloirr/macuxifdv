import type { Metadata } from 'next';
import { AvisoLinkAntigo } from '@/components/aviso-link-antigo';

/** Sem indexação e sem `Referer` (o proxy.ts também manda os cabeçalhos). */
export const metadata: Metadata = { title: 'Link antigo', referrer: 'no-referrer', robots: { index: false, follow: false } };

/** Links de convite antigos (T-0087): o convite saiu na T-0094; a página só avisa e leva à entrada. */
export default function ConvitePage() {
  return <AvisoLinkAntigo />;
}
