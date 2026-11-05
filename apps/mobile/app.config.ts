/**
 * Config dinâmica do Expo com as duas variantes do shell (docs/produto/04):
 *  - APP_VARIANT=campo  → "Macuxi Campo"  (vendedor/promotor)
 *  - APP_VARIANT=gestao → "Macuxi Gestão" (supervisor/gerente)
 * Mesmo código e mesmo projeto EAS; nome, pacote Android e scheme diferentes para conviverem no aparelho.
 * Perfis de build em eas.json (desenho T-0004 §7): `campo`/`gestao` = build de desenvolvimento (APK com
 * expo-dev-client, JS servido pelo `expo start`); `*-preview` = APK interno sem Metro; `*-producao` = AAB.
 * Endereço da API por perfil (T-0038, doc 04 "Domínio e endereços"): `EXPO_PUBLIC_API_URL` (api-demo no dev e no
 * preview; api.macuxifdv.com.br no producao) e `EXPO_PUBLIC_PERFIL_BUILD` (desenvolvimento|preview|producao), que
 * decide se o login tem o campo Servidor (`src/lib/endereco-do-build.ts`). No dev o JS vem do Metro do PC: valem as
 * variáveis de quem roda o `expo start`.
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

/**
 * Pacote instalado no node_modules? (T-0008 P4/P7: o plugin do expo-sqlite só entra quando o engenheiro-software
 * instalar o pacote; sem ele, o `expo export`/`prebuild` falharia ao resolver o plugin.)
 */
function instalado(pacote: string): boolean {
  try {
    require.resolve(`${pacote}/package.json`);
    return true;
  } catch {
    return false;
  }
}

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
      // RN-CORE-23 / T-0065: push pelo FCM. O arquivo vem da variável de arquivo GOOGLE_SERVICES_JSON do EAS (configurada
      // pelo dono do produto); nenhum agente lê nem commita o google-services.json. Sem a variável (build de
      // desenvolvimento), o app compila sem push e segue com o botão Sincronizar e a atualização automática.
      ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
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
      // ADR 0017: sincronização incremental em segundo plano (WorkManager no Android; o plugin só mexe no iOS)
      'expo-background-task',
      // RN-CORE-23 item 3 / RF-CORE-09: push visível (abre a tela certa) e silencioso (dispara o motor de sync)
      ['expo-notifications', { icon: './assets/images/android-icon-monochrome.png', color: '#C2540A', defaultChannel: 'avisos' }],
      // ADR 0003 / T-0008 §3.1: SQLite do aparelho com FTS5 explícito (busca offline do Catálogo; tela de diagnóstico)
      ...(instalado('expo-sqlite') ? ([['expo-sqlite', { enableFTS: true }]] as [string, unknown][]) : []),
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
