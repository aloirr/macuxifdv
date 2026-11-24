'use client';

import { PaginaInicio } from '@/components/inicio-page';

/** Início do BKO (T-0189, RN-CORE-64; ADR 0068 §3): `/bko` monta o Início do Core. A raiz `/` redireciona para cá. */
export default function Inicio() {
  return <PaginaInicio />;
}
