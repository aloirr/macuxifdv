/**
 * T-0144: leitura do módulo nativo local `MacuxiSaida` (`apps/mobile/modules/macuxi-saida`, Android 11+) e registro, no
 * início do app, da queda do processo anterior que aconteceu fora do React (regras em `lib/saida-android.ts`).
 * APK sem o módulo (anterior à T-0144) ou fora do Android: nada acontece e o Diagnóstico diz que não há como saber.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { lerErroJava, lerSaidas, saidaParaRegistrar, CHAVE_SAIDA_VISTA, type SaidaAndroid } from '@/lib/saida-android';

import { gravarErroRegistrado, lerUltimoErro } from './erros';
import { readJson, writeJson } from './storage';

interface ModSaida {
  ultimasSaidas(limite: number): string;
  ultimoErroJava(): string;
}

let mod: ModSaida | null | undefined;
function nativo(): ModSaida | null {
  if (mod !== undefined) return mod;
  try {
    mod = Platform.OS === 'android' ? requireOptionalNativeModule<ModSaida>('MacuxiSaida') : null;
  } catch {
    mod = null;
  }
  return mod;
}

/** Últimas saídas do processo (mais nova primeiro); `null` = sem o módulo neste APK. Nunca lança. */
export function lerSaidasDoAndroid(limite = 8): SaidaAndroid[] | null {
  const m = nativo();
  if (!m) return null;
  try {
    return lerSaidas(m.ultimasSaidas(limite));
  } catch {
    return [];
  }
}

/**
 * Chamado uma vez no início do app: a queda anterior (ainda não vista) vai para o "Último erro do app" do Diagnóstico.
 * Nunca lança nem segura a abertura.
 */
export async function registrarSaidaAnterior(agora = Date.now()): Promise<void> {
  try {
    const m = nativo();
    if (!m) return;
    const saidas = lerSaidas(m.ultimasSaidas(8));
    let erroJava = null;
    try {
      erroJava = lerErroJava(m.ultimoErroJava());
    } catch {
      erroJava = null;
    }
    const [vista, existente] = await Promise.all([readJson<number>(CHAVE_SAIDA_VISTA), lerUltimoErro().catch(() => null)]);
    const d = saidaParaRegistrar(saidas, typeof vista === 'number' ? vista : null, erroJava, existente, agora);
    if (d.registro) {
      console.warn(`[saida] o processo anterior terminou fora do React (${d.registro.mensagem.split(' · ')[0]})`);
      await gravarErroRegistrado(d.registro);
    }
    await writeJson(CHAVE_SAIDA_VISTA, d.vistaAte);
  } catch {
    // diagnóstico nunca derruba o app
  }
}
