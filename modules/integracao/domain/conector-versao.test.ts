import { describe, expect, it } from 'vitest';
import { avaliarVersaoConector, compararSemver, lerSemver, politicaEfetiva, rotaBloqueadaPorVersao, validarPisoParaPedidos, validarPoliticaVersao, versaoInformada } from './conector-versao';

const politica = { versao_minima: '1.0.0', versao_recomendada: '1.2.0', mensagem: 'Baixe o pacote 1.2.0 no BKO.' };

describe('RN-INT-11 (proposta): comparação semver 2.0', () => {
  it('RN-INT-11: 1.10.0 > 1.9.0 e pré-lançamento vem antes da estável', () => {
    expect(compararSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compararSemver('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compararSemver('1.2.0-rc.2', '1.2.0-rc.10')).toBe(-1);
    expect(compararSemver('1.2.0', '1.2.0')).toBe(0);
  });

  it('RN-INT-11: texto que não é semver devolve null em lerSemver e erro em compararSemver', () => {
    expect(lerSemver('1.2')).toBeNull();
    expect(lerSemver('v1.2.3')).toMatchObject({ maior: 1, menor: 2, patch: 3 });
    expect(() => compararSemver('x', '1.0.0')).toThrow(/Versão inválida/);
  });
});

describe('RN-INT-11 (proposta): política de versão do Conector', () => {
  it('RN-INT-11: em dia (>= recomendada), desatualizado (entre mínima e recomendada) e abaixo da mínima (bloqueia)', () => {
    expect(avaliarVersaoConector('1.2.0', politica)).toMatchObject({ situacao: 'em_dia', bloqueia: false, aviso: null });
    const d = avaliarVersaoConector('1.1.0', politica);
    expect(d).toMatchObject({ situacao: 'desatualizado', bloqueia: false });
    expect(d.aviso).toMatch(/1\.2\.0/);
    const b = avaliarVersaoConector('0.9.9', politica);
    expect(b).toMatchObject({ situacao: 'abaixo_da_minima', bloqueia: true });
    expect(b.aviso).toMatch(/1\.0\.0/);
    expect(b.aviso).toMatch(/Baixe o pacote/);
  });

  it('RN-INT-11: sem política, ou versão ausente/ilegível, nunca bloqueia por engano', () => {
    expect(avaliarVersaoConector('0.0.1', null)).toMatchObject({ situacao: 'sem_politica', bloqueia: false });
    expect(avaliarVersaoConector(null, politica)).toMatchObject({ situacao: 'versao_ilegivel', bloqueia: false });
    expect(avaliarVersaoConector('abc', politica)).toMatchObject({ situacao: 'versao_ilegivel', bloqueia: false });
  });

  it('RN-INT-11: política inconsistente (mínima > recomendada) — a mínima manda', () => {
    const p = { versao_minima: '2.0.0', versao_recomendada: '1.5.0' };
    expect(avaliarVersaoConector('1.9.0', p)).toMatchObject({ situacao: 'abaixo_da_minima', bloqueia: true });
    expect(avaliarVersaoConector('2.0.0', p)).toMatchObject({ situacao: 'em_dia', bloqueia: false });
  });

  it('RN-INT-11: abaixo da mínima bloqueia toda rota de dados, mas o sinal de vida segue (o Hub precisa ver o Conector parado)', () => {
    expect(rotaBloqueadaPorVersao('enviar_lote', 'abaixo_da_minima')).toBe(true);
    expect(rotaBloqueadaPorVersao('retorno_pedido', 'abaixo_da_minima')).toBe(true);
    expect(rotaBloqueadaPorVersao('pedidos_pendentes', 'abaixo_da_minima')).toBe(true);
    expect(rotaBloqueadaPorVersao('sinal', 'abaixo_da_minima')).toBe(false);
    expect(rotaBloqueadaPorVersao('enviar_lote', 'desatualizado')).toBe(false);
    expect(rotaBloqueadaPorVersao('enviar_lote', 'sem_politica')).toBe(false);
  });

  it('RN-INT-11: a versão que vale é a do cabeçalho; se ilegível, a do corpo; senão nenhuma', () => {
    expect(versaoInformada('1.1.0', '1.0.0')).toBe('1.1.0');
    expect(versaoInformada('lixo', '1.0.0')).toBe('1.0.0');
    expect(versaoInformada(undefined, undefined)).toBeNull();
    expect(versaoInformada(' 1.3.0 ', null)).toBe('1.3.0');
  });

  it('RN-INT-11: o BKO não grava política com mínima acima da recomendada, versão ilegível ou pacote abaixo da recomendada', () => {
    expect(validarPoliticaVersao(politica)).toEqual({ ok: true });
    const a = validarPoliticaVersao({ versao_minima: '1.3.0', versao_recomendada: '1.2.0' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.erros[0]).toMatch(/mínima/);
    const b = validarPoliticaVersao({ versao_minima: 'x', versao_recomendada: '1.2.0' });
    expect(b.ok).toBe(false);
    const c = validarPoliticaVersao({ ...politica, pacote: { versao: '1.1.0', sha256: 'a'.repeat(64) } });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.erros[0]).toMatch(/pacote/);
  });
});

describe('RN-INT-11: piso 1.2.1 para Conector que recebe pedidos', () => {
  it('RN-INT-11: sem política gravada, quem recebe pedidos exige 1.2.1 (1.2.0 é recusado com a mensagem de atualizar)', () => {
    const p = politicaEfetiva(null, true);
    expect(p).toMatchObject({ versao_minima: '1.2.1', versao_recomendada: '1.2.1' });
    const a = avaliarVersaoConector('1.2.0', p);
    expect(a).toMatchObject({ situacao: 'abaixo_da_minima', bloqueia: true });
    expect(a.aviso).toMatch(/1\.2\.0.*abaixo da mínima exigida \(1\.2\.1\)\. Atualize o Conector/);
    expect(avaliarVersaoConector('1.2.1', p).bloqueia).toBe(false);
  });
  it('RN-INT-11: sem política e sem receber pedidos, não há política', () => {
    expect(politicaEfetiva(null, false)).toBeNull();
    expect(politicaEfetiva(undefined, false)).toBeNull();
  });
  it('RN-INT-11: com política gravada vale a da empresa, mesmo abaixo do piso', () => {
    expect(politicaEfetiva(politica, true)).toBe(politica);
    expect(avaliarVersaoConector('1.2.0', politicaEfetiva(politica, true)).bloqueia).toBe(false);
  });
  it('RN-INT-11: o PUT recusa mínima abaixo de 1.2.1 para quem recebe pedidos, e aceita 1.2.1 ou mais', () => {
    const r = validarPisoParaPedidos({ versao_minima: '1.1.0' }, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatch(/exige Conector 1\.2\.1/);
    expect(validarPisoParaPedidos({ versao_minima: '1.2.1' }, true).ok).toBe(true);
    expect(validarPisoParaPedidos({ versao_minima: '1.10.0' }, true).ok).toBe(true);
    expect(validarPisoParaPedidos({ versao_minima: '1.1.0' }, false).ok).toBe(true);
  });
});
