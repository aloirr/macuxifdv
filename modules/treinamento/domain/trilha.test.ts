import { describe, expect, it } from 'vitest';
import {
  licoesOrdenadas,
  progressoDaTrilha,
  proximaLicao,
  requisitosDaLicao,
  statusDaLicao,
  statusDoModulo,
  trilhaConcluida,
  trilhasDisponiveis,
  trilhasPendentes,
  usuarioNoPublico,
  validarTrilha,
  type TrilhaDef,
} from './trilha';

/** Trilha de 2 módulos: M1 (L1, L2) e M2 (L3). Sequencial. */
const trilha = (parcial: Partial<TrilhaDef> = {}): TrilhaDef => ({
  id: 'T1',
  status: 'publicada',
  obrigatoria: true,
  sequencial: true,
  prazo: null,
  publico_alvo: { perfis: [], equipes: [] },
  modulos: [
    { id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L2', ordem: 2 }] },
    { id: 'M2', ordem: 2, licoes: [{ id: 'L3', ordem: 1 }] },
  ],
  ...parcial,
});

describe('RF-TRE-02: progresso na trilha', () => {
  it('RF-TRE-02: lista as lições na ordem módulo → lição, mesmo se vierem embaralhadas', () => {
    const t = trilha({ modulos: [{ id: 'M2', ordem: 2, licoes: [{ id: 'L3', ordem: 1 }] }, { id: 'M1', ordem: 1, licoes: [{ id: 'L2', ordem: 2 }, { id: 'L1', ordem: 1 }] }] });
    expect(licoesOrdenadas(t).map((l) => l.id)).toEqual(['L1', 'L2', 'L3']);
  });

  it('RF-TRE-02: 1 de 3 lições concluídas = 33,33%', () => {
    const p = progressoDaTrilha(trilha(), ['L1']);
    expect(p).toMatchObject({ concluidas: 1, total: 3, pct: 33.33, concluida: false });
    expect(p.modulos).toEqual([
      { modulo_id: 'M1', concluidas: 1, total: 2, concluido: false },
      { modulo_id: 'M2', concluidas: 0, total: 1, concluido: false },
    ]);
  });

  it('RF-TRE-02: ids de lições de outra trilha não entram na conta', () => {
    expect(progressoDaTrilha(trilha(), ['L1', 'X9']).concluidas).toBe(1);
  });

  it('RF-TRE-02: todas as lições concluídas = trilha concluída (100%)', () => {
    const p = progressoDaTrilha(trilha(), new Set(['L1', 'L2', 'L3']));
    expect(p).toMatchObject({ pct: 100, concluida: true });
    expect(trilhaConcluida(trilha(), ['L1', 'L2', 'L3'])).toBe(true);
    expect(trilhaConcluida(trilha(), ['L1', 'L2'])).toBe(false);
  });

  it('RF-TRE-02: trilha sem lições nunca conta como concluída (0%)', () => {
    const vazia = trilha({ modulos: [] });
    expect(progressoDaTrilha(vazia, [])).toMatchObject({ total: 0, pct: 0, concluida: false });
  });

  it('RF-TRE-02: retomar de onde parou = primeira lição liberada e não concluída', () => {
    expect(proximaLicao(trilha(), [])).toBe('L1');
    expect(proximaLicao(trilha(), ['L1'])).toBe('L2');
    expect(proximaLicao(trilha(), ['L1', 'L2'])).toBe('L3');
    expect(proximaLicao(trilha(), ['L1', 'L2', 'L3'])).toBeNull();
  });
});

describe('RF-TRE-01: pré-requisitos de lição e de módulo', () => {
  it('RF-TRE-01: trilha sequencial bloqueia a lição até concluir a anterior', () => {
    expect(statusDaLicao(trilha(), 'L1', [])).toMatchObject({ status: 'liberada', pendentes: [] });
    expect(statusDaLicao(trilha(), 'L2', [])).toMatchObject({ status: 'bloqueada', pendentes: ['L1'] });
    expect(statusDaLicao(trilha(), 'L2', ['L1']).status).toBe('liberada');
    expect(statusDaLicao(trilha(), 'L2', ['L1', 'L2']).status).toBe('concluida');
  });

  it('RF-TRE-01: módulo bloqueado até concluir todas as lições do módulo anterior', () => {
    expect(statusDoModulo(trilha(), 'M2', ['L1'])).toMatchObject({ status: 'bloqueado', pendentes: ['M1'] });
    expect(statusDaLicao(trilha(), 'L3', ['L1']).status).toBe('bloqueada');
    expect(statusDoModulo(trilha(), 'M2', ['L1', 'L2']).status).toBe('liberado');
    expect(statusDaLicao(trilha(), 'L3', ['L1', 'L2']).status).toBe('liberada');
    expect(statusDoModulo(trilha(), 'M1', ['L1', 'L2']).status).toBe('concluido');
  });

  it('RF-TRE-01: trilha não sequencial libera tudo, salvo pré-requisitos explícitos', () => {
    const t = trilha({ sequencial: false });
    expect(statusDaLicao(t, 'L3', []).status).toBe('liberada');
    const comExplicito = trilha({
      sequencial: false,
      modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L2', ordem: 2, pre_requisitos: ['L1'] }] }],
    });
    expect(requisitosDaLicao(comExplicito, 'L2')).toEqual(['L1']);
    expect(statusDaLicao(comExplicito, 'L2', []).status).toBe('bloqueada');
    expect(statusDaLicao(comExplicito, 'L1', []).status).toBe('liberada');
  });

  it('RF-TRE-01: pré-requisito explícito de módulo exige todas as lições do módulo citado', () => {
    const t = trilha({
      sequencial: false,
      modulos: [
        { id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L2', ordem: 2 }] },
        { id: 'M2', ordem: 2, licoes: [{ id: 'L3', ordem: 1 }] },
        { id: 'M3', ordem: 3, pre_requisitos: ['M1'], licoes: [{ id: 'L4', ordem: 1 }] },
      ],
    });
    expect(statusDaLicao(t, 'L4', ['L1']).status).toBe('bloqueada');
    expect(statusDaLicao(t, 'L4', ['L1', 'L2']).status).toBe('liberada');
    expect(statusDoModulo(t, 'M3', []).pendentes).toEqual(['M1']);
  });

  it('RF-TRE-01: lição inexistente é erro em português', () => {
    expect(() => statusDaLicao(trilha(), 'XX', [])).toThrow(/não existe/);
  });

  it('RF-TRE-01: validarTrilha acusa pré-requisito inexistente, ciclo e ids repetidos', () => {
    const inexistente = trilha({ modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1, pre_requisitos: ['L9'] }] }] });
    expect(validarTrilha(inexistente).join(' ')).toMatch(/L9/);
    const ciclo = trilha({
      sequencial: false,
      modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1, pre_requisitos: ['L2'] }, { id: 'L2', ordem: 2, pre_requisitos: ['L1'] }] }],
    });
    expect(validarTrilha(ciclo).join(' ')).toMatch(/ciclo/i);
    const repetido = trilha({ modulos: [{ id: 'M1', ordem: 1, licoes: [{ id: 'L1', ordem: 1 }, { id: 'L1', ordem: 2 }] }] });
    expect(validarTrilha(repetido).join(' ')).toMatch(/repetid/i);
    expect(validarTrilha(trilha())).toEqual([]);
  });
});

