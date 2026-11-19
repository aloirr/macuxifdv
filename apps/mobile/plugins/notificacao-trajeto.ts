/**
 * MC-1780: cor e canal da notificação fixa da tarefa `macuxi-trajeto` (serviço em primeiro plano do expo-location).
 * Escrito sobre o expo-location 57.0.22 (`android/src/main/java/expo/modules/location/services/LocationTaskService.kt`).
 *
 * Por quê:
 *  - Cor: sem `notificationColor` o expo-location só faz `setColorized(false)` e o círculo do ícone fica na cor do
 *    sistema. Com `notificationColor` ele faz `setColorized(true).setColor(cor)` e pinta o cartão inteiro. O que
 *    queremos é o das outras notificações do app: `setColor` com o recurso `notification_icon_color` (Azul noite
 *    `#1E3350`, criado pelo plugin do expo-notifications) e o cartão sem pintar (`setColorized(false)`).
 *  - Canal: o expo-location cria o canal com o nome do app e a descrição "Background location notification channel"
 *    (inglês, cita localização). Passa a ser "Serviço do app", sem descrição. O canal é recriado a cada início do
 *    serviço: no Android, `createNotificationChannel` com o mesmo id atualiza nome e descrição de quem já tinha o canal
 *    e mantém o que o usuário mudou.
 *
 * Como: no prebuild do Android (`withDangerousMod`) o plugin edita o .kt do expo-location instalado. O .kt só entra no
 * APK porque o `apps/mobile/package.json` pede `expo.autolinking.android.buildFromSource: ["expo-location"]`; sem isso o
 * Gradle usa o .aar pronto do `local-maven-repo` e a edição não vale. O plugin confere as duas coisas e FALHA o prebuild
 * se o trecho esperado do .kt não existir (biblioteca atualizada) ou se o buildFromSource sumir. Rodar duas vezes não
 * duplica nada.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { type ConfigPlugin, withDangerousMod } from 'expo/config-plugins';

const ARQUIVO_KT = 'android/src/main/java/expo/modules/location/services/LocationTaskService.kt';
const VERSAO_ESCRITA = '57.0.22';

/** Trecho original do `buildServiceNotification` (sem `notificationColor`). */
const COR_ORIGINAL = ['    } ?: run {', '      builder.setColorized(false)', '    }', ''].join('\n');

const COR_NOVA = [
  '    } ?: run {',
  '      builder.setColorized(false)',
  '      // MC-1780 (Macuxi, apps/mobile/plugins/notificacao-trajeto.ts): círculo do ícone em notification_icon_color, cartão sem pintar',
  '      val corMacuxi = mParentContext.resources.getIdentifier("notification_icon_color", "color", mParentContext.packageName)',
  '      if (corMacuxi != 0) {',
  '        builder.setColor(mParentContext.getColor(corMacuxi))',
  '      }',
  '    }',
  '',
].join('\n');

/** Trecho original do `prepareChannel`. */
const CANAL_ORIGINAL = [
  '    val appName = applicationInfo.loadLabel(packageManager).toString()',
  '    var channel = notificationManager.getNotificationChannel(id)',
  '    if (channel == null) {',
  '      channel = NotificationChannel(id, appName, NotificationManager.IMPORTANCE_LOW)',
  '      channel.description = "Background location notification channel"',
  '      notificationManager.createNotificationChannel(channel)',
  '    }',
  '',
].join('\n');

const CANAL_NOVO = [
  '    // MC-1780 (Macuxi, apps/mobile/plugins/notificacao-trajeto.ts): canal "Serviço do app", sem descrição',
  '    val channel = NotificationChannel(id, "Serviço do app", NotificationManager.IMPORTANCE_LOW)',
  '    notificationManager.createNotificationChannel(channel)',
  '',
].join('\n');

function trocarUmaVez(fonte: string, original: string, novo: string, oQue: string): string {
  if (fonte.includes(novo)) return fonte;
  const primeira = fonte.indexOf(original);
  if (primeira < 0 || fonte.indexOf(original, primeira + 1) >= 0) {
    throw new Error(
      `MC-1780: trecho do ${oQue} não encontrado (ou repetido) no LocationTaskService.kt do expo-location. ` +
        `O plugin apps/mobile/plugins/notificacao-trajeto.ts foi escrito para o expo-location ${VERSAO_ESCRITA}: ` +
        'revise o plugin para a versão instalada.',
    );
  }
  return fonte.slice(0, primeira) + novo + fonte.slice(primeira + original.length);
}

/** Aplica a cor e o canal ao conteúdo do LocationTaskService.kt. Idempotente; lança erro se o trecho esperado faltar. */
export function aplicarNotificacaoTrajeto(fonte: string): string {
  const comCor = trocarUmaVez(fonte, COR_ORIGINAL, COR_NOVA, 'buildServiceNotification (cor)');
  return trocarUmaVez(comCor, CANAL_ORIGINAL, CANAL_NOVO, 'prepareChannel (canal)');
}

/** Lança erro se o package.json do app não compilar o expo-location do código-fonte (sem isso o .kt editado não entra). */
export function conferirBuildFromSource(pacote: unknown): void {
  const lista = (pacote as { expo?: { autolinking?: { android?: { buildFromSource?: unknown } } } })?.expo?.autolinking?.android
    ?.buildFromSource;
  if (!Array.isArray(lista) || !lista.includes('expo-location')) {
    throw new Error(
      'MC-1780: o apps/mobile/package.json precisa de expo.autolinking.android.buildFromSource com "expo-location"; ' +
        'sem isso o Gradle usa o .aar pronto e a cor e o canal da notificação do trajeto não entram no APK.',
    );
  }
}

const withNotificacaoTrajeto: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const raiz = cfg.modRequest.projectRoot;
      conferirBuildFromSource(JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')));
      const pastaLocation = dirname(createRequire(join(raiz, 'package.json')).resolve('expo-location/package.json'));
      const caminho = join(pastaLocation, ARQUIVO_KT);
      const antes = readFileSync(caminho, 'utf8');
      const depois = aplicarNotificacaoTrajeto(antes);
      if (depois !== antes) writeFileSync(caminho, depois);
      return cfg;
    },
  ]);

export default withNotificacaoTrajeto;
