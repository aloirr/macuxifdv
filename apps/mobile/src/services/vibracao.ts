/**
 * Liga o expo-haptics à vibração leve do kit (T-0072). Único ponto do app que importa expo-haptics: os módulos e o
 * kit chamam `vibrarLeve()` de `@macuxi/ui/mobile`, e a regra (reduzir movimento, plataforma) fica em `@/lib/vibracao`.
 */
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { definirVibracao } from '@macuxi/ui/mobile';
import { impactoDoSegurar, montarVibracao, type MotorTatil } from '@/lib/vibracao';

const motorExpo: MotorTatil = {
  android: (tipo) => Haptics.performAndroidHapticsAsync(tipo === 'confirmar' ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Virtual_Key),
  impactoLeve: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};

/** Registra (e troca ao vivo) a vibração do kit conforme o "reduzir movimento" do aparelho. */
export function useVibracaoDoShell(reduzirMovimento: boolean): void {
  useEffect(() => {
    definirVibracao(montarVibracao(Platform.OS, reduzirMovimento, motorExpo, Platform.Version));
    return () => definirVibracao(null);
  }, [reduzirMovimento]);
}

/** R-20261115-100000: vibração do segurar o Sincronizar (leve = Light, media = Medium); muda com "reduzir movimento". */
export function vibrarSegurar(forca: 'leve' | 'media', reduzirMovimento: boolean): void {
  const impacto = impactoDoSegurar(forca, Platform.OS, reduzirMovimento);
  if (!impacto) return;
  void Haptics.impactAsync(
    impacto === 'media' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
  ).catch(() => undefined);
}
