import { describe, expect, it } from 'vitest';
import { avaliarVersao, compararVersoes, lerSemver, VERSAO_CONECTOR } from '../src/versao';

describe('semver (função pura)', () => {
  it('lê MAIOR.MENOR.PATCH e pré-lançamento; recusa lixo', () => {
    expect(lerSemver('1.2.3')).toEqual({ maior: 1, menor: 2, patch: 3, pre: [] });
    expect(lerSemver('v1.2.3-rc.1')).toEqual({ maior: 1, menor: 2, patch: 3, pre: ['rc', '1'] });
    for (const ruim of ['1.2', '1.2.3.4', 'abc', '01.2.3', '', '1.2.3+build']) expect(lerSemver(ruim), ruim).toBeNull();
  });

  it('compara numericamente, não como texto (1.10.0 > 1.9.0)', () => {
    expect(compararVersoes('1.10.0', '1.9.0')).toBe(1);
    expect(compararVersoes('1.9.0', '1.10.0')).toBe(-1);
    expect(compararVersoes('2.0.0', '1.99.99')).toBe(1);
    expect(compararVersoes('1.1.0', '1.1.0')).toBe(0);
    expect(compararVersoes('1.1.1', '1.1.0')).toBe(1);
  });

  it('pré-lançamento vem antes da versão estável e segue a ordem do semver 2.0', () => {
    expect(compararVersoes('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compararVersoes('1.2.0', '1.2.0-rc.1')).toBe(1);
    expect(compararVersoes('1.2.0-rc.2', '1.2.0-rc.10')).toBe(-1);
    expect(compararVersoes('1.2.0-alpha', '1.2.0-beta')).toBe(-1);
    expect(compararVersoes('1.2.0-1', '1.2.0-alpha')).toBe(-1);
    expect(compararVersoes('1.2.0-rc', '1.2.0-rc.1')).toBe(-1);
  });

  it('versão inválida na comparação é erro explícito', () => {
    expect(() => compararVersoes('1.2', '1.2.0')).toThrow(/Versão inválida/);
  });
});

describe('política de versão do Hub (mínima e recomendada)', () => {
  const politica = { versao_minima: '1.0.0', versao_recomendada: '1.2.0' };

  it('a versão do Conector é semver válido', () => {
    expect(lerSemver(VERSAO_CONECTOR)).not.toBeNull();
  });

  it('em dia: igual ou acima da recomendada', () => {
    expect(avaliarVersao('1.2.0', politica)).toMatchObject({ situacao: 'ok', deveParar: false });
    expect(avaliarVersao('1.3.0', politica)).toMatchObject({ situacao: 'ok', deveParar: false });
  });

  it('desatualizado: abaixo da recomendada mas não da mínima — segue funcionando', () => {
    const r = avaliarVersao('1.1.0', politica);
    expect(r).toMatchObject({ situacao: 'desatualizado', deveParar: false });
    expect(r.mensagem).toContain('desatualizada');
    expect(avaliarVersao('1.0.0', politica).situacao).toBe('desatualizado');
  });

  it('abaixo da mínima: para de enviar e explica a ação seguinte em português', () => {
    const r = avaliarVersao('0.9.9', { ...politica, mensagem: 'Falha de segurança corrigida na 1.0.0.' });
    expect(r).toMatchObject({ situacao: 'abaixo_da_minima', deveParar: true });
    expect(r.mensagem).toContain('abaixo da mínima 1.0.0');
    expect(r.mensagem).toContain('parou de enviar');
    expect(r.mensagem).toContain('Falha de segurança');
  });

  it('pré-lançamento da mínima ainda está abaixo dela', () => {
    expect(avaliarVersao('1.0.0-rc.1', politica).deveParar).toBe(true);
  });

  it('sem política (ou ilegível) não restringe nada', () => {
    expect(avaliarVersao('0.0.1', null)).toMatchObject({ situacao: 'sem_politica', deveParar: false });
    expect(avaliarVersao('0.0.1', undefined).deveParar).toBe(false);
    expect(avaliarVersao('0.0.1', { versao_minima: 'x', versao_recomendada: '1.0.0' })).toMatchObject({ situacao: 'sem_politica', deveParar: false });
  });

  it('política inconsistente (mínima > recomendada): a mínima manda', () => {
    const r = avaliarVersao('1.1.0', { versao_minima: '1.5.0', versao_recomendada: '1.2.0' });
    expect(r).toMatchObject({ situacao: 'abaixo_da_minima', deveParar: true });
    expect(avaliarVersao('1.5.0', { versao_minima: '1.5.0', versao_recomendada: '1.2.0' }).situacao).toBe('ok');
  });
});
