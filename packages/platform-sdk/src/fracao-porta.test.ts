import { describe, expect, it } from 'vitest';
import { criarPortaVersaoAppMemoria } from './app-versao';
import { fracaoLiberadaNaPorta, variacaoFracao } from './fracao-porta';

// ADR 0076 D6 (RN-VEN-02 v3): trava da fração lida na porta `ctx.versaoApp` e variação do pull.

const AGORA = new Date('2026-12-02T12:00:00Z');
const publicada36 = { versao: '1.0.36', publicada_em: '2026-12-01T00:00:00Z' };

describe('fracaoLiberadaNaPorta (ADR 0076 D6)', () => {
  it('sem porta = fechada', async () => {
    expect(await fracaoLiberadaNaPorta(undefined, AGORA)).toBe(false);
  });
  it('Campo e Gestão na 1.0.36 há mais de 24 h = liberada', async () => {
    const porta = criarPortaVersaoAppMemoria({ campo: publicada36, gestao: publicada36 });
    expect(await fracaoLiberadaNaPorta(porta, AGORA)).toBe(true);
  });
  it('só o Campo publicado = fechada', async () => {
    const porta = criarPortaVersaoAppMemoria({ campo: publicada36 });
    expect(await fracaoLiberadaNaPorta(porta, AGORA)).toBe(false);
  });
  it('dentro das 24 h de convivência = fechada', async () => {
    const porta = criarPortaVersaoAppMemoria({ campo: publicada36, gestao: publicada36 });
    expect(await fracaoLiberadaNaPorta(porta, new Date('2026-12-01T23:59:59Z'))).toBe(false);
  });
});

describe('variacaoFracao (ADR 0076 D6, pull filtrado)', () => {
  it('fracao=1 com app na 1.0.36 ou maior; fracao=0 com app antigo ou sem cabeçalho', () => {
    expect(variacaoFracao({ variante: 'campo', versao: '1.0.36' })).toBe('fracao=1');
    expect(variacaoFracao({ variante: 'gestao', versao: '1.0.40' })).toBe('fracao=1');
    expect(variacaoFracao({ variante: 'campo', versao: '1.0.35' })).toBe('fracao=0');
    expect(variacaoFracao(null)).toBe('fracao=0');
  });
});
