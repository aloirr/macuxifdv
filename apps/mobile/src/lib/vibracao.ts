/**
 * Vibração leve do shell (T-0072, docs/design/componentes.md §6). Regra PURA, sem expo-haptics: roda no Vitest.
 *
 * O kit (`@macuxi/ui/mobile`) decide ONDE vibra (botão principal, confirmar do diálogo e da folha, Desfazer; nunca em
 * navegação nem rolagem) e chama `vibrarLeve()`. O shell decide SE e COMO vibra, registrando com `definirVibracao`
 * a função montada aqui. Os módulos não importam expo-haptics.
 *
 * - "Reduzir movimento" ligado no aparelho: não vibra (janela aprovada pelo Alexandre, R-20261104-231036).
 * - Android: usa o retorno tátil do sistema (`View.performHapticFeedback`), que respeita a opção "Retorno tátil /
 *   vibração ao tocar" do aparelho e não depende da permissão VIBRATE. `Confirm` existe no Android 11+ (API 30); nos
 *   anteriores usa direto `Virtual_Key` (o toque de tecla do sistema), escolhido pela VERSÃO: no Android 10 a constante
 *   desconhecida costuma devolver `false` sem erro e o aparelho ficaria mudo (R-20261104-234713, Y1). Se o `Confirm`
 *   ainda assim rejeitar num Android 11+, cai para `Virtual_Key`.
 * - iOS: impacto leve (o próprio iOS respeita a opção do sistema).
 * - Web (demonstração no navegador): não vibra.
 */
export type Plataforma = 'android' | 'ios' | 'web' | string;

export interface MotorTatil {
  /** Retorno tátil do sistema no Android (`performAndroidHapticsAsync`). */
  android: (tipo: 'confirmar' | 'tecla') => Promise<unknown>;
  /** Impacto leve no iOS (`impactAsync(Light)`). */
  impactoLeve: () => Promise<unknown>;
}

/** Primeira versão do Android (nível de API) com `HapticFeedbackConstants.CONFIRM`. */
export const API_ANDROID_CONFIRMAR = 30;

/**
 * Função para `definirVibracao`; `null` = não vibra (o kit fica mudo, nada quebra). `versaoAndroid` = nível de API
 * (`Platform.Version` no Android); desconhecida = trata como antiga (`Virtual_Key` vibra em todas).
 */
export function montarVibracao(
  plataforma: Plataforma,
  reduzirMovimento: boolean,
  motor: MotorTatil,
  versaoAndroid?: number | string | null,
): (() => Promise<unknown>) | null {
  if (reduzirMovimento) return null;
  if (plataforma === 'android') {
    const api = typeof versaoAndroid === 'number' ? versaoAndroid : Number(versaoAndroid);
    if (!Number.isFinite(api) || api < API_ANDROID_CONFIRMAR) return () => motor.android('tecla');
    return () => motor.android('confirmar').catch(() => motor.android('tecla'));
  }
  if (plataforma === 'ios') return () => motor.impactoLeve();
  return null;
}
