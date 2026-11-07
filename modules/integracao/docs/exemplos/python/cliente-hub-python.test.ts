/**
 * T-0108: o cliente de exemplo em Python (`cliente_hub.py`) contra o Hub simulado. Pula (skipIf) quando `python3` ou o pacote
 * `requests` não existem na máquina, para não quebrar quem não tem Python instalado.
 */
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { criarHubSimulado } from '../simulador/hub-simulado.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { chaveIdempotencia } from '../node/cliente-hub.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCRIPT = fileURLToPath(new URL('./cliente_hub.py', import.meta.url));
const pythonOk = (() => {
  try {
    return spawnSync('python3', ['-c', 'import requests'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!pythonOk)('cliente_hub.py contra o Hub simulado (precisa de python3 + requests)', () => {
  const hub = criarHubSimulado();
  beforeAll(() => hub.iniciar(0));
  afterAll(() => hub.parar());

  const rodar = async () =>
    (
      await promisify(execFile)('python3', [SCRIPT], {
        env: { PATH: process.env.PATH ?? '', MACUXI_HUB_URL: hub.url, MACUXI_CHAVE: hub.chave, MACUXI_INTERVALO_MS: '5' },
        timeout: 20_000,
      })
    ).stdout;

  it('executa a demonstração (saída 0): carga completa em partes, delta com erros por linha, replay, recusa e pedido integrado', async () => {
    const saida = await rodar();
    expect(saida).toContain('Concluido.');
    expect(saida).not.toContain(hub.chave);
    const produtos = hub.estado.requisicoes.filter((r: any) => r.caminho === '/lotes' && r.corpo?.entidade === 'produto');
    expect(produtos.map((r: any) => [r.corpo.sessao.parte, r.corpo.sessao.ultimo])).toEqual([[1, false], [2, false], [3, true]]);
    expect(new Set(produtos.map((r: any) => r.corpo.sessao.id)).size).toBe(1);
    for (const r of hub.estado.requisicoes.filter((x: any) => x.caminho === '/lotes' && x.status === 202)) {
      expect(r.cabecalhos['idempotency-key']).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
    }
    // a chave do Python só precisa ser estável e igual ao SHA-256 do próprio conteúdo canônico; repetir o lote dá o mesmo lote_id
    const preco = hub.estado.requisicoes.filter((r: any) => r.caminho === '/lotes' && r.corpo?.entidade === 'preco');
    expect(preco).toHaveLength(2);
    expect(preco[1].resposta).toMatchObject({ repetido: true, lote_id: preco[0].resposta.lote_id });
    expect(chaveIdempotencia(preco[0].corpo)).toMatch(/^[0-9a-f]{64}$/);
    expect(saida).toContain('RecusaLote 422 lote_vazio');
    expect(hub.estado.pedidos.get('3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c').estado).toBe('integrado');
  });

  it('segunda execução usa delta e não reenvia nada', async () => {
    const antes = hub.estado.lotes.size;
    const saida = await rodar();
    expect(saida).toContain('so o delta');
    expect(hub.estado.lotes.size).toBe(antes);
  });
});
