import type { Metadata } from 'next';
import { TelaEscolherEmpresa } from '@/components/portal/tela-escolher-empresa';

export const metadata: Metadata = { title: 'Escolha a empresa' };

/** Admin do cliente com 2+ empresas escolhe em qual entrar (T-0093; ADR 0031). */
export default function EscolherEmpresaPage() {
  return <TelaEscolherEmpresa />;
}
