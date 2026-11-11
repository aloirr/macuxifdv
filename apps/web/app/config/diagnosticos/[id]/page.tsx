import type { Metadata } from 'next';
import { TelaDiagnostico } from '@/components/portal/tela-diagnosticos';

export const metadata: Metadata = { title: 'Diagnóstico' };

/** Detalhe técnico de um diagnóstico (T-0158, ADR 0043): relato, saídas do Android, último erro, origem, print e recado. */
export default async function DiagnosticoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TelaDiagnostico id={id} />;
}
