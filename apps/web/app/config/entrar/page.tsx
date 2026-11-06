import type { Metadata } from 'next';
import { TelaEntrar } from '@/components/portal/tela-entrar';

export const metadata: Metadata = { title: 'Entrar' };

/** Entrada do super-admin com 2º fator (T-0087; ADR 0029). */
export default function EntrarPage() {
  return <TelaEntrar />;
}
