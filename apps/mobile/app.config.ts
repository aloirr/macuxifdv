/**
 * Config dinâmica do Expo com as duas variantes do shell (docs/produto/04):
 *  - APP_VARIANT=campo  → "Macuxi Campo"  (vendedor/promotor)
 *  - APP_VARIANT=gestao → "Macuxi Gestão" (supervisor/gerente)
 * Mesmo código; nome, pacote Android e scheme diferentes para conviverem no aparelho. Sem conta da Expo
 * (R-20261115-091000): sem `extra.eas.projectId`, sem `owner` e sem OTA; o build é o android-build.yml do Actions,
 * que lê os perfis do eas.json (`scripts/ci/android-build.mjs`).
 * Perfis de build em eas.json: só `campo-producao`/`gestao-producao` (T-0086; os perfis de desenvolvimento e preview
 * saíram com a demo) = APK de distribuição direta (nenhuma keystore no repositório) e API
 * `https://api.macuxifdv.com.br/v1`. O Google Play (AAB) fica para depois.
 * Nome e ícone são os mesmos em todos os builds ("Macuxi Campo"/"Macuxi Gestão"): o pacote é um só por variante.
 * Endereço da API (T-0038, doc 04 "Domínio e endereços"): `EXPO_PUBLIC_API_URL` e `EXPO_PUBLIC_PERFIL_BUILD`
 * (`producao` no eas.json), que decide se o login tem o campo Servidor (`src/lib/endereco-do-build.ts`). No `expo start`
 * local valem as variáveis de quem roda o Metro (sem a flag, o bundle de desenvolvimento edita o servidor).
 * Ícone e splash por variante (marca v1, T-0172; arquivos de docs/marca/ativos/2026-11-12-v1/): Campo no Azul noite
 * `#1E3350` (logo negativo) e Gestão no Pérola `#F8F6F1` (logo positivo); monocromático e notificação iguais nas duas,
 * cor da notificação `#1E3350`. A tela de entrada do JS (`components/tela-entrada.tsx`) repete o fundo e o logo da splash
 * no mesmo lugar e no mesmo tamanho (`LARGURA_LOGO_ENTRADA`), para a passagem não ter corte.
 * Versão (T-0109): `version` vem de `scripts/eas/versao.json` (fonte única, igual nas duas variantes e em todos os
 * perfis) e o `android.versionCode` não fica aqui: o android-build o deriva da versão ou recebe do input. Nome do build (`Campo-Oficial-v1.0.0`) em `src/lib/nome-build.ts`.
 * Base copiada do app.json da Fase M.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

// JSON e não import de src/: o Expo carrega este arquivo sem resolver import de .ts relativo
import versaoDoArquivo from './scripts/eas/versao.json';

type Variante = 'campo' | 'gestao';

interface DadosVariante {
  nome: string;
  pacote: string;
  scheme: string;
  icone: string;
  iconeFrente: string;
  iconeFundo: string;
  /** Fundo do ícone adaptativo e da splash. */
  fundo: string;
  splash: string;
}

/** Azul noite e Pérola da marca v1 (docs/marca/manual.md §3). */
const AZUL_NOITE = '#1E3350';
const PEROLA = '#F8F6F1';

/**
 * Largura do logo na splash, em dp. A mesma de `LARGURA_LOGO_ENTRADA` (src/lib/entrada.ts): o Expo carrega este arquivo
 * sem resolver import de .ts relativo, por isso o número se repete (o teste de src/lib/entrada.test.ts confere os dois).
 */
const LARGURA_LOGO_SPLASH = 136;

const VARIANTES: Record<Variante, DadosVariante> = {
  campo: {
    nome: 'Macuxi Campo',
    pacote: 'br.com.macuxi.campo',
    scheme: 'macuxicampo',
    icone: './assets/images/icone-campo.png',
    iconeFrente: './assets/images/icone-campo-frente.png',
    iconeFundo: './assets/images/icone-campo-fundo.png',
    fundo: AZUL_NOITE,
    splash: './assets/images/splash-campo.png',
  },
  gestao: {
    nome: 'Macuxi Gestão',
    pacote: 'br.com.macuxi.gestao',
    scheme: 'macuxigestao',
    icone: './assets/images/icone-gestao.png',
    iconeFrente: './assets/images/icone-gestao-frente.png',
    iconeFundo: './assets/images/icone-gestao-fundo.png',
    fundo: PEROLA,
    splash: './assets/images/splash-gestao.png',
  },
};

/** `version` do app (X.Y.Z), de `scripts/eas/versao.json`; mesma regra de `versaoValida` em src/lib/nome-build.ts. */
function versaoDoApp(): string {
  const v: unknown = (versaoDoArquivo as { versao?: unknown }).versao;
  if (typeof v !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) {
    throw new Error(`versão inválida em scripts/eas/versao.json: ${JSON.stringify(v)} (use X.Y.Z, por exemplo "1.0.0")`);
  }
  return v;
}

/** Caminho padrão do google-services.json, relativo a apps/mobile (o .gitignore o mantém fora do git). */
export const GOOGLE_SERVICES_PADRAO = './google-services.json';

/**
 * `android.googleServicesFile` só quando o arquivo existe: o caminho de `GOOGLE_SERVICES_JSON` (Actions) ou o
 * padrão. Sem o arquivo, nada (o dev local e o bundle seguem sem push, em vez de o prebuild falhar).
 */
