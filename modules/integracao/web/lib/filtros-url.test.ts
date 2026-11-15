import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { LoteListagemItem } from '../../contracts';
import { FILTROS_VAZIOS, filtrarLotes, lerFiltros, paraBusca, paraQueryLotes, temFiltro } from './filtros-url';

const relogio = criarRelogio();
const LOTE = '3f0c9a8e-1b2d-4c5e-8f90-a1b2c3d4e5f6';

function lote(p: Partial<LoteListagemItem>): LoteListagemItem {
  return {
    lote_id: LOTE,
    conector_id: 'erp-matriz',
    entidade: 'cliente',
    modo: 'delta',
    status: 'concluido',
    recebidas: 10,
    com_erro: 0,
    novas: 2,
    atualizadas: 3,
    inalteradas: 5,
    obsoletas: 0,
    inativadas: 0,
    recebido_em: relogio.iso(),
    concluido_em: relogio.iso(),
    ...p,
  };
}

describe('filtros do monitor na URL (link compartilhável)', () => {
  it('lê o que é válido e ignora o que não faz sentido', () => {
    expect(lerFiltros('?entidade=cliente&status=com_falha&lote=' + LOTE)).toEqual({
      entidade: 'cliente',
      status: 'com_falha',
      lote: LOTE,
    });
    expect(lerFiltros('?entidade=nada&status=xyz&lote=123')).toEqual(FILTROS_VAZIOS);
    expect(lerFiltros('')).toEqual(FILTROS_VAZIOS);
  });

  it('grava só o que está preenchido e faz ida e volta', () => {
    expect(paraBusca(FILTROS_VAZIOS)).toBe('');
    const f = { ...FILTROS_VAZIOS, entidade: 'produto', status: 'com_falha' };
    expect(paraBusca(f)).toBe('?entidade=produto&status=com_falha');
    expect(lerFiltros(paraBusca(f))).toEqual(f);
  });

  it('temFiltro ignora o lote aberto (gaveta não é filtro)', () => {
    expect(temFiltro({ ...FILTROS_VAZIOS, lote: LOTE })).toBe(false);
    expect(temFiltro({ ...FILTROS_VAZIOS, status: 'com_falha' })).toBe(true);
  });

  it('RN-INT-15: status com um estado só vai para a API; Em andamento (dois estados) fica no filtro local', () => {
    expect(paraQueryLotes({ ...FILTROS_VAZIOS, status: 'com_falha' })).toEqual({ status: 'falhou' });
    expect(paraQueryLotes({ ...FILTROS_VAZIOS, status: 'em_andamento' })).toEqual({});
  });

  it('query de LoteListagemQuery (GET /v1/integracao/lotes) usa os nomes do contrato', () => {
    expect(paraQueryLotes({ entidade: 'cliente', status: '', lote: LOTE })).toEqual({ entidade: 'cliente' });
  });

  it('filtra os lotes recentes por entidade e status', () => {
    const lotes = [
      lote({ conector_id: 'erp-matriz', entidade: 'cliente' }),
      lote({ conector_id: 'erp-filial', entidade: 'produto', status: 'concluido_com_erros', com_erro: 3 }),
      lote({ conector_id: 'erp-matriz', entidade: 'produto', status: 'falhou' }),
    ];
    expect(filtrarLotes(lotes, FILTROS_VAZIOS)).toHaveLength(3);
    expect(filtrarLotes(lotes, { ...FILTROS_VAZIOS, entidade: 'produto' })).toHaveLength(2);
    expect(filtrarLotes(lotes, { ...FILTROS_VAZIOS, entidade: 'produto', status: 'com_falha' })).toHaveLength(1);
    expect(filtrarLotes([...lotes, lote({ status: 'recebido' }), lote({ status: 'processando' })], { ...FILTROS_VAZIOS, status: 'em_andamento' })).toHaveLength(2);
  });
});
