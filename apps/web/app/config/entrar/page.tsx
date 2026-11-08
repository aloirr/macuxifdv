import type { Metadata } from 'next';
import { TelaEntrar } from '@/components/portal/tela-entrar';

export const metadata: Metadata = { title: 'Entrar' };

/** Entrada do portal só com e-mail e senha (T-0093; ADR 0031). */
export default function EntrarPage() {
  return <TelaEntrar />;
}
