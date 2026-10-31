/** Variante do shell em execução (definida por APP_VARIANT no build; ver app.config.ts). */
import Constants from 'expo-constants';

import type { Variante } from './variante-tipo';

export type { Variante } from './variante-tipo';

export function varianteAtual(): Variante {
  const v = (Constants.expoConfig?.extra as { variante?: string } | undefined)?.variante;
  return v === 'gestao' ? 'gestao' : 'campo';
}
