/**
 * Fábricas de armazenamento da suíte de contrato do motor (desenho T-0008 §3.4): os mesmos casos rodam em cada
 * adaptador — (a) chave→JSON sem extensões (memória/AsyncStorage), (b) extensão `linhas` sobre as mesmas chaves e
 * (c) o adaptador SQLite real sobre `node:sqlite` em memória (P3). Só para testes (não exportado pelo índice).
 */
import { comLinhasEmChaveJson, criarArmazenamentoEmMemoria, type ArmazenamentoSync } from './motor-sync';
import { criarArmazenamentoSqlite } from './sqlite/armazenamento';
import { criarDriverNode } from './sqlite/driver-node';

export const FABRICAS_ARMAZENAMENTO: ReadonlyArray<readonly [string, () => ArmazenamentoSync]> = [
  ['chave→JSON', () => criarArmazenamentoEmMemoria()],
  ['linhas sobre chave→JSON', () => comLinhasEmChaveJson(criarArmazenamentoEmMemoria())],
  ['SQLite (node:sqlite)', () => criarArmazenamentoSqlite(criarDriverNode(':memory:'))],
];
