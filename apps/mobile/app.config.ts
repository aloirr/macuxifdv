/**
 * Config dinâmica do Expo com as duas variantes do shell (docs/produto/04):
 *  - APP_VARIANT=campo  → "Macuxi Campo"  (vendedor/promotor)
 *  - APP_VARIANT=gestao → "Macuxi Gestão" (supervisor/gerente)
 * Mesmo código e mesmo projeto EAS; nome, pacote Android e scheme diferentes para conviverem no aparelho.
 * Perfis de build em eas.json. Base copiada do app.json da Fase M.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

type Variante = 'campo' | 'gestao';

const VARIANTES: Record<Variante, { nome: string; pacote: string; scheme: string }> = {
  campo: { nome: 'Macuxi Campo', pacote: 'br.com.macuxi.campo', scheme: 'macuxicampo' },
  gestao: { nome: 'Macuxi Gestão', pacote: 'br.com.macuxi.gestao', scheme: 'macuxigestao' },
};

function variante(): Variante {
  const v = process.env.APP_VARIANT ?? 'campo';
  if (v !== 'campo' && v !== 'gestao') throw new Error(`APP_VARIANT inválida: ${v} (use campo ou gestao)`);
  return v;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const id = variante();
  const v = VARIANTES[id];
  return {
    ...config,
    name: v.nome,
    slug: 'macuxi-fdv',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: v.scheme,
    userInterfaceStyle: 'light',
    ios: { icon: './assets/expo.icon' },
    android: {
      package: v.pacote,
      adaptiveIcon: {
        backgroundColor: '#F3F4F1',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'],
    },
    web: { output: 'single', favicon: './assets/images/favicon.png', name: v.nome },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { backgroundColor: '#F3F4F1', image: './assets/images/splash-icon.png', imageWidth: 76 }],
      ['expo-location', { locationWhenInUsePermission: `O ${v.nome} usa a localização para registrar o check-in na visita ao cliente.` }],
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      router: {},
      variante: id,
      eas: { projectId: '48bb6c9b-e9ae-46af-ae98-abe16b450446' },
    },
    owner: 'macuxifdv',
  };
};
