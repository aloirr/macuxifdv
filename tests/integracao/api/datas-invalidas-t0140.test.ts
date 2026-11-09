/**
 * T-0140 lote 03 (agente testes) — data do usuário inválida nas rotas do Core e do Gestor pela API REAL: `createApp` × Postgres
 * como `macuxi_app` (RLS), banco efêmero próprio do arquivo com a fixture dois-tenants e login de verdade.
 * PRECISA DE BANCO: pula sem Postgres (local, sem Docker no PC); no CI (`MACUXI_PG_EXIGIR=1`) roda.
 *
 * Critério (pedido do gerente para o lote 03): onde a rota recebe uma data do usuário, a data impossível ("2026-02-30",
 * "2026-13-01") sai como erro 4xx com código e mensagem, e não como 500 `ERRO_INTERNO`. A data mal formada já é 400 `VALIDACAO`
 * pelo contrato. Sem banco, a mesma matriz está em `tests/modulos/t0140-lote03-datas-invalidas.test.ts` (D2/D3), que
 * também mostra a causa: o contrato aceita só o formato (`/^\d{4}-\d{2}-\d{2}$/`), e o domínio lança `RangeError`
 * (Gestor, RD-0034) ou a data chega ao `$1::date` do Postgres (Core).
 * Defeitos D-T0140-L03a (Gestor) e D-T0140-L03b (Core) corrigidos em 09/11: os casos voltaram a `it`.
 * Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';

const IMPOSSIVEIS = ['2026-02-30', '2026-13-01'];

describe.skipIf(semBanco())('T-0140 lote 03 — data do usuário inválida pela API real (Core e Gestor)', () => {
  let api: ApiDeTeste;
  let supervisor = '';
  let vendedorId = '';

  beforeAll(async () => {
    api = await subirApi();
    supervisor = (await api.sessao('supervisor@exemplo.com.br', A)).access_token;
    vendedorId = (await api.sessao('vendedor@exemplo.com.br', A)).usuario.id;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  const get = (url: string) => api.chamar(supervisor, { method: 'GET', url });
  const recusa = async (url: string) => {
    const r = await get(url);
    expect(r.statusCode, `${url}: ${r.body}`).toBeGreaterThanOrEqual(400);
    expect(r.statusCode, `${url}: ${r.body}`).toBeLessThan(500);
    expect(erroDe(r).mensagem, url).toBeTruthy();
  };

  it('DA-0 controle: data válida 200; mal formada 400 VALIDACAO (Core e Gestor)', async () => {
    for (const url of ['/v1/gestor/equipe?data=2026-11-10', '/v1/gestor/ranking?data=2026-11-10', '/v1/core/rotas?de=2026-11-09&ate=2026-11-15', '/v1/core/visitas?de=2026-11-09&ate=2026-11-15']) {
      const r = await get(url);
      expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
    }
    for (const url of ['/v1/gestor/equipe?data=10/11/2026', '/v1/core/rotas?de=2026-1-5']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(400);
      expect(erroDe(r).codigo).toBe('VALIDACAO');
    }
  });

  // D-T0140-L03a (modulo-gestor) CORRIGIDO (R-20261109-131923): 422 DATA_INVALIDA com mensagem
  it.each(IMPOSSIVEIS)('DA-1 Gestor: equipe, Ficha e Ranking com data=%s → 4xx com mensagem', async (data) => {
    await recusa(`/v1/gestor/equipe?data=${data}`);
    await recusa(`/v1/gestor/equipe/${vendedorId}?data=${data}`);
    await recusa(`/v1/gestor/ranking?data=${data}`);
  });

  // D-T0140-L03b (modulo-core) CORRIGIDO em 09/11: o contrato recusa a data impossível (4xx com mensagem)
  it.each(IMPOSSIVEIS)('DA-2 Core: rotas e visitas com de/ate=%s → 4xx com mensagem', async (data) => {
    await recusa(`/v1/core/rotas?de=${data}`);
    await recusa(`/v1/core/rotas?de=${data}&ate=2026-03-05`);
    await recusa(`/v1/core/visitas?ate=${data}`);
    await recusa(`/v1/core/visitas?de=2026-02-25&ate=${data}`);
  });
});
