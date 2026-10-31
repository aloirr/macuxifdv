/**
 * Fábricas de armazenamento da suíte de contrato do motor (desenho T-0008 §3.4): os mesmos casos rodam em cada
 * adaptador — (a) chave→JSON sem extensões (memória/AsyncStorage) e (b) extensão `linhas` sobre as mesmas chaves.
 * O SQLite com `node:sqlite` (c) entra na P3. Só para testes (não exportado pelo índice).
 */
import { comLinhasEmChaveJson, criarArmazenamentoEmMemoria, type ArmazenamentoSync } from './motor-sync';

export const FABRICAS_ARMAZENAMENTO: ReadonlyArray<readonly [string, () => ArmazenamentoSync]> = [
  ['chave→JSON', () => criarArmazenamentoEmMemoria()],
  ['linhas sobre chave→JSON', () => comLinhasEmChaveJson(criarArmazenamentoEmMemoria())],
];
