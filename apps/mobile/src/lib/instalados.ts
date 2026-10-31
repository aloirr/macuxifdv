/**
 * Os 8 módulos instalados no app (só os manifestos: puro, roda em Node nos testes).
 * Cada variante mostra só os módulos que declaram `apps.<variante>` no manifesto (desenho T-0004 §2):
 * Campo (vendedor/promotor) e Gestão (supervisor/gerente). O BKO e o Conector ficam fora do app.
 * `modulos.ts` junta cada manifesto ao `moduloApp` do módulo (telas); quem não tem `app/` entra sem telas.
 */
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import type { Manifesto } from '@macuxi/platform-sdk';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';

import type { Variante } from './variante-tipo';

export const MANIFESTOS_INSTALADOS: readonly Manifesto[] = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];

/** Módulos que podem aparecer na variante (os demais nunca montam abas nela, mesmo licenciados). */
export function modulosDaVariante(variante: Variante): Manifesto['id'][] {
  return MANIFESTOS_INSTALADOS.filter((m) => !!m.apps[variante]).map((m) => m.id);
}
