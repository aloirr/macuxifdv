import { redirect } from 'next/navigation';

import { INICIO_DO_BKO } from '@/lib/portal';

/**
 * Raiz `/` (ADR 0071 §3): o Início do BKO mora em `/bko`. Quem redireciona é o `proxy.ts` (307, antes de renderizar); esta
 * página só cobre o caso de a requisição chegar sem passar por ele.
 */
export default function Raiz(): never {
  redirect(INICIO_DO_BKO);
}
