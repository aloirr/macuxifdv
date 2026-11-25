/**
 * ADR 0076 (T-0196, quantidade fracionária): o SQLite do aparelho guarda `fator` e quantidade decimais sem truncar. As linhas
 * do pull ficam em `ent_<e>.dados` (TEXT com o JSON da linha, esquema local do SDK) e a fila e as chaves dos módulos em
 * `kv.valor` (TEXT); nenhuma coluna INTEGER as recebe, então não há migração local. Ida e volta com o adaptador real do SDK
 * sobre `node:sqlite`, inclusive a busca por campo (`json_extract`, comparação numérica).
 */
import { criarArmazenamentoSqlite, type DriverSqlite, type LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

/** Driver `node:sqlite` carregado pelo NOME (o typecheck do app não puxa `node:sqlite` para o grafo; T-0008 P3). */
async function driverNode(): Promise<DriverSqlite> {
  const nome = '@macuxi/platform-sdk/sqlite-node';
  const m = (await import(/* @vite-ignore */ nome)) as { criarDriverNode(caminho?: string): DriverSqlite };
  return m.criarDriverNode(':memory:');
}

const VALORES = [0.1255, 999999.9999] as const;
const U = (n: number) => `0b9a4c1e-7f3d-4a2b-9c8d-${String(n).padStart(12, '0')}`;

interface LinhaComFator extends LinhaSync {
  fator: number;
  quantidade: number;
}

describe('quantidade fracionária no SQLite do aparelho (ADR 0076)', () => {
  it('linhas do pull: fator e quantidade 0,1255 e 999999,9999 voltam iguais (listar, porIds e porCampo)', async () => {
    const db = await driverNode();
    const arm = criarArmazenamentoSqlite(db, { entidades: [{ nome: 'embalagem_teste', modulo: 'catalogo' }] });
    const linhas: LinhaComFator[] = VALORES.map((v, i) => ({
      id: U(i + 1),
      updated_at: '2026-11-25T15:00:00.000Z',
      deleted_at: null,
      fator: v,
      quantidade: v,
    }));
    await arm.linhas.aplicar('embalagem_teste', linhas, null);

    const lidas = (await arm.linhas.listar<LinhaComFator>('embalagem_teste')).sort((a, b) => a.id.localeCompare(b.id));
    expect(lidas.map((l) => [l.fator, l.quantidade])).toEqual([
      [0.1255, 0.1255],
      [999999.9999, 999999.9999],
    ]);
    expect((await arm.linhas.porIds<LinhaComFator>('embalagem_teste', [U(2)]))[0]?.fator).toBe(999999.9999);
    for (const v of VALORES) {
      const achadas = await arm.linhas.porCampo!<LinhaComFator>('embalagem_teste', 'fator', [v]);
      expect(achadas.map((l) => l.quantidade)).toEqual([v]);
    }
    // o SQLite vê número real (não inteiro truncado) dentro do JSON
    const tipos = await db.todas<{ t: string; v: number }>(
      "SELECT json_type(dados, '$.fator') AS t, json_extract(dados, '$.fator') AS v FROM ent_embalagem_teste ORDER BY id",
    );
    expect(tipos).toEqual([
      { t: 'real', v: 0.1255 },
      { t: 'real', v: 999999.9999 },
    ]);
    await arm.fechar();
  });

  it('fila e chaves dos módulos (kv): a quantidade decimal do item pendente volta igual', async () => {
    const arm = criarArmazenamentoSqlite(await driverNode());
    const item = { id: U(9), itens: VALORES.map((v) => ({ quantidade: v, fator: v })) };
    await arm.gravar('mod:vendedor:rascunho', item);
    expect(await arm.ler('mod:vendedor:rascunho')).toEqual(item);
    await arm.fechar();
  });
});
