/**
 * Tokens da sessão (acesso JWT de 15 min + refresh rotativo de 30 dias) no armazenamento SEGURO do aparelho
 * (expo-secure-store: Keystore do Android), nunca no AsyncStorage nem em log. Os dados não secretos da sessão
 * (usuário, tenant) ficam no AsyncStorage (`state/plataforma.tsx`).
 * No navegador (Expo web, só para demonstração) não há SecureStore: cai no AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

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
