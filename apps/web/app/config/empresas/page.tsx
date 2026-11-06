import type { Metadata } from 'next';
import { TelaEmpresas } from '@/components/portal/tela-empresas';

export const metadata: Metadata = { title: 'Empresas' };

/** Lista das empresas cliente (T-0087). */
export default function EmpresasPage() {
  return <TelaEmpresas />;
}
