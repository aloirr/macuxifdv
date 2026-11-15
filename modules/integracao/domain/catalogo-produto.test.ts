import { describe, expect, it } from 'vitest';
import { eventoTolerante } from '@macuxi/platform-sdk';
import { EVENTO_ERP_PRODUTO_ATUALIZADO, ProdutoPayload } from '../contracts';
import { limitarCatalogoDoProduto } from './catalogo-produto';
import { validarLinhas } from './idempotencia';

const base = { external_id: 'P1', alterado_em: '2026-11-06T10:00:00Z', sku: 'S1', nome: 'Pastilha', unidade: 'UN' };

describe('produto do ERP: aplicação, referências, oferece junto e etiquetas', () => {
  it('RN-CAT-11: payload antigo, sem os 4 campos, continua válido', () => {
    expect(ProdutoPayload.safeParse(base).success).toBe(true);
  });

  it('RN-CAT-09: aceita os 4 campos; a marca da referência é opcional, basta o código', () => {
    const ok = ProdutoPayload.safeParse({ ...base, aplicacao: 'Gol 1.0', etiquetas: ['Novo'], oferece_junto: ['P2'], referencias: [{ marca_nome: 'Cobreq', codigo: 'N-1' }] });
    expect(ok.success).toBe(true);
    expect(ProdutoPayload.safeParse({ ...base, referencias: [{ codigo: 'N-1' }] }).success).toBe(true);
  });

  it('RN-CAT-11: aplicação de 2.500 caracteres chega com 2.000 e o aviso aplicacao_cortada, sem recusar a linha', () => {
    const r = validarLinhas('produto', [{ ...base, aplicacao: 'a'.repeat(2500) }]);
    expect(r.erros).toEqual([]);
    expect((r.validas[0]!.registro as { aplicacao: string }).aplicacao).toHaveLength(2000);
    expect(r.avisos).toMatchObject([{ indice: 0, external_id: 'P1', codigo: 'aplicacao_cortada' }]);
    expect(r.avisos[0]!.mensagem).toContain('2500');
  });

  it('RN-CAT-11: o corte é por code point e tira o espaço do fim', () => {
    const texto = `${'x'.repeat(1998)} ${'😀'.repeat(10)}`;
    const { registro } = limitarCatalogoDoProduto({ ...base, aplicacao: texto } as ProdutoPayload);
    expect(Array.from(registro.aplicacao!).length).toBeLessThanOrEqual(2000);
    expect(registro.aplicacao!.endsWith(' ')).toBe(false);
    expect(registro.aplicacao).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('RN-CAT-09: 4 referências ficam 3, 6 em oferece junto ficam 5 (com aviso) e 5 etiquetas ficam 4', () => {
    const r = validarLinhas('produto', [
      {
        ...base,
        referencias: [1, 2, 3, 4].map((i) => ({ marca_external_id: 'M1', codigo: `C${i}` })),
        oferece_junto: ['A', 'B', 'C', 'D', 'E', 'F'],
        etiquetas: ['a', 'b', 'c', 'd', 'e'],
      },
    ]);
    const reg = r.validas[0]!.registro as ProdutoPayload;
    expect(reg.referencias).toHaveLength(3);
    expect(reg.oferece_junto).toHaveLength(5);
    expect(reg.etiquetas).toEqual(['a', 'b', 'c', 'd']);
    expect(r.avisos.map((a) => a.codigo).sort()).toEqual(['oferece_junto_cortado', 'referencias_cortadas']);
  });

  it('RN-CAT-09: o evento integracao.produto.atualizado@1, lido de forma tolerante, mantém os 4 campos', () => {
    const lido = eventoTolerante(EVENTO_ERP_PRODUTO_ATUALIZADO).schema.safeParse({
      external_id: 'P1',
      lote_id: '11111111-1111-4111-8111-111111111111',
      entidade: 'produto',
      hash: 'h1',
      ocorrido_em: '2026-11-06T10:00:00Z',
      acao: 'atualizado',
      registro: { ...base, ativo: true, aplicacao: 'Gol', etiquetas: ['Novo'], oferece_junto: ['P2'], referencias: [{ marca_nome: 'Cobreq', codigo: 'N-1' }] },
    });
    expect(lido.success).toBe(true);
    const reg = (lido as { data: { registro: Record<string, unknown> } }).data.registro;
    expect(reg).toMatchObject({ aplicacao: 'Gol', etiquetas: ['Novo'], oferece_junto: ['P2'], referencias: [{ marca_nome: 'Cobreq', codigo: 'N-1' }] });
  });

  it('RN-INT-02: campo ausente não é inventado e null/[] passam como estão (limpam)', () => {
    const { registro, avisos } = limitarCatalogoDoProduto({ ...base, ativo: true, aplicacao: null, referencias: [] } as ProdutoPayload);
    expect(avisos).toEqual([]);
    expect(registro.aplicacao).toBeNull();
    expect('etiquetas' in registro).toBe(false);
  });

  it('RN-CAT-09: referência com código vazio ou acima de 30 é descartada com aviso (sem marca, ela segue) e a linha do produto segue', () => {
    const r = validarLinhas('produto', [
      { ...base, etiquetas: ['x'.repeat(30), '  '], referencias: [{ codigo: 'N-1' }, { marca_nome: 'Cobreq', codigo: '' }, { marca_nome: 'Cobreq', codigo: 'c'.repeat(31) }, { marca_nome: 'Cobreq', codigo: 'OK-1' }] },
    ]);
    expect(r.erros).toEqual([]);
    const reg = r.validas[0]!.registro as ProdutoPayload;
    expect(reg.referencias).toEqual([{ codigo: 'N-1' }, { marca_nome: 'Cobreq', codigo: 'OK-1' }]);
    expect(reg.etiquetas).toEqual(['x'.repeat(20)]);
    expect(r.avisos.map((a) => a.codigo)).toEqual(['referencia_descartada']);
  });
});
