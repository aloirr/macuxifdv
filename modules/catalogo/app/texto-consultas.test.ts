/** RN-CAT-11: aplicação no aparelho, lida só dos itens pedidos ou memorizada pela versão das linhas. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { aplicacoesDosProdutos, esquecerMemoriaTextos, referenciasDoRetrato } from './texto-consultas';

const linha = (produto_id: string, aplicacao: string | null, deleted_at: string | null = null) => ({ id: `c-${produto_id}`, produto_id, aplicacao, deleted_at });
const LINHAS = [linha('p1', 'Uno 2010'), linha('p2', null), linha('p3', 'Gol', '2026-01-01T00:00:00Z')];

const ctxBase = (extra: Record<string, unknown> = {}) => {
  const linhas = vi.fn(async () => LINHAS);
  return { ctx: { linhas, linhasPorIds: vi.fn(), agora: () => new Date(), usuario: () => null, parametros: () => ({}), ...extra } as unknown as ContextoConsultaAparelho, linhas };
};

describe('aplicacoesDosProdutos', () => {
  beforeEach(() => esquecerMemoriaTextos());

  it('RN-CAT-11: sem leituras do motor lê o conteúdo inteiro, ignorando apagadas e vazias', async () => {
    const { ctx, linhas } = ctxBase();
    expect([...(await aplicacoesDosProdutos(ctx, ['p1', 'p2', 'p3']))]).toEqual([['p1', 'Uno 2010']]);
    expect(linhas).toHaveBeenCalledTimes(1);
  });

  it('RN-CAT-11: com versão das linhas, 40 chamadas seguidas leem a tabela uma vez; versão nova relê', async () => {
    let versao = 1;
    const { ctx, linhas } = ctxBase({ versaoLinhas: () => versao });
    for (let i = 0; i < 40; i++) await aplicacoesDosProdutos(ctx, ['p1']);
    expect(linhas).toHaveBeenCalledTimes(1);
    versao = 2;
    await aplicacoesDosProdutos(ctx, ['p1']);
    expect(linhas).toHaveBeenCalledTimes(2);
  });

  it('RN-CAT-11: com linhasPorCampo lê só os produtos pedidos', async () => {
    const porCampo = vi.fn(async () => [LINHAS[0]!]);
    const { ctx, linhas } = ctxBase({ linhasPorCampo: porCampo });
    expect(await aplicacoesDosProdutos(ctx, ['p1'])).toEqual(new Map([['p1', 'Uno 2010']]));
    expect(porCampo).toHaveBeenCalledWith('produto_conteudo', 'produto_id', ['p1']);
    expect(linhas).not.toHaveBeenCalled();
  });
});

describe('referenciasDoRetrato (RN-CAT-09: sem o cadastro do Promotor no aparelho, vale o marca_nome)', () => {
  const ref = (produto_id: string, ordem: number, marca_nome: string | null | undefined, deleted_at: string | null = null) => ({ id: `r-${produto_id}-${ordem}`, produto_id, marca_id: '00000000-0000-4000-8000-0000000000a1', codigo: `CB ${ordem}`, ordem, marca_nome, deleted_at });
  const ctxRef = (linhas: unknown[]) => ({ linhas: vi.fn(async () => linhas) }) as unknown as ContextoConsultaAparelho;

  it('RN-CAT-09: usa o retrato, na ordem, e some só a referência sem retrato (APK antigo, linha anterior à 0034) ou apagada', async () => {
    const m = await referenciasDoRetrato(ctxRef([ref('p1', 2, 'Freiomax'), ref('p1', 1, 'Fremax'), ref('p1', 3, null), ref('p2', 1, undefined), ref('p3', 1, 'X', '2026-01-01T00:00:00Z')]));
    expect(m.get('p1')?.map((r) => [r.marca_nome, r.codigo])).toEqual([['Fremax', 'CB 1'], ['Freiomax', 'CB 2']]);
    expect(m.has('p2')).toBe(false);
    expect(m.has('p3')).toBe(false);
  });

  it('RN-CAT-09: só os produtos pedidos; entidade ilegível devolve vazio sem quebrar', async () => {
    expect([...(await referenciasDoRetrato(ctxRef([ref('p1', 1, 'A'), ref('p2', 1, 'B')]), new Set(['p2']))).keys()]).toEqual(['p2']);
    const quebrado = { linhas: vi.fn(async () => { throw new Error('sem entidade'); }) } as unknown as ContextoConsultaAparelho;
    expect((await referenciasDoRetrato(quebrado)).size).toBe(0);
  });
});
