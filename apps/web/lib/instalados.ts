/**
 * Os 8 módulos instalados no BKO (só os manifestos: puro, roda em Node nos testes). `modulos.ts` junta cada
 * manifesto ao `moduloWeb` do módulo (páginas); quem não tem `web/` entra sem páginas. Desenho T-0004 §2.
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

export const MANIFESTOS_INSTALADOS: readonly Manifesto[] = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];
