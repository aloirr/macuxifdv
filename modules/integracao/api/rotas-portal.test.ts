import { describe, expect, it } from 'vitest';
import { NOME_ARQUIVO_ROTA_RE, TIPOS_CONTEUDO_ROTA, type ContextoRota, type EntradaRota } from '@macuxi/platform-sdk';
import { rotaCargaArquivo, rotaConferirArquivo, rotaErrosLote, rotaErrosLoteCsv, rotaLote, rotaOrdemCarga, rotaProgressoSessaoArquivo } from './bko-carga-arquivo';
import { criarRotasConectores } from './bko-conectores';

const LOTE = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a1111';
const logs: unknown[] = [];
const log = { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), debug: (...a: unknown[]) => logs.push(a) };

function ctx(over: Record<string, unknown>, linhasErro: unknown[] = []): ContextoRota<never> {
  const db = { query: async (sql: string) => ({ rows: /count|select id from integracao.lote /.test(sql) ? [{ id: LOTE }] : linhasErro }) };
  return {
    usuario: { id: 'sa', tenant_id: 't1', perfil: 'admin' },
    params: { id: LOTE },
    parametros: () => ({}),
    agora: () => new Date('2026-11-06T10:00:00Z'),
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn(db, { auditar: async () => undefined }),
    log,
    ...over,
  } as unknown as ContextoRota<never>;
}

describe('T-0087: rotas do portal aceitam o super-admin (ADR 0029)', () => {
  const conectores = criarRotasConectores({ pepper: () => undefined });
  it('RF-INT-03: carga, conferência, lotes, erros, ordem e conectores (listar e criar) têm superAdmin aceita; ações de risco continuam só do usuário', () => {
    for (const r of [rotaCargaArquivo, rotaConferirArquivo, rotaProgressoSessaoArquivo, rotaLote, rotaErrosLote, rotaErrosLoteCsv, rotaOrdemCarga]) expect(r.superAdmin, r.caminho).toBe('aceita');
    const porChave = (m: string, c: string) => conectores.find((r) => r.metodo === m && r.caminho === c);
    expect(porChave('GET', 'conectores')?.superAdmin).toBe('aceita');
    expect(porChave('POST', 'conectores')?.superAdmin).toBe('aceita');
    expect(porChave('PATCH', 'conectores/:id')?.superAdmin).toBe('aceita');
    expect(porChave('POST', 'conectores/:id/chave')?.superAdmin).toBe('aceita');
    expect(conectores.filter((r) => r.superAdmin).length).toBe(4);
  });
});

describe('RF-INT-03: erros.csv', () => {
  it('RF-INT-03: devolve text/csv com nome erros-<id>.csv válido pelo SDK, sem dado pessoal no nome', () => {
    expect(TIPOS_CONTEUDO_ROTA).toContain(rotaErrosLoteCsv.tipoConteudo);
    expect(rotaErrosLoteCsv.tipoConteudo).toBe('text/csv; charset=utf-8');
    const nome = (rotaErrosLoteCsv.nomeArquivo as (e: EntradaRota) => string)({ params: { id: LOTE } } as unknown as EntradaRota);
    expect(nome).toBe(`erros-${LOTE}.csv`);
    expect(NOME_ARQUIVO_ROTA_RE.test(nome)).toBe(true);
  });

  it('LGPD: o csv sai com os erros do lote e o log leva só id e contagem (nunca mensagem nem valor)', async () => {
    logs.length = 0;
    const erro = { indice: 0, external_id: 'C1', codigo: 'campo_obrigatorio', campo: 'nome', mensagem: 'Linha 2 do arquivo: o campo "nome" é obrigatório.', reprocessavel: false, origem: null };
    const csv = (await rotaErrosLoteCsv.executar(ctx({}, [erro]) as never)) as string;
    expect(csv).toContain('campo_obrigatorio');
    expect(JSON.stringify(logs)).not.toContain('C1');
    expect(JSON.stringify(logs)).not.toContain('obrigatório');
    expect(JSON.stringify(logs)).toContain(LOTE);
  });
});

describe('RN-INT-04: ordem-carga', () => {
  it('RN-INT-04: devolve as 16 entidades em ordem', async () => {
    const r = (await rotaOrdemCarga.executar(ctx({}) as never)) as { itens: { entidade: string }[] };
    expect(r.itens).toHaveLength(16);
    expect(r.itens[0]?.entidade).toBe('filial');
  });
});

describe('RF-INT-03: conferir sem gravar', () => {
  const corpo = (conteudo: string) => ({ entidade: 'transportadora', modo: 'delta', conteudo });

  it('RF-INT-03: não toca no banco, aponta a linha com erro e o log não leva o conteúdo do arquivo', async () => {
    logs.length = 0;
    const r = (await rotaConferirArquivo.executar(
      ctx({ corpo: corpo('external_id;nome\nT1;Rapido\nT2;\n'), comTenant: async () => { throw new Error('não deveria gravar'); } }) as never,
    )) as { gravou: boolean; linhas_lidas: number; linhas_com_erro: number; pode_gravar: boolean; erros: { mensagem: string }[] };
    expect(r.gravou).toBe(false);
    expect(r.linhas_lidas).toBe(2);
    expect(r.linhas_com_erro).toBe(1);
    expect(r.pode_gravar).toBe(false);
    expect(r.erros[0]?.mensagem).toMatch(/^Linha 3 do arquivo:/);
    expect(JSON.stringify(logs)).not.toContain('Rapido');
  });

  it('RF-INT-03: entidade desconhecida e perfil sem permissão são recusados', async () => {
    await expect(rotaConferirArquivo.executar(ctx({ corpo: { ...corpo('a\n1'), entidade: 'xyz' } }) as never)).rejects.toMatchObject({ codigo: 'entidade_desconhecida' });
    await expect(rotaConferirArquivo.executar(ctx({ corpo: corpo('a\n1'), usuario: { id: 'u', tenant_id: 't1', perfil: 'vendedor' } }) as never)).rejects.toMatchObject({ status: 403 });
  });
});