export function arquivoGoogleServices(
  raiz: string,
  env: Readonly<Record<string, string | undefined>>,
  existe: (caminho: string) => boolean,
): { googleServicesFile?: string } {
  const indicado = env.GOOGLE_SERVICES_JSON?.trim() || GOOGLE_SERVICES_PADRAO;
  const caminho = isAbsolute(indicado) ? indicado : resolve(raiz, indicado);
  return existe(caminho) ? { googleServicesFile: caminho } : {};
}

function variante(): Variante {
  const v = process.env.APP_VARIANT ?? 'campo';
  if (v !== 'campo' && v !== 'gestao') throw new Error(`APP_VARIANT inválida: ${v} (use campo ou gestao)`);
  return v;
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const id = variante();
  const v = VARIANTES[id];
  const versao = versaoDoApp();
  return {
    ...config,
    name: v.nome,
    slug: 'macuxi-fdv',
    version: versao,
    orientation: 'portrait',
    icon: v.icone,
    scheme: v.scheme,
    userInterfaceStyle: 'light',
    ios: { icon: './assets/expo.icon' },
    android: {
      package: v.pacote,
      adaptiveIcon: {
        backgroundColor: v.fundo,
        foregroundImage: v.iconeFrente,
        backgroundImage: v.iconeFundo,
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // RN-CORE-23 / T-0065: push pelo FCM direto (v1.0.10). O arquivo vem do caminho em GOOGLE_SERVICES_JSON (no Actions,
      // o android-build.yml decodifica o secret GOOGLE_SERVICES_JSON_BASE64 e grava o caminho); sem a variável, ./google-services.json (fora do git). Nenhum agente lê nem commita o arquivo. Sem o
      // arquivo (build de desenvolvimento), o app compila sem push e segue com o Sincronizar e a atualização automática.
      // projectRoot vem do Expo; quem chama a config sem ele (testes) usa a pasta atual
      ...arquivoGoogleServices(projectRoot ?? process.cwd(), process.env, existsSync),
      // teclado (R-20261101-023401-alexandre): adjustResize explícito; no edge-to-edge (Android 15+) a janela não
      // encolhe, então as telas com campo embaixo usam KeyboardAvoidingView (login.tsx), que mede o quanto o teclado cobre
      softwareKeyboardLayoutMode: 'resize',
      // T-0145 (RN-CORE-37): o Campo exige notificações, localização o tempo todo, câmera e fotos/galeria (a tela de permissões
      // confere a cada abertura); o Gestão exige notificações e, só do supervisor, a localização o tempo todo (T-0187).
      // ACCESS_BACKGROUND_LOCATION vem do plugin do expo-location (nas duas variantes) e o READ_EXTERNAL_STORAGE até o
      // Android 12, do expo-image-picker (no 13+ a galeria não pede permissão)
      permissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
      ],
      // sem gravação de áudio (a câmera só tira foto: fachada do cliente fechado, RN-CORE-14)
      blockedPermissions: ['android.permission.RECORD_AUDIO'],
    },
    web: { output: 'single', favicon: './assets/images/favicon.png', name: v.nome },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { backgroundColor: v.fundo, image: v.splash, imageWidth: LARGURA_LOGO_SPLASH }],
      [
        'expo-location',
        {
          locationWhenInUsePermission: `O ${v.nome} usa a localização para registrar o check-in na visita ao cliente.`,
          // T-0145 e T-0187: "Permitir o tempo todo" (tracking no horário de trabalho, RN-CORE-37) no Campo e no Gestão
          // (supervisor); quem pede é a tela de permissões, pelo cargo
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      // câmera e galeria (T-0145): fotos do PDV, da gôndola e da fachada (RN-CORE-14); sem microfone
      [
        'expo-image-picker',
        {
          cameraPermission: `O ${v.nome} usa a câmera para fotografar o PDV, a gôndola e a fachada do cliente.`,
          photosPermission: `O ${v.nome} usa as fotos do aparelho para anexar fotos já tiradas.`,
          microphonePermission: false,
        },
      ],
      // tokens da sessão no armazenamento seguro do Android (Keystore)
      'expo-secure-store',
      // ADR 0017: sincronização incremental em segundo plano (WorkManager no Android; o plugin só mexe no iOS)
      'expo-background-task',
      // RN-CORE-23 item 3 / RF-CORE-09: push visível (abre a tela certa) e silencioso (dispara o motor de sync)
      ['expo-notifications', { icon: './assets/images/icone-notificacao.png', color: AZUL_NOITE, defaultChannel: 'avisos' }],
      // ADR 0003 / T-0008 §3.1: SQLite do aparelho com FTS5 explícito (busca offline do Catálogo; tela de diagnóstico).
      // T-0088: obrigatório (o motor do usuário roda sobre ele): build sem o pacote FALHA, em vez de sair sem SQLite
      ['expo-sqlite', { enableFTS: true }],
      // MC-1780: notificação fixa do trajeto com a cor da marca no ícone e canal "Serviço do app" (edita o .kt do
      // expo-location no prebuild; o package.json compila o expo-location do código-fonte para a edição valer)
      './plugins/notificacao-trajeto',
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      router: {},
      variante: id,
    },
  };
};
