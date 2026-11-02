/**
 * Tokens da sessão (acesso JWT de 15 min + refresh rotativo de 30 dias) no armazenamento SEGURO do aparelho
 * (expo-secure-store: Keystore do Android), nunca no AsyncStorage nem em log. Os dados não secretos da sessão
 * (usuário, tenant) ficam no AsyncStorage (`state/plataforma.tsx`).
 * No navegador (Expo web, só para demonstração) não há SecureStore: cai no AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PendenciaSaida } from '@/lib/saida-push';

export interface Tokens {
  access: string;
  /** `null` na demonstração (mock-api não tem refresh). */
  refresh: string | null;
}

const CHAVE = 'macuxi.sessao.tokens';

export async function lerTokens(): Promise<Tokens | null> {
  try {
    const bruto = Platform.OS === 'web' ? await AsyncStorage.getItem(CHAVE) : await SecureStore.getItemAsync(CHAVE);
    if (!bruto) return null;
    const t = JSON.parse(bruto) as Partial<Tokens>;
    return typeof t.access === 'string' && t.access ? { access: t.access, refresh: typeof t.refresh === 'string' ? t.refresh : null } : null;
  } catch {
    return null;
  }
}

export async function gravarTokens(t: Tokens | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (t) await AsyncStorage.setItem(CHAVE, JSON.stringify(t));
    else await AsyncStorage.removeItem(CHAVE);
    return;
  }
  if (t) await SecureStore.setItemAsync(CHAVE, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(CHAVE);
}

// ---------- saídas pendentes (logout sem sinal; `lib/saida-push.ts`) ----------
// Levam o refresh da sessão que saiu: ficam no armazenamento seguro, como os tokens.
const CHAVE_SAIDAS = 'macuxi.sessao.saidas_pendentes';

export async function lerSaidasPendentes(): Promise<PendenciaSaida[]> {
  try {
    const bruto = Platform.OS === 'web' ? await AsyncStorage.getItem(CHAVE_SAIDAS) : await SecureStore.getItemAsync(CHAVE_SAIDAS);
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista) ? (lista as PendenciaSaida[]) : [];
  } catch {
    return [];
  }
}

export async function gravarSaidasPendentes(lista: readonly PendenciaSaida[]): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (lista.length) await AsyncStorage.setItem(CHAVE_SAIDAS, JSON.stringify(lista));
      else await AsyncStorage.removeItem(CHAVE_SAIDAS);
      return;
    }
    if (lista.length) await SecureStore.setItemAsync(CHAVE_SAIDAS, JSON.stringify(lista));
    else await SecureStore.deleteItemAsync(CHAVE_SAIDAS);
  } catch {
    // armazenamento indisponível: a saída não fica na fila (o refresh vence sozinho em 30 dias)
  }
}