describe('RF-TRE-01: público-alvo e trilhas obrigatórias pendentes', () => {
  const vendedorNorte = { perfil: 'vendedor', equipe_id: 'norte' };

  it('RF-TRE-01: público vazio (perfis e equipes) = todo o tenant', () => {
    expect(usuarioNoPublico({ perfis: [], equipes: [] }, vendedorNorte)).toBe(true);
  });

  it('RF-TRE-01: filtra por perfil e por equipe (os dois critérios preenchidos valem juntos)', () => {
    expect(usuarioNoPublico({ perfis: ['vendedor'], equipes: [] }, vendedorNorte)).toBe(true);
    expect(usuarioNoPublico({ perfis: ['promotor'], equipes: [] }, vendedorNorte)).toBe(false);
    expect(usuarioNoPublico({ perfis: [], equipes: ['sul'] }, vendedorNorte)).toBe(false);
    expect(usuarioNoPublico({ perfis: ['vendedor'], equipes: ['norte'] }, vendedorNorte)).toBe(true);
    expect(usuarioNoPublico({ perfis: ['vendedor'], equipes: ['sul'] }, vendedorNorte)).toBe(false);
    expect(usuarioNoPublico({ perfis: [], equipes: ['norte'] }, { perfil: 'vendedor', equipe_id: null })).toBe(false);
  });

  it('RF-TRE-01: rascunho e arquivada não aparecem para o usuário', () => {
    const ts = [trilha({ id: 'A' }), trilha({ id: 'B', status: 'rascunho' }), trilha({ id: 'C', status: 'arquivada' })];
    expect(trilhasDisponiveis(ts, vendedorNorte).map((t) => t.id)).toEqual(['A']);
  });

  it('RF-TRE-01: obrigatória publicada, no público e não concluída é pendente; concluída sai da lista', () => {
    const ts = [
      trilha({ id: 'A', publico_alvo: { perfis: ['vendedor'], equipes: [] } }),
      trilha({ id: 'B', publico_alvo: { perfis: ['promotor'], equipes: [] } }),
      trilha({ id: 'C', obrigatoria: false }),
      trilha({ id: 'D', modulos: [{ id: 'MD', ordem: 1, licoes: [{ id: 'LD', ordem: 1 }] }] }),
    ];
    const pend = trilhasPendentes(ts, vendedorNorte, ['LD'], '2026-10-31');
    expect(pend.map((p) => p.trilha_id)).toEqual(['A']);
    expect(pend[0]).toMatchObject({ progresso_pct: 0, atrasada: false, prazo: null });
  });

  it('RF-TRE-01: prazo vencido marca atrasada; ordena por prazo (sem prazo por último)', () => {
    const ts = [
      trilha({ id: 'SEM' }),
      trilha({ id: 'LONGE', prazo: '2026-12-31' }),
      trilha({ id: 'VENCIDA', prazo: '2026-10-30' }),
      trilha({ id: 'HOJE', prazo: '2026-10-31' }),
    ];
    const pend = trilhasPendentes(ts, vendedorNorte, [], '2026-10-31');
    expect(pend.map((p) => p.trilha_id)).toEqual(['VENCIDA', 'HOJE', 'LONGE', 'SEM']);
    expect(pend.map((p) => p.atrasada)).toEqual([true, false, false, false]);
    expect(pend[0]).toMatchObject({ dias_para_prazo: -1 });
    expect(pend[1]).toMatchObject({ dias_para_prazo: 0 });
  });
});
