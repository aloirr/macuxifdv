import { describe, expect, it } from 'vitest';
import { validarEnvelope } from './envelope';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
const delta = (extra: Record<string, unknown> = {}) => ({ versao_contrato: 'v1', entidade: 'cliente', modo: 'delta', registros: [{ external_id: 'C1' }], ...extra });
const codigos = (r: ReturnType<typeof validarEnvelope>) => (r.ok ? [] : r.erros.map((e) => e.codigo));

describe('RN-INT-01: validar envelope do lote', () => {
  it('RN-INT-01: aceita lote delta de uma entidade conhecida', () => {
    const r = validarEnvelope(delta());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.entidade).toBe('cliente');
  });

  it('RN-INT-01: aceita carga completa com sessão (parte n, último)', () => {
    const r = validarEnvelope(delta({ modo: 'completo', sessao: { id: UUID, parte: 1, ultimo: false } }));
    expect(r.ok).toBe(true);
  });

  it('RN-INT-01: recusa entidade desconhecida, inteiro', () => {
    const r = validarEnvelope(delta({ entidade: 'pedido_x' }));
    expect(codigos(r)).toEqual(['entidade_desconhecida']);
  });

  it('RN-INT-01: recusa lote vazio', () => {
    expect(codigos(validarEnvelope(delta({ registros: [] })))).toEqual(['lote_vazio']);
  });

  it('RN-INT-01: recusa acima do limite (5.000 por padrão) e respeita limite parametrizado', () => {
    const muitos = Array.from({ length: 5001 }, (_, i) => ({ external_id: `C${i}` }));
    expect(codigos(validarEnvelope(delta({ registros: muitos })))).toEqual(['acima_do_limite']);
    expect(validarEnvelope(delta({ registros: muitos.slice(0, 5000) })).ok).toBe(true);
    expect(codigos(validarEnvelope(delta({ registros: muitos.slice(0, 11) }), { limiteRegistros: 10 }))).toEqual(['acima_do_limite']);
  });

  it('RN-INT-01: recusa versão de contrato não suportada', () => {
    const r = validarEnvelope(delta({ versao_contrato: 'v2' }));
    expect(codigos(r)).toEqual(['versao_nao_suportada']);
    expect(validarEnvelope(delta({ versao_contrato: 'v2' }), { versoesSuportadas: ['v1', 'v2'] }).ok).toBe(true);
  });

  it('RN-INT-01/06: carga completa exige sessão; delta não leva sessão', () => {
    expect(codigos(validarEnvelope(delta({ modo: 'completo' })))).toEqual(['sessao_ausente']);
    expect(codigos(validarEnvelope(delta({ sessao: { id: UUID, parte: 1, ultimo: true } })))).toEqual(['sessao_nao_se_aplica']);
  });

  it('RN-INT-01: corpo que não é objeto, modo inválido e registros ausentes viram envelope_invalido sem vazar valores', () => {
    expect(codigos(validarEnvelope('texto'))).toEqual(['envelope_invalido']);
    expect(codigos(validarEnvelope(null))).toEqual(['envelope_invalido']);
    const r = validarEnvelope(delta({ modo: 'SEGREDO-123', registros: undefined }));
    expect(codigos(r)).toEqual(['envelope_invalido', 'envelope_invalido']);
    expect(JSON.stringify(r)).not.toContain('SEGREDO-123');
  });
});
