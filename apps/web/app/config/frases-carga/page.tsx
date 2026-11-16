import type { Metadata } from 'next';
import { TelaFrasesCarga } from '@/components/portal/tela-frases-carga';

export const metadata: Metadata = { title: 'Frases da carga' };

/** Portal › Frases da carga (T-0181, spec docs/design/carga-aviso-frases/spec.md §3): só o time da Macuxi. */
export default function FrasesCargaPage() {
  return <TelaFrasesCarga />;
}
