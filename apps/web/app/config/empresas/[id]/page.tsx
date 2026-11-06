import type { Metadata } from 'next';
import { TelaEmpresa } from '@/components/portal/tela-empresa';

export const metadata: Metadata = { title: 'Empresa' };

/** Empresa: cartões das bases, Integração automática e o resumo (T-0087 §3 e §6). */
export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TelaEmpresa id={id} />;
}
