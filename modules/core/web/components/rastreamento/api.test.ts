import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../../../contracts';
import { criarApiRastreamento } from './api';

const U = '0e300000-0000-4000-8000-000000000001';
const ID = '0e300000-0000-4000-8000-000000000002';
const AGORA = '2026-11-19T14:00:00.000Z';

function chamadas(respostas: Record<string, unknown>) {
  const log: Array<{ caminho: string; opcoes?: { method?: string; body?: unknown; query?: unknown } }> = [];
  const chamar = (async (caminho: string, opcoes?: { method?: string; body?: unknown; query?: unknown }) => {
    log.push({ caminho, opcoes });
    return respostas[`${opcoes?.method ?? 'GET'} ${caminho}`];
  }) as never;
  return { log, api: criarApiRastreamento(chamar) };
}

describe('RN-CORE-13: chamadas do BKO do rastreamento', () => {
  it('RN-CORE-13: lê e grava o parâmetro pelo contrato', async () => {
    const { api, log } = chamadas({ 'GET /core/parametros/rastreamento': PARAMETROS_RASTREAMENTO_PADRAO, 'PUT /core/parametros/rastreamento': {} });
    expect((await api.ler()).ativo).toBe(false);
    await api.gravar({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true });
    expect(log[1]!.opcoes).toMatchObject({ method: 'PUT', body: { ativo: true } });
    await expect(api.gravar({ ...PARAMETROS_RASTREAMENTO_PADRAO, frequencia: { distancia_m: 1, intervalo_min: 5, lote_min: 5 } })).rejects.toBeDefined();
  });
  it('RN-CORE-13: publica o termo (versão nova) e lista as ausências do escopo', async () => {
    const termo = { id: ID, versao: 3, texto: 'Texto', publicado_em: AGORA, updated_at: AGORA, deleted_at: null };
    const aus = { id: ID, usuario_id: U, de: '2026-12-01', ate: '2026-12-10', updated_at: AGORA, deleted_at: null };
    const { api, log } = chamadas({
      'POST /core/rastreamento/termos': termo,
      'GET /core/ausencias': { ausencias: [aus] },
      'POST /core/ausencias': aus,
      'DELETE /core/ausencias/0e300000-0000-4000-8000-000000000002': { id: ID },
    });
    expect((await api.publicar('Texto')).versao).toBe(3);
    expect(log[0]!.opcoes).toMatchObject({ method: 'POST', body: { texto: 'Texto' } });
    expect(await api.ausencias()).toHaveLength(1);
    expect((await api.cadastrarAusencia({ usuario_id: U, de: '2026-12-01', ate: '2026-12-10' })).usuario_id).toBe(U);
    await api.cancelarAusencia(ID);
    expect(log.at(-1)!.opcoes?.method).toBe('DELETE');
  });
});
