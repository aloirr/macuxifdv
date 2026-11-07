import type { Metadata } from 'next';
import { TelaNovaEmpresa } from '@/components/portal/tela-empresas';

export const metadata: Metadata = { title: 'Nova empresa' };

/** Passo Empresa (T-0087 §2): por baixo, o tenant:criar da T-0083. */
export default function NovaEmpresaPage() {
  return <TelaNovaEmpresa />;
}
