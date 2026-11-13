/**
 * T-0170 — metas de produtividade (`metaProdutividadeVigente`, `metasProdutividadeVigentes`, `validarMetaProdutividade`,
 * RN-CORE-45, §6 do desenho), sem banco. Roteiro e oráculo: docs/testes/T-0170-performance.md §5 (M-1 a M-11, VAL-1 a VAL-14).
 * Árvore: Norte (raiz) › Boa Vista (equipe do V1). Hoje = 13/11/2026 (mês 2026-11).
 */
import { describe, expect, it } from 'vitest';

import type { IndicadorProdutividade } from '../../modules/core/contracts/performance';
import {
  metaProdutividadeVigente,
  metasProdutividadeVigentes,
  validarMetaProdutividade,
  type EquipeArvore,
  type LinhaMetaProdutividade,
} from '../../modules/core/domain/performance/metas-produtividade';

const V1 = '00000000-0000-4000-8000-000000000001';
const NORTE = '00000000-0000-4000-8000-000000000002';
const BOA_VISTA = '00000000-0000-4000-8000-000000000003';
const EQUIPES: EquipeArvore[] = [
  { id: NORTE, equipe_pai_id: null },
  { id: BOA_VISTA, equipe_pai_id: NORTE },
];

const tenant = (valor: number, vigencia_inicio = '2026-11', indicador: IndicadorProdutividade = 'tma'): LinhaMetaProdutividade => ({
  escopo: 'tenant', equipe_id: null, usuario_id: null, indicador, valor, vigencia_inicio,
});
const equipe = (equipe_id: string, valor: number, vigencia_inicio = '2026-11'): LinhaMetaProdutividade => ({
  escopo: 'equipe', equipe_id, usuario_id: null, indicador: 'tma', valor, vigencia_inicio,
});
const usuario = (
  valor: number,
  vigencia_inicio = '2026-11',
  indicador: IndicadorProdutividade = 'tma',
  deleted_at: string | null = null,
): LinhaMetaProdutividade => ({
  escopo: 'usuario', equipe_id: null, usuario_id: V1, indicador, valor, vigencia_inicio, deleted_at,
});

const tmaDoV1 = (linhas: LinhaMetaProdutividade[], mes = '2026-11') =>
  metaProdutividadeVigente({ linhas, equipes: EQUIPES, alvo: { usuario_id: V1, equipe_id: BOA_VISTA }, mes, indicador: 'tma' });

describe('T-0170 · qual meta de produtividade vale (RN-CORE-45, §6.2)', () => {
  it.each([
    ['M-1 sem nenhuma linha: padrão do FDV', [], 30, 'padrao_fdv'],
    ['M-2 linha do tenant', [tenant(45)], 45, 'tenant'],
    ['M-3 Boa Vista sem linha: sobe até Norte, que vence o tenant', [tenant(45), equipe(NORTE, 40)], 40, 'equipe'],
    ['M-4 a equipe mais próxima (Boa Vista) vence Norte', [tenant(45), equipe(NORTE, 40), equipe(BOA_VISTA, 50)], 50, 'equipe'],
    ['M-5 a linha do usuário vence tudo', [tenant(45), equipe(NORTE, 40), usuario(42)], 42, 'usuario'],
    ['M-6 "voltar a herdar" (linha do usuário removida) volta à equipe', [tenant(45), equipe(NORTE, 40), usuario(42, '2026-11', 'tma', '2026-11-13T12:00:00.000Z')], 40, 'equipe'],
    ['M-7 no mesmo nível vale a maior vigência ≤ mês', [tenant(50, '2026-09'), tenant(45, '2026-11')], 45, 'tenant'],
    ['M-9 a linha do usuário com vigência em dezembro ainda não vale', [usuario(35, '2026-12'), equipe(NORTE, 40)], 40, 'equipe'],
  ] as const)('%s', (_caso, linhas, valor, origem) => {
    expect(tmaDoV1([...linhas])).toEqual({ valor, origem });
  });

  it('M-8 · Mês passado (outubro): a linha de 2026-11 ainda não vale; vale a de 2026-09', () => {
    expect(tmaDoV1([tenant(50, '2026-09'), tenant(45, '2026-11')], '2026-10')).toEqual({ valor: 50, origem: 'tenant' });
  });

  it('M-11 · só km por dia do usuário (100 km): os outros 11 seguem o padrão do FDV', () => {
    const m = metasProdutividadeVigentes({
      linhas: [usuario(100_000, '2026-11', 'km_dia')],
      equipes: EQUIPES,
      alvo: { usuario_id: V1, equipe_id: BOA_VISTA },
      mes: '2026-11',
    });
    expect(m.km_dia).toEqual({ valor: 100_000, origem: 'usuario' });
    const outros = Object.entries(m).filter(([k]) => k !== 'km_dia');
    expect(outros).toHaveLength(11);
    expect(outros.every(([, v]) => v.origem === 'padrao_fdv')).toBe(true);
    expect(m.tma.valor).toBe(30);
  });
});

