/**
 * Esquema LOCAL do Core no aparelho (SQLite do usuário; dono: banco-dados). Rastreamento no expediente (T-0156, ADR 0061;
 * desenho docs/desenho/tracking.md §3.1 e §3.4); especificação em docs/banco/aparelho-sqlite.md ("Core: rastreamento").
 * Declarado pelo módulo em `definirModuloShell({ migracoesAparelho })` (o manifesto e o app são do modulo-core).
 *
 * Regras (as do Catálogo, modules/catalogo/db/aparelho.ts; db/testes/aparelho-sqlite-core.test.ts confere):
 * - SÓ strings SQL, sem import (entra no bundle do app e na tarefa de segundo plano `macuxi-trajeto`).
 * - Versões inteiras e crescentes, só para frente. Versão publicada NUNCA muda.
 * - Todo objeto leva o prefixo `core__`. Sem gatilhos.
 * - Sem dado além do desenho §3.1: nada de endereço, altitude, rumo, rede, bateria ou apps.
 * - Caminho de volta: não há "down" no aparelho; downgrade do app ou logout apagam os bancos do usuário
 *   (`apagarBancosDoAparelho`), e ponto não enviado se perde (desenho §3.4).
 *
 * core__ponto_trajeto: um ponto por linha, gravado pela tarefa `macuxi-trajeto` (fora de tela). `id` = UUID gerado no
 * aparelho (o mesmo do push, idempotente no servidor); `capturado_em` = ISO 8601 UTC com `Z` (ordem de texto = ordem de
 * tempo); `enviado_em` nulo = na fila. Quem lê a fila pega os não enviados do mais antigo em lotes de [500]
 * (core__ponto_trajeto_fila). Depois do envio confirmado o aparelho apaga os enviados que não são de hoje e, sem envio, os de
 * mais de [90] dias (core__ponto_trajeto_capturado). O km parcial de hoje (metrosDoTrajeto) lê pelo mesmo índice.
 * core__pausa_trajeto: pausa pessoal (§4.3), só início e fim (nulo = em curso); a mesma fila e a mesma retenção.
 */
export const migracoesAparelho: { versao: number; sql: string }[] = [
  {
    // v1 (T-0156): pontos e pausas do rastreamento, com a fila de envio
    versao: 1,
    sql: `
      CREATE TABLE core__ponto_trajeto (
        id            TEXT PRIMARY KEY,
        capturado_em  TEXT NOT NULL,
        latitude      REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude     REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        precisao_m    INTEGER CHECK (precisao_m IS NULL OR precisao_m >= 0),
        velocidade_ms REAL CHECK (velocidade_ms IS NULL OR velocidade_ms >= 0),
        enviado_em    TEXT
      ) WITHOUT ROWID;
      CREATE INDEX core__ponto_trajeto_capturado ON core__ponto_trajeto (capturado_em);
      CREATE INDEX core__ponto_trajeto_fila ON core__ponto_trajeto (capturado_em) WHERE enviado_em IS NULL;
      CREATE TABLE core__pausa_trajeto (
        id          TEXT PRIMARY KEY,
        inicio      TEXT NOT NULL,
        fim         TEXT CHECK (fim IS NULL OR fim > inicio),
        enviado_em  TEXT
      ) WITHOUT ROWID;
      CREATE INDEX core__pausa_trajeto_inicio ON core__pausa_trajeto (inicio);
    `,
  },
];
