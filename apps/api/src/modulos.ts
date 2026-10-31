/**
 * Módulos instalados na API (os 8 do produto). Cada módulo exporta de `modules/<m>/api/index.ts`
 *   export const moduloApi = definirModuloApi({ manifesto, rotas, sync });   (o `default` também vale)
 * Enquanto o módulo não exporta `moduloApi`, a API conhece só o manifesto (sem rotas): a licença,
 * o registro de sync e as ações já valem. Para instalar um módulo novo: uma linha aqui e o pacote no package.json.
 * Desenho T-0004 §3.
 */
import * as apiCatalogo from '@macuxi/catalogo/api';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import * as apiCore from '@macuxi/core/api';
import { manifest as core } from '@macuxi/core/manifest';
import * as apiGestor from '@macuxi/gestor/api';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import * as apiIntegracao from '@macuxi/integracao/api';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import * as apiPesquisa from '@macuxi/pesquisa/api';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { definirModuloApi, type Manifesto, type ModuloApi } from '@macuxi/platform-sdk';
import * as apiPromotor from '@macuxi/promotor/api';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import * as apiTreinamento from '@macuxi/treinamento/api';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import * as apiVendedor from '@macuxi/vendedor/api';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';

/** `moduloApi` (ou o `default`) exportado pelo módulo ou, sem ele, só o manifesto. */
export function registroApi(manifesto: Manifesto, exportado: unknown): ModuloApi {
  const e = exportado as { moduloApi?: ModuloApi; default?: ModuloApi } | undefined;
  const m = e?.moduloApi ?? e?.default;
  if (m && m.manifesto.id !== manifesto.id) throw new Error(`moduloApi de ${manifesto.id} aponta para ${m.manifesto.id}`);
  return m ?? definirModuloApi({ manifesto });
}

export const MODULOS_API: readonly ModuloApi[] = [
  registroApi(core, apiCore),
  registroApi(catalogo, apiCatalogo),
  registroApi(vendedor, apiVendedor),
  registroApi(promotor, apiPromotor),
  registroApi(gestor, apiGestor),
  registroApi(pesquisa, apiPesquisa),
  registroApi(treinamento, apiTreinamento),
  registroApi(integracao, apiIntegracao),
];
