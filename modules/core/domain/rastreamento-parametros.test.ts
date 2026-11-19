import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { validarParametrosRastreamento } from './rastreamento-parametros';

const SEM_EXPEDIENTE = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };

describe('RN-CORE-13: parâmetro do rastreamento ao salvar', () => {
  it('RN-CORE-13: o padrão de fábrica (desligado) é válido', () => {
    expect(validarParametrosRastreamento(PARAMETROS_RASTREAMENTO_PADRAO)).toEqual({ ok: true });
  });
  it('RN-CORE-13: ligado com expediente de pelo menos um dia é válido', () => {
    expect(validarParametrosRastreamento({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true })).toEqual({ ok: true });
  });
  it('RN-CORE-13: sem expediente em nenhum dia, o rastreamento não liga (desligado segue salvando)', () => {
    const r = validarParametrosRastreamento({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true, expediente: SEM_EXPEDIENTE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]!.mensagem).toBe('Para ligar o rastreamento, defina o expediente de pelo menos um dia da semana.');
    expect(validarParametrosRastreamento({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: false, expediente: SEM_EXPEDIENTE })).toEqual({ ok: true });
  });
});
