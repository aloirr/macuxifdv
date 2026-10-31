/**
 * Adaptador de armazenamento do motor de sync (platform-sdk `ArmazenamentoSync`) sobre o AsyncStorage,
 * isolado por usuário (`macuxi:u:<id>:`) para não misturar carteiras no mesmo aparelho.
 * Plano (docs/05): trocar por expo-sqlite com uma tabela por entidade — só este arquivo muda.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';

import { readJson, writeJson } from './storage';

export function armazenamentoDoUsuario(userId: string): ArmazenamentoSync {
  const prefixo = `macuxi:u:${userId}:`;
  return {
    ler: (chave) => readJson(prefixo + chave),
    gravar: (chave, valor) => writeJson(prefixo + chave, valor),
    remover: (chave) => writeJson(prefixo + chave, null),
    async chaves(p) {
      try {
        const todas = await AsyncStorage.getAllKeys();
        return todas.filter((k) => k.startsWith(prefixo + p)).map((k) => k.slice(prefixo.length));
      } catch {
        return [];
      }
    },
  };
}
