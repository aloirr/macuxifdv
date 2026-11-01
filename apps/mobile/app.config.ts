/**
 * Config dinâmica do Expo com as duas variantes do shell (docs/produto/04):
 *  - APP_VARIANT=campo  → "Macuxi Campo"  (vendedor/promotor)
 *  - APP_VARIANT=gestao → "Macuxi Gestão" (supervisor/gerente)
 * Mesmo código e mesmo projeto EAS; nome, pacote Android e scheme diferentes para conviverem no aparelho.
 * Perfis de build em eas.json (desenho T-0004 §7): `campo`/`gestao` = build de desenvolvimento (APK com
 * expo-dev-client, JS servido pelo `expo start`); `*-preview` = APK interno sem Metro; `*-producao` = AAB.
 * Ícone por variante: hoje a mesma arte nas duas (a da Gestão é pendência de design); troca só aqui.
 * Base copiada do app.json da Fase M.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

type Variante = 'campo' | 'gestao';

interface DadosVariante {
  nome: string;
  pacote: string;
  scheme: string;
  icone: string;
  iconeFrente: string;
  iconeFundo: string;
}

const ICONE_PADRAO = {
  icone: './assets/images/icon.png',
  iconeFrente: './assets/images/android-icon-foreground.png',
  iconeFundo: './assets/images/android-icon-background.png',
};

const VARIANTES: Record<Variante, DadosVariante> = {
  campo: { nome: 'Macuxi Campo', pacote: 'br.com.macuxi.campo', scheme: 'macuxicampo', ...ICONE_PADRAO },
  gestao: { nome: 'Macuxi Gestão', pacote: 'br.com.macuxi.gestao', scheme: 'macuxigestao', ...ICONE_PADRAO },
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
    icon: v.icone,
    scheme: v.scheme,
    userInterfaceStyle: 'light',
    ios: { icon: './assets/expo.icon' },
    android: {
      package: v.pacote,
      adaptiveIcon: {
        backgroundColor: '#F3F4F1',
        foregroundImage: v.iconeFrente,
        backgroundImage: v.iconeFundo,
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // teclado (R-20261101-023401-alexandre): adjustResize explícito; no edge-to-edge (Android 15+) a janela não
      // encolhe, então as telas com campo embaixo usam KeyboardAvoidingView (login.tsx), que mede o quanto o teclado cobre
      softwareKeyboardLayoutMode: 'resize',
      permissions: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.CAMERA'],
      // sem gravação de áudio (a câmera só tira foto: fachada do cliente fechado, RN-CORE-14)
      blockedPermissions: ['android.permission.RECORD_AUDIO'],
    },
    web: { output: 'single', favicon: './assets/images/favicon.png', name: v.nome },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { backgroundColor: '#F3F4F1', image: './assets/images/splash-icon.png', imageWidth: 76 }],
      ['expo-location', { locationWhenInUsePermission: `O ${v.nome} usa a localização para registrar o check-in na visita ao cliente.` }],
      // câmera: foto da fachada do cliente fechado (RN-CORE-14); sem galeria e sem microfone
      ['expo-image-picker', { cameraPermission: `O ${v.nome} usa a câmera para fotografar a fachada do cliente quando a loja está fechada.`, photosPermission: false, microphonePermission: false }],
      // tokens da sessão no armazenamento seguro do Android (Keystore)
      'expo-secure-store',
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
