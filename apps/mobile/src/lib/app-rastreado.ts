/**
 * T-0187 §1.2 (RN-CORE-13 e RN-CORE-37): o app em que cada cargo é rastreado, do Core (`APP_RASTREADO_DO_CARGO` de
 * `@macuxi/core/contracts`: vendedor e promotor no Campo, supervisor no Gestão). Com ele o shell sabe a quem pedir a localização
 * "o tempo todo" no Gestão.
 *
 * Adaptação mínima: enquanto o portão novo do modulo-core não chega ao `main`, o contrato ainda não exporta a constante e o
 * mapa fica vazio. Nada muda no Gestão até lá (o `podeRastrear` também recusa o app Gestão). Quando a exportação existir, o
 * shell passa a usá-la sem mudança aqui; depois disso, este arquivo pode virar o import direto.
 */
import * as contratosDoCore from '@macuxi/core/contracts';

import type { AppDoCargo } from './permissoes';

export const APP_RASTREADO_DO_CARGO: AppDoCargo =
  (contratosDoCore as unknown as { APP_RASTREADO_DO_CARGO?: AppDoCargo }).APP_RASTREADO_DO_CARGO ?? {};
