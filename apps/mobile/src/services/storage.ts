/**
 * Persistência local (AsyncStorage) em JSON. Chaves por usuário para não misturar carteiras.
 * Fase M: AsyncStorage; o plano (docs/05) é expo-sqlite com uma tabela por entidade + outbox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const keys = {
  settings: 'fv:settings',
  session: 'fv:session',
  offline: 'fv:offline',
  user: (userId: string, name: 'cache' | 'products' | 'extras' | 'outbox' | 'drafts' | 'visits') => `fv:u:${userId}:${name}`,
};

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Grava em série por chave para que uma gravação antiga nunca sobrescreva uma nova. */
const chains = new Map<string, Promise<void>>();

export function writeJson(key: string, value: unknown): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => (value === null || value === undefined ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, JSON.stringify(value))))
    .catch(() => {});
  chains.set(key, next);
  return next;
}
