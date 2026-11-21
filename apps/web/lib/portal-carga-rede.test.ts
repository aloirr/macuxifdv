/** D-T0173-A4: o portal `config.` lê `GET /integracao/lotes/{id}` (rota do BKO) com o contrato do BKO, que tem `cancelado`. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./portal-api', async (original) => {
  const real = await original<typeof import('./portal-api')>();
  return {
    ...real,
    chamarPortal: async (_caminho: string, o: { schema?: { parse: (x: unknown) => unknown } }) => (o.schema ? o.schema.parse(LOTE_CANCELADO) : LOTE_CANCELADO),
  };
});

const AGORA = '2026-11-15T14:05:30.000Z';
const LOTE_CANCELADO = {
  lote_id: '0c000000-0000-4000-8000-000000000004',
  entidade: 'produto',
  modo: 'delta',
  status: 'cancelado',
  contagens: { recebidas: 2, duplicadas_no_lote: 0, com_erro: 0, novas: 2, atualizadas: 0, inalteradas: 0, obsoletas: 0 },
  erros: [],
  avisos: [],
  cursor: null,
  inativadas: 0,
  recebido_em: AGORA,
  concluido_em: AGORA,
};

describe('criarPortaCarga — lerLote', () => {
  it('lote cancelado no BKO: a leitura aceita o status `cancelado` (sem erro de formato)', async () => {
    const { criarPortaCarga } = await import('./portal-carga-rede');
    await expect(criarPortaCarga('0f000000-0000-4000-8000-0000000000aa').lerLote(LOTE_CANCELADO.lote_id)).resolves.toMatchObject({ status: 'cancelado' });
  });
});
