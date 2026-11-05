import { describe, expect, it } from 'vitest';
import {
  caminhoDispensa, ERRO_ALERTA_H, ERRO_JUSTIFICATIVA, filtrarPorEtapas, filtroEtapasDaUrl, rotuloSeloEtapas, temPendente, tituloDialogoEtapas, validarAlertaH, validarJustificativa, VisitaComEtapasSchema,
} from './etapas-visita';

describe('RN-CORE-12: etapas pendentes no BKO', () => {
  it('RN-CORE-12: filtro Etapas separa com pendência e sem pendência', () => {
    const v = [{ etapas_pendentes: 0 }, { etapas_pendentes: 2 }];
    expect(filtrarPorEtapas(v, 'true')).toEqual([{ etapas_pendentes: 2 }]);
    expect(filtrarPorEtapas(v, 'false')).toEqual([{ etapas_pendentes: 0 }]);
    expect(filtrarPorEtapas(v, '')).toHaveLength(2);
    expect(filtroEtapasDaUrl('x')).toBe('');
  });
  it('RN-CORE-12: selo com a palavra, singular e plural', () => {
    expect(rotuloSeloEtapas(1)).toBe('Etapa pendente');
    expect(rotuloSeloEtapas(2)).toBe('2 etapas pendentes');
  });
  it('RN-CORE-12: título do diálogo no fuso do tenant', () => {
    expect(tituloDialogoEtapas('Mercado Sol', '2026-11-04T12:02:00Z', 'America/Manaus')).toBe('Etapas · Mercado Sol · 04/11 08:02');
  });
  it('RN-CORE-12: justificativa da dispensa de 3 a 300 caracteres', () => {
    expect(validarJustificativa('  ab ')).toEqual({ ok: false, erro: ERRO_JUSTIFICATIVA });
    expect(validarJustificativa(' abc ')).toEqual({ ok: true, valor: 'abc' });
    expect(validarJustificativa('x'.repeat(301)).ok).toBe(false);
  });
  it('RN-CORE-12: prazo do alerta de 1 a 168 horas', () => {
    expect(validarAlertaH('24')).toEqual({ ok: true, valor: 24 });
    for (const t of ['', '0', '169', '1,5', 'a']) expect(validarAlertaH(t)).toEqual({ ok: false, erro: ERRO_ALERTA_H });
  });
  it('RN-CORE-12: caminho da dispensa escapa os trechos', () => {
    expect(caminhoDispensa('v1', 'pesquisa', 'q/1')).toBe('/core/visitas/v1/etapas/pesquisa/q%2F1/dispensa');
  });
  it('RN-CORE-12: temPendente olha a situação', () => {
    expect(temPendente([{ situacao: 'concluida' }])).toBe(false);
    expect(temPendente([{ situacao: 'pendente' }])).toBe(true);
  });
  it('RN-CORE-12: visita sem os campos novos vale 0 pendência', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const base = { id, usuario_id: id, usuario_nome: 'A', cliente_id: id, cliente_nome: 'C', data_local: '2026-11-04', checkin_em: '2026-11-04T12:00:00Z', checkout_em: null, fora_do_raio: false, distancia_m: null, justificativa_fora_raio: null, sem_gps: false, sugere_coordenada: false, extra: false, resultado: null, fechada_por: null, motivo_codigo: null, motivo_descricao: null, motivo_texto: null, foto_fachada_id: null };
    expect(VisitaComEtapasSchema.parse({ ...base, etapas: [] }).etapas_pendentes).toBe(0);
  });
});
