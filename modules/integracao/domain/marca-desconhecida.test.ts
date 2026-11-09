import { describe, expect, it } from 'vitest';
import { LIMITE_AVISOS_POR_LOTE, acrescentarAvisosAoLote, avisoMarcaDesconhecida } from './marca-desconhecida';

const ev = { produto_external_id: 'P-1', produto_codigo: 'ABC-10', marcas: ['Marca X', 'Marca Y'] };

describe('T-0103: aviso de marca concorrente desconhecida no monitor', () => {
  it('RN-CAT-09: o aviso traz o código do produto e as marcas, é aviso (não erro) e não leva dado pessoal', () => {
    const a = avisoMarcaDesconhecida(ev);
    expect(a.codigo).toBe('marca_concorrente_desconhecida');
    expect(a.external_id).toBe('P-1');
    expect(a.mensagem).toBe('Produto ABC-10: marca "Marca X", "Marca Y" não cadastrada; a referência foi carregada sem marca resolvida. Cadastre a marca em Catálogo > Marcas.');
  });

  it('sem código do produto, usa o external_id do ERP', () => {
    expect(avisoMarcaDesconhecida({ ...ev, produto_codigo: null, marcas: ['Z'] }).mensagem).toContain('Produto P-1: marca "Z" não cadastrada');
  });

  it('acrescenta ao fim dos avisos do lote sem repetir o mesmo produto e marca (evento reentregue)', () => {
    const a = avisoMarcaDesconhecida(ev);
    const r1 = acrescentarAvisosAoLote([], [a]);
    expect(r1.avisos).toHaveLength(1);
    const r2 = acrescentarAvisosAoLote(r1.avisos, [a]);
    expect(r2.avisos).toHaveLength(1);
    expect(r2.alterou).toBe(false);
  });

  it(`passa de ${LIMITE_AVISOS_POR_LOTE} avisos vira um último "e mais N"`, () => {
    const base = Array.from({ length: LIMITE_AVISOS_POR_LOTE }, (_, i) => ({ indice: 0, external_id: `x${i}`, codigo: 'duplicado_no_lote' as const, mensagem: 'm' }));
    const r = acrescentarAvisosAoLote(base, [avisoMarcaDesconhecida(ev), avisoMarcaDesconhecida({ ...ev, produto_external_id: 'P-2' })]);
    expect(r.avisos).toHaveLength(LIMITE_AVISOS_POR_LOTE + 1);
    expect(r.avisos.at(-1)?.mensagem).toBe('e mais 2 aviso(s) não mostrados');
    const r2 = acrescentarAvisosAoLote(r.avisos, [avisoMarcaDesconhecida({ ...ev, produto_external_id: 'P-3' })]);
    expect(r2.avisos).toHaveLength(LIMITE_AVISOS_POR_LOTE + 1);
    expect(r2.avisos.at(-1)?.mensagem).toBe('e mais 3 aviso(s) não mostrados');
  });
});
