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

describe('RN-PRO-06: checkout exige as etapas obrigatórias', () => {
  it('bloqueia o checkout com etapa obrigatória pendente e diz qual é', () => {
    const r = avaliarCheckout({ desfecho: 'realizada', etapas, tem_foto_fachada: false });
    expect(r.pode).toBe(false);
    expect(r.pendentes).toEqual(['Medir o share de massas']);
    expect(r.motivo_bloqueio).toMatch(/Medir o share de massas/);
    expect(r.motivo_bloqueio).toMatch(/conclua/i);
  });

  it('libera o checkout quando só faltam etapas opcionais', () => {
    const ok = etapas.map((e) => (e.obrigatoria ? { ...e, concluida: true } : e));
    expect(avaliarCheckout({ desfecho: 'realizada', etapas: ok, tem_foto_fachada: false })).toMatchObject({ pode: true, pendentes: [], motivo_bloqueio: null });
  });

  it('RN-PRO-06: loja fechada com foto da fachada libera o checkout mesmo com etapas pendentes', () => {
    expect(avaliarCheckout({ desfecho: 'loja_fechada', etapas, tem_foto_fachada: true }).pode).toBe(true);
  });

  it('RN-PRO-06: acesso negado com foto da fachada libera o checkout', () => {
    expect(avaliarCheckout({ desfecho: 'acesso_negado', etapas, tem_foto_fachada: true }).pode).toBe(true);
  });

  it('RN-PRO-06: loja fechada/acesso negado sem foto da fachada bloqueia, pedindo a foto', () => {
    const r = avaliarCheckout({ desfecho: 'loja_fechada', etapas, tem_foto_fachada: false });
    expect(r.pode).toBe(false);
    expect(r.motivo_bloqueio).toMatch(/foto da fachada/i);
    expect(avaliarCheckout({ desfecho: 'acesso_negado', etapas, tem_foto_fachada: false }).pode).toBe(false);
  });

  it('RN-PRO-06: sem checklist cadastrado o checkout é livre', () => {
    expect(avaliarCheckout({ desfecho: 'realizada', etapas: [], tem_foto_fachada: false }).pode).toBe(true);
  });
});
