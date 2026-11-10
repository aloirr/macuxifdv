/**
 * T-0145: leitura e pedido das permissões do aparelho (regras em `lib/permissoes.ts`). Notificações pelo expo-notifications,
 * localização (durante o uso e o tempo todo) pelo expo-location, câmera e fotos/galeria pelo expo-image-picker; "Abrir
 * configurações" pelo `Linking.openSettings()` (a página do app nas configurações do Android).
 * Fora do Android (navegador da demonstração): tudo concedido. Módulo nativo ausente (APK antigo) ou falha na leitura: a
 * permissão conta como NÃO concedida e o pedido segue possível (o app não abre por engano sem a permissão).
 */
import { requireOptionalNativeModule } from 'expo';
import { Linking, Platform } from 'react-native';

import { TUDO_CONCEDIDO, type BotaoPermissoes, type EstadoPermissao, type EstadosPermissoes } from '@/lib/permissoes';

interface RespostaPermissao {
  granted: boolean;
  canAskAgain: boolean;
}

const NAO_LIDA: EstadoPermissao = { concedida: false, podePerguntar: true };

function estado(r: RespostaPermissao | null | undefined): EstadoPermissao {
  return r ? { concedida: Boolean(r.granted), podePerguntar: r.canAskAgain !== false } : NAO_LIDA;
}

async function ler(f: () => Promise<RespostaPermissao>): Promise<EstadoPermissao> {
  try {
    return estado(await f());
  } catch {
    return NAO_LIDA;
  }
}

type ModNotificacoes = typeof import('expo-notifications');
type ModLocalizacao = typeof import('expo-location');
type ModImagePicker = typeof import('expo-image-picker');

function carregar<T>(nativo: string, pacote: () => T): T | null {
  try {
    return requireOptionalNativeModule(nativo) ? pacote() : null;
  } catch {
    return null;
  }
}

const notificacoes = () => carregar<ModNotificacoes>('ExpoNotificationPermissionsModule', () => require('expo-notifications') as ModNotificacoes);
const localizacao = () => carregar<ModLocalizacao>('ExpoLocation', () => require('expo-location') as ModLocalizacao);
const imagens = () => carregar<ModImagePicker>('ExponentImagePicker', () => require('expo-image-picker') as ModImagePicker);

/** Nível de API do Android (30 = Android 11); `null` fora do Android. */
export function apiDoAndroid(): number | null {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : null;
}

/** Lê o estado de todas as permissões (só leitura: nenhum diálogo). */
export async function lerPermissoes(): Promise<EstadosPermissoes> {
  if (Platform.OS !== 'android') return TUDO_CONCEDIDO;
  const n = notificacoes();
  const l = localizacao();
  const i = imagens();
  const [notif, duranteUso, tempoTodo, camera, galeria] = await Promise.all([
    n ? ler(() => n.getPermissionsAsync()) : Promise.resolve(NAO_LIDA),
    l ? ler(() => l.getForegroundPermissionsAsync()) : Promise.resolve(NAO_LIDA),
    l ? ler(() => l.getBackgroundPermissionsAsync()) : Promise.resolve(NAO_LIDA),
    i ? ler(() => i.getCameraPermissionsAsync()) : Promise.resolve(NAO_LIDA),
    i ? ler(() => i.getMediaLibraryPermissionsAsync()) : Promise.resolve(NAO_LIDA),
  ]);
  return { notificacoes: notif, localizacao: { duranteUso, tempoTodo }, camera, galeria };
}

/**
 * O botão da tela (`telaDePermissoes(...).botao`): diálogo do sistema, passo 2 da localização (no Android 11+ o próprio
 * pedido abre a página de localização do app) ou a página do app nas configurações. Nunca lança: a tela relê o estado
 * quando o app volta ao primeiro plano.
 */
export async function executarAcaoDePermissao(botao: BotaoPermissoes): Promise<void> {
  try {
    if (botao.acao === 'abrir-configuracoes') {
      await Linking.openSettings();
      return;
    }
    if (botao.acao === 'pedir-tempo-todo') {
      await localizacao()?.requestBackgroundPermissionsAsync();
      return;
    }
    if (botao.id === 'notificacoes') await notificacoes()?.requestPermissionsAsync();
    else if (botao.id === 'localizacao') await localizacao()?.requestForegroundPermissionsAsync();
    else if (botao.id === 'camera') await imagens()?.requestCameraPermissionsAsync();
    else await imagens()?.requestMediaLibraryPermissionsAsync();
  } catch {
    // sem diálogo nem página (APK sem o módulo, navegador): a tela continua com o botão
  }
}
