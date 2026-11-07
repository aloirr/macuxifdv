/**
 * SQLite do aparelho (desenho T-0008, P3 + P5): contrato do driver, esquema local e adaptador. TS puro, sem
 * biblioteca: o driver `node:sqlite` fica em `@macuxi/platform-sdk/sqlite-node` e o do expo-sqlite no shell (P4).
 */
export * from './driver';
export * from './esquema';
export * from './armazenamento';
export * from './arquivo';
export * from './passagem';
export * from './aparelho';
