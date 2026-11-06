import type { Metadata } from 'next';
import { TelaPrimeiroAcesso } from '@/components/portal/tela-primeiro-acesso';

export const metadata: Metadata = { title: 'Primeiro acesso' };

/** Primeiro acesso do super-admin por convite + cadastro do TOTP (T-0087; ADR 0029 §2). */
export default function PrimeiroAcessoPage() {
  return <TelaPrimeiroAcesso />;
}
