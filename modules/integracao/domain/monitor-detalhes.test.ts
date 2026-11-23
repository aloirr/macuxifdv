import { describe, expect, it } from 'vitest';
import { MonitorDetalhes } from '../contracts';
import { classeDoErroLinha, montarMonitorDetalhes, sinalResumoDoConector, type EntradaMonitorDetalhes } from './monitor-detalhes';

const AGORA = '2026-11-23T15:00:00.000Z';
const L1 = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a0001';
const L2 = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a0002';
const L3 = '0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a0003';

const SINAL = {
  fila: [{ estado: 'pendente', lotes: 2, linhas: 300, maisAntigo: '2026-11-23T14:50:00.000Z' }],
  entidades: [{ entidade: 'cliente', fase: 'delta', ultimo_sucesso: '2026-11-23T14:58:00.000Z', bloqueada: false, lotes_na_fila: 2 }],
};

function entrada(e: Partial<EntradaMonitorDetalhes> = {}): EntradaMonitorDetalhes {
  return {
    agora: AGORA,
    conectores: [
      { conector_id: 'erp-1', tipo: 'conector', ativo: true, entidades: ['cliente', 'produto'], versao_conector: '1.6.0', ultimo_sinal_em: '2026-11-23T14:59:00.000Z', parado_por_versao: false, sinal_resumo: SINAL },
    ],
    cursores: [{ conector_id: 'erp-1', entidade: 'cliente', alterado_em: '2026-11-23T14:00:00.000Z', external_id: 'C9', atualizado_em: '2026-11-23T14:01:00.000Z' }],
    registros: [{ entidade: 'cliente', ativos: 120, inativos: 3 }],
    lotes: [
      { lote_id: L1, conector_id: 'erp-1', entidade: 'cliente', modo: 'delta', status: 'falhou', recebido_em: '2026-11-23T10:00:00.000Z', concluido_em: '2026-11-23T10:01:00.000Z', tem_conteudo: true },
      { lote_id: L2, conector_id: 'erp-1', entidade: 'cliente', modo: 'delta', status: 'concluido_com_erros', recebido_em: '2026-11-23T12:00:00.000Z', concluido_em: '2026-11-23T12:01:00.000Z', tem_conteudo: true },
      { lote_id: L3, conector_id: 'erp-1', entidade: 'cliente', modo: 'delta', status: 'falhou', recebido_em: '2026-11-22T09:00:00.000Z', concluido_em: null, tem_conteudo: false },
    ],
    erros: [
      { entidade: 'cliente', codigo: 'referencia_ausente', reprocessavel: true, linhas: 4 },
      { entidade: 'cliente', codigo: 'campo_obrigatorio', reprocessavel: false, linhas: 2 },
    ],
    ...e,
  };
}

describe('Monitor detalhado da Integração no portal (desenho empresa-zerar §6.4)', () => {
  it('RN-INT-04: as entidades saem na ordem de carga, as de algum Conector ativo e as que têm dado no Hub', () => {
    const r = montarMonitorDetalhes(entrada({ registros: [{ entidade: 'cliente', ativos: 1, inativos: 0 }, { entidade: 'filial', ativos: 2, inativos: 0 }] }));
    expect(r.entidades.map((x) => x.entidade)).toEqual(['filial', 'produto', 'cliente']);
    expect(MonitorDetalhes.safeParse(r).success).toBe(true);
  });

  it('RN-INT-15: lotes reprocessáveis = com falha ou com avisos que ainda têm conteúdo, do mais antigo ao mais recente', () => {
    const cliente = montarMonitorDetalhes(entrada()).entidades.find((x) => x.entidade === 'cliente')!;
    expect(cliente.lotes_reprocessaveis).toEqual([L1, L2]);
  });

  it('RN-INT-03: erros por código com a classe (reprocessável ou corrigir no ERP), o maior primeiro', () => {
    const cliente = montarMonitorDetalhes(entrada()).entidades.find((x) => x.entidade === 'cliente')!;
    expect(cliente.erros).toEqual([
      { codigo: 'referencia_ausente', classe: 'reprocessavel', linhas: 4 },
      { codigo: 'campo_obrigatorio', classe: 'corrigir_no_erp', linhas: 2 },
    ]);
    expect(classeDoErroLinha(false)).toBe('corrigir_no_erp');
  });

  it('RF-INT-04: por entidade, o cursor do Hub, os registros e o último lote recebido', () => {
    const r = montarMonitorDetalhes(entrada());
    const cliente = r.entidades.find((x) => x.entidade === 'cliente')!;
    expect(cliente.cursores).toEqual([{ conector_id: 'erp-1', alterado_em: '2026-11-23T14:00:00.000Z', external_id: 'C9', atualizado_em: '2026-11-23T14:01:00.000Z' }]);
    expect(cliente.registros).toEqual({ ativos: 120, inativos: 3 });
    expect(cliente.ultimo_lote?.lote_id).toBe(L2);
    const produto = r.entidades.find((x) => x.entidade === 'produto')!;
    expect(produto).toEqual({ entidade: 'produto', cursores: [], registros: { ativos: 0, inativos: 0 }, ultimo_lote: null, erros: [], lotes_reprocessaveis: [] });
  });

  it('RF-INT-06: o Conector traz a saúde e o último sinal (fila, entidades, atualização)', () => {
    const [c] = montarMonitorDetalhes(entrada()).conectores;
    expect(c!.saude).toBe('ok');
    expect(c!.sinal).toEqual({ ...SINAL, atualizacao: null });
  });

  it('RF-INT-06: sinal ausente ou fora do formato vira null sem derrubar o detalhe', () => {
    expect(sinalResumoDoConector(null)).toBeNull();
    expect(sinalResumoDoConector({ fila: 'x' })).toBeNull();
    expect(sinalResumoDoConector([])).toBeNull();
  });

  it('RN-INT-10: Conector desativado não traz as entidades dele para a lista', () => {
    const r = montarMonitorDetalhes(entrada({ conectores: [{ ...entrada().conectores[0]!, ativo: false }], registros: [], cursores: [], lotes: [], erros: [] }));
    expect(r.entidades).toEqual([]);
    expect(r.conectores[0]!.saude).toBe('desativado');
  });
});
