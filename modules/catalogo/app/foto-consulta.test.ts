/** T-0148: catalogo.foto_produto@1 no aparelho — ícone só com foto; baixa só ao abrir; offline devolve null sem quebrar. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { definirResolvedorMiniatura } from './lib/miniatura-resolvedor';
import { FotoProdutoEntradaSchema } from '../contracts';
import { consultaFotoProdutoAparelho } from './foto-consulta';

const mini = { arquivo_id: '0ca00000-0000-4000-8000-000000000003', url: '/v1/arquivos/0ca00000-0000-4000-8000-000000000003/miniatura', largura: 320, altura: 320, bytes_max: 30720, versao: 'v1' };
const P1 = '0ca00000-0000-4000-8000-0000000000a1';
const P2 = '0ca00000-0000-4000-8000-0000000000a2';
const ctx = { linhasPorCampo: vi.fn(async () => [{ produto_id: P1, deleted_at: null, miniatura: mini }, { produto_id: P2, deleted_at: null, miniatura: null }]) } as unknown as ContextoConsultaAparelho;
const rodar = (abrir: boolean) => (consultaFotoProdutoAparelho as unknown as { executar: (e: unknown, c: unknown) => Promise<{ itens: unknown[] }> }).executar(FotoProdutoEntradaSchema.parse({ produto_ids: [P1, P2], abrir }), ctx);

afterEach(() => definirResolvedorMiniatura(null));

describe('catalogo.foto_produto@1 (T-0148)', () => {
  it('T-0148: sem abrir, diz quem tem foto e não baixa nada', async () => {
    const baixar = vi.fn(async () => 'file:///cache/p1.jpg');
    definirResolvedorMiniatura(baixar);
    expect((await rodar(false)).itens).toEqual([{ produto_id: P1, tem_foto: true, uri: null }, { produto_id: P2, tem_foto: false, uri: null }]);
    expect(baixar).not.toHaveBeenCalled();
  });
  it('T-0148: ao abrir, baixa pelo resolvedor (cache do shell) e devolve o file://', async () => {
    definirResolvedorMiniatura(async () => 'file:///cache/p1.jpg');
    expect((await rodar(true)).itens[0]).toEqual({ produto_id: P1, tem_foto: true, uri: 'file:///cache/p1.jpg' });
  });
  it('T-0148: sem sinal ou resolvedor que falha: uri nula, tem_foto verdadeiro, sem lançar', async () => {
    definirResolvedorMiniatura(async () => { throw new Error('offline'); });
    expect((await rodar(true)).itens[0]).toEqual({ produto_id: P1, tem_foto: true, uri: null });
    definirResolvedorMiniatura(null);
    expect((await rodar(true)).itens[0]).toEqual({ produto_id: P1, tem_foto: true, uri: null });
  });
});
