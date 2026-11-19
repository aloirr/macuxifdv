/**
 * MC-1780: plugin da notificação fixa da tarefa `macuxi-trajeto`. O trecho abaixo é cópia literal do
 * LocationTaskService.kt do expo-location 57.0.22 (onStartCommand, buildServiceNotification e prepareChannel).
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import appConfig from '../app.config';
import { aplicarNotificacaoTrajeto, conferirBuildFromSource } from './notificacao-trajeto';

const TRECHO_REAL = `  @TargetApi(26)
  override fun onStartCommand(intent: Intent, flags: Int, startId: Int): Int {
    val extras = intent.extras
    if (extras != null) {
      mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")
      mKillService = extras.getBoolean("killService", false)
    }
    return START_REDELIVER_INTENT
  }

  @TargetApi(26)
  private fun buildServiceNotification(serviceOptions: Bundle): Notification {
    prepareChannel(mChannelId)
    val builder = Notification.Builder(this, mChannelId)
    val title = serviceOptions.getString("notificationTitle")
    val body = serviceOptions.getString("notificationBody")
    val color = colorStringToInteger(serviceOptions.getString("notificationColor"))

    title?.let { builder.setContentTitle(title) }
    body?.let { builder.setContentText(body) }
    color?.let {
      builder.setColorized(true).setColor(color)
    } ?: run {
      builder.setColorized(false)
    }

    mParentContext.packageManager.getLaunchIntentForPackage(mParentContext.packageName)?.let {
      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
  }

  @TargetApi(26)
  private fun prepareChannel(id: String?) {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    val appName = applicationInfo.loadLabel(packageManager).toString()
    var channel = notificationManager.getNotificationChannel(id)
    if (channel == null) {
      channel = NotificationChannel(id, appName, NotificationManager.IMPORTANCE_LOW)
      channel.description = "Background location notification channel"
      notificationManager.createNotificationChannel(channel)
    }
  }
`;

describe('MC-1780: notificação fixa do trajeto', () => {
  const varianteAntes = process.env.APP_VARIANT;
  afterEach(() => {
    if (varianteAntes === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = varianteAntes;
  });

  it('cor: círculo do ícone em notification_icon_color, cartão sem pintar', () => {
    const novo = aplicarNotificacaoTrajeto(TRECHO_REAL);
    expect(novo).toContain(
      '      builder.setColorized(false)\n' +
        '      // MC-1780 (Macuxi, apps/mobile/plugins/notificacao-trajeto.ts): círculo do ícone em notification_icon_color, cartão sem pintar\n' +
        '      val corMacuxi = mParentContext.resources.getIdentifier("notification_icon_color", "color", mParentContext.packageName)\n' +
        '      if (corMacuxi != 0) {\n' +
        '        builder.setColor(mParentContext.getColor(corMacuxi))\n' +
        '      }\n' +
        '    }\n',
    );
    // o ramo com notificationColor (que pinta o cartão) fica como está e não é usado pelo app
    expect(novo).toContain('builder.setColorized(true).setColor(color)');
    expect(novo.match(/setColorized\(true\)/g)).toHaveLength(1);
  });

  it('canal: "Serviço do app", sem descrição e sem citar localização', () => {
    const novo = aplicarNotificacaoTrajeto(TRECHO_REAL);
    expect(novo).toContain('    val channel = NotificationChannel(id, "Serviço do app", NotificationManager.IMPORTANCE_LOW)\n');
    expect(novo).toContain('    notificationManager.createNotificationChannel(channel)\n');
    expect(novo).not.toContain('channel.description');
    expect(novo).not.toContain('Background location');
    expect(novo).not.toContain('appName');
  });

  it('id do canal: "macuxi-servico", sem appId nem nome da tarefa', () => {
    const novo = aplicarNotificacaoTrajeto(TRECHO_REAL);
    expect(novo).toContain('      mChannelId = "macuxi-servico"\n');
    expect(novo).not.toContain('extras.getString("taskName")');
    expect(novo).toContain('      mKillService = extras.getBoolean("killService", false)\n');
  });

  it('idempotente: rodar duas vezes dá o mesmo arquivo', () => {
    const uma = aplicarNotificacaoTrajeto(TRECHO_REAL);
    expect(aplicarNotificacaoTrajeto(uma)).toBe(uma);
    expect(uma.match(/MC-1780/g)).toHaveLength(3);
  });

  it('falha clara quando o trecho do id do canal não existe (biblioteca atualizada)', () => {
    const outro = TRECHO_REAL.replace('extras.getString("appId") + ":" + extras.getString("taskName")', 'extras.getString("channelId")');
    expect(() => aplicarNotificacaoTrajeto(outro)).toThrow(/MC-1780: trecho do onStartCommand \(id do canal\) não encontrado.*57\.0\.22/);
  });

  it('falha clara quando o trecho da cor não existe (biblioteca atualizada)', () => {
    const outro = TRECHO_REAL.replace('      builder.setColorized(false)\n', '      builder.setColorized(false).setColor(0)\n');
    expect(() => aplicarNotificacaoTrajeto(outro)).toThrow(/MC-1780: trecho do buildServiceNotification \(cor\) não encontrado.*57\.0\.22/);
  });

  it('falha clara quando o trecho do canal não existe (biblioteca atualizada)', () => {
    const outro = TRECHO_REAL.replace('Background location notification channel', 'Location service');
    expect(() => aplicarNotificacaoTrajeto(outro)).toThrow(/MC-1780: trecho do prepareChannel \(canal\) não encontrado/);
  });

  it('falha quando o expo-location não é compilado do código-fonte (o .kt editado não entraria no APK)', () => {
    expect(() => conferirBuildFromSource({})).toThrow(/buildFromSource/);
    expect(() => conferirBuildFromSource({ expo: { autolinking: { android: { buildFromSource: [] } } } })).toThrow(/buildFromSource/);
    expect(() => conferirBuildFromSource({ expo: { autolinking: { android: { buildFromSource: ['expo-location'] } } } })).not.toThrow();
  });

  it('o app compila o expo-location do código-fonte e registra o plugin nas duas variantes', () => {
    expect(() => conferirBuildFromSource(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')))).not.toThrow();
    for (const variante of ['campo', 'gestao']) {
      process.env.APP_VARIANT = variante;
      expect(appConfig({ config: {} } as Parameters<typeof appConfig>[0]).plugins).toContain('./plugins/notificacao-trajeto');
    }
  });

  it('T-0187: a localização em segundo plano (serviço macuxi-trajeto) vale nas duas variantes, Campo e Gestão', () => {
    for (const variante of ['campo', 'gestao']) {
      process.env.APP_VARIANT = variante;
      const plugins = appConfig({ config: {} } as Parameters<typeof appConfig>[0]).plugins ?? [];
      const loc = plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-location');
      expect(loc?.[1]).toMatchObject({ isAndroidBackgroundLocationEnabled: true });
    }
  });
});
