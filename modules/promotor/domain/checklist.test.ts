import { describe, expect, it } from 'vitest';
import { avaliarCheckout, progressoChecklist, type EtapaChecklist } from './checklist';

const etapas: EtapaChecklist[] = [
  { id: 'a', rotulo: 'Fotografar a gôndola de biscoitos', obrigatoria: true, concluida: true },
  { id: 'b', rotulo: 'Medir o share de massas', obrigatoria: true, concluida: false },
  { id: 'c', rotulo: 'Conferir o ponto extra', obrigatoria: false, concluida: false },
];

describe('RF-PRO-02: checklist do dia por loja', () => {
  it('progresso: concluídas × pendentes e % concluído', () => {
    const p = progressoChecklist(etapas);
    expect(p).toMatchObject({ total: 3, concluidas: 1, pct_concluido: 33.33 });
    expect(p.pendentes.map((e) => e.id)).toEqual(['b', 'c']);
    expect(p.obrigatorias_pendentes.map((e) => e.id)).toEqual(['b']);
  });

  it('checklist vazio = 100% concluído (nada a fazer)', () => {
    expect(progressoChecklist([])).toMatchObject({ total: 0, pct_concluido: 100, obrigatorias_pendentes: [] });
  });
});

const aberto = { clienteFechado: false, motivoClienteFechado: null } as const;
const fechado = (motivo: 'loja_fechada' | 'acesso_negado') => ({ clienteFechado: true, motivoClienteFechado: motivo }) as const;

describe('RN-PRO-06: checkout exige as etapas obrigatórias', () => {
  it('bloqueia o checkout com etapa obrigatória pendente e diz qual é', () => {
    const r = avaliarCheckout({ contexto: aberto, etapas });
    expect(r.pode).toBe(false);
    expect(r.pendentes).toEqual(['Medir o share de massas']);
    expect(r.motivo_bloqueio).toMatch(/Medir o share de massas/);
    expect(r.motivo_bloqueio).toMatch(/conclua/i);
  });

  it('libera o checkout quando só faltam etapas opcionais', () => {
    const ok = etapas.map((e) => (e.obrigatoria ? { ...e, concluida: true } : e));
    expect(avaliarCheckout({ contexto: aberto, etapas: ok })).toMatchObject({ pode: true, pendentes: [], motivo_bloqueio: null });
  });

  it('RN-PRO-06 + RN-CORE-14: loja fechada dispensa as etapas obrigatórias', () => {
    expect(avaliarCheckout({ contexto: fechado('loja_fechada'), etapas })).toMatchObject({ pode: true, pendentes: [] });
  });

  it('RN-PRO-06 + RN-CORE-14: acesso negado dispensa as etapas obrigatórias', () => {
    expect(avaliarCheckout({ contexto: fechado('acesso_negado'), etapas }).pode).toBe(true);
  });

  it('RN-PRO-06: contexto sem o campo clienteFechado (montado à mão) conta como cliente aberto', () => {
    expect(avaliarCheckout({ contexto: {}, etapas }).pode).toBe(false);
  });

  it('RN-PRO-06: sem checklist cadastrado o checkout é livre', () => {
    expect(avaliarCheckout({ contexto: aberto, etapas: [] }).pode).toBe(true);
  });
});