describe('T-0170 · validação da edição de metas no BKO (RN-CORE-45, §6.4)', () => {
  const validar = (
    metas: { indicador: string; valor: number }[],
    o: { escopo?: string; equipe_id?: string | null; usuario_id?: string | null; vigencia_inicio?: string } = {},
  ) =>
    validarMetaProdutividade({
      edicao: {
        escopo: o.escopo ?? 'tenant',
        equipe_id: o.equipe_id ?? null,
        usuario_id: o.usuario_id ?? null,
        vigencia_inicio: o.vigencia_inicio ?? '2026-11',
        metas,
      },
      mes_hoje: '2026-11',
      linhas: [],
      equipes: EQUIPES,
    });
  const campos = (v: ReturnType<typeof validar>) => (v.ok ? [] : v.erros.map((e) => e.campo));

  it.each([
    ['VAL-1', 'tma', [[0, false], [1, true], [480, true], [481, false]]],
    ['VAL-2', 'almoco', [[0, true], [240, true], [241, false]]],
    ['VAL-3', 'jornada_liquida', [[59, false], [60, true], [960, true], [961, false]]],
    ['VAL-5', 'fora_rota', [[10_000, true], [10_001, false]]],
    ['VAL-6', 'visitas_dia', [[0, false], [1, true], [1000, true], [1001, false]]],
    ['VAL-7', 'raio_checkin', [[0, false], [5000, true], [5001, false]]],
    ['VAL-8', 'km_dia', [[999, false], [1000, true], [2_000_000, true], [2_000_001, false]]],
    ['VAL-9', 'km_cliente', [[99, false], [100, true], [500_000, true], [500_001, false]]],
  ] as const)('%s · faixa de %s (§6.4)', (_caso, indicador, casos) => {
    for (const [valor, ok] of casos) {
      const v = validar([{ indicador, valor }]);
      expect([valor, v.ok]).toEqual([valor, ok]);
      if (!v.ok) expect(v).toMatchObject({ codigo: 'META_PRODUTIVIDADE_INVALIDA', erros: [{ campo: indicador }] });
    }
  });

  it('VAL-4 · faixa do 1º check-in (00:00 a 23:59), com o último check-in 23:59 no lote para isolar a regra da ordem', () => {
    const lote = (valor: number) => [{ indicador: 'primeiro_checkin', valor }, { indicador: 'ultimo_checkin', valor: 1439 }];
    expect(validar(lote(0)).ok).toBe(true);
    expect(validar(lote(1439)).ok).toBe(true);
    expect(campos(validar(lote(1440)))).toEqual(['primeiro_checkin']);
  });

  it('VAL-10 · RN-CORE-30: o mês que já começou não muda (2026-10 inválido; 2026-11 e 2026-12 válidos)', () => {
    expect(campos(validar([{ indicador: 'tma', valor: 30 }], { vigencia_inicio: '2026-10' }))).toEqual(['vigencia_inicio']);
    expect(validar([{ indicador: 'tma', valor: 30 }], { vigencia_inicio: '2026-11' }).ok).toBe(true);
    expect(validar([{ indicador: 'tma', valor: 30 }], { vigencia_inicio: '2026-12' }).ok).toBe(true);
  });

  it('VAL-11 · último check-in 07:00 antes do 1º check-in resolvido (08:00, padrão): erro no último check-in', () => {
    expect(campos(validar([{ indicador: 'ultimo_checkin', valor: 420 }]))).toEqual(['ultimo_checkin']);
  });

  it('VAL-12 · 1º check-in 18:00 depois do último resolvido (17:00, padrão): erro no campo editado', () => {
    expect(campos(validar([{ indicador: 'primeiro_checkin', valor: 1080 }]))).toEqual(['primeiro_checkin']);
  });

  it('VAL-13 · o mesmo indicador duas vezes no lote é inválido', () => {
    const v = validar([{ indicador: 'tma', valor: 30 }, { indicador: 'tma', valor: 40 }]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.erros).toContainEqual({ campo: 'tma', mensagem: 'Indicador repetido.' });
  });

  it('VAL-14 · alvo incoerente: equipe sem equipe_id; tenant com usuario_id', () => {
    expect(campos(validar([{ indicador: 'tma', valor: 30 }], { escopo: 'equipe' }))).toEqual(['equipe_id']);
    expect(campos(validar([{ indicador: 'tma', valor: 30 }], { usuario_id: V1 }))).toEqual(['usuario_id']);
  });
});
