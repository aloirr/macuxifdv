/**
 * T-0172: tela única de entrada. O logo do JS fica no mesmo lugar e no mesmo tamanho da splash nativa (sem corte), a lista
 * de etapas só entra se couber abaixo do logo, e os rótulos são só o nome da etapa e o percentual.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  cabeLista,
  erroDeSinal,
  LARGURA_LOGO_ENTRADA,
  posicaoDoLogo,
  rotuloDaBarra,
  textoDoErro,
} from './entrada';
import { PROPORCAO_LOGO_EMPILHADO } from './logo-marca';

/** Largura e altura de um PNG (cabeçalho IHDR). */
function tamanhoPng(caminho: URL): { largura: number; altura: number } {
  const b = readFileSync(caminho);
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

describe('logo da entrada × splash nativa', () => {
  it('mesma largura do app.config.ts e mesma proporção das splash-*.png', () => {
    const config = readFileSync(new URL('../../app.config.ts', import.meta.url), 'utf8');
    expect(config).toContain(`const LARGURA_LOGO_SPLASH = ${LARGURA_LOGO_ENTRADA};`);
    for (const v of ['campo', 'gestao']) {
      const { largura, altura } = tamanhoPng(new URL(`../../assets/images/splash-${v}.png`, import.meta.url));
      expect(largura / altura).toBeCloseTo(PROPORCAO_LOGO_EMPILHADO, 2);
    }
  });

  it('o logo fica no centro da janela', () => {
    const { altura, topo } = posicaoDoLogo(800);
    expect(altura).toBe(Math.round(LARGURA_LOGO_ENTRADA / PROPORCAO_LOGO_EMPILHADO));
    expect(topo + altura / 2).toBeCloseTo(400, 0);
  });

  it('a lista de etapas só entra se couber abaixo do logo (na tela baixa fica só a barra)', () => {
    expect(cabeLista(860, 5, 48, true)).toBe(true);
    expect(cabeLista(640, 5, 48, true)).toBe(false);
    expect(cabeLista(0, 5, 48, true)).toBe(false);
    // sem o "Olá" sobra mais espaço
    expect(cabeLista(780, 5, 0, false)).toBe(true);
    // parada: o erro e as ações ocupam o lugar da barra; a lista só fica na tela alta
    expect(cabeLista(915, 5, 48, true, true)).toBe(false);
    expect(cabeLista(1280, 5, 48, true, true)).toBe(true);
  });
});

describe('rótulos da entrada', () => {
  const etapa = { id: 'clientes_rota' as const, nome: 'Clientes e rota', numero: 2, situacao: 'atual' as const };

  it('"Etapa n de N · nome" e "Pronto" no fim', () => {
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: false })).toBe('Etapa 2 de 5 · Clientes e rota');
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: true })).toBe('Pronto');
  });

  it('erro: "Sem internet" quando falta sinal; senão "Parou"', () => {
    expect(erroDeSinal('Sem sinal: a sincronização fica para quando a conexão voltar.', false)).toBe(true);
    expect(erroDeSinal('HTTP 500', true)).toBe(true);
    expect(erroDeSinal('HTTP 500', false)).toBe(false);
    expect(erroDeSinal(null, false)).toBe(false);
    expect(textoDoErro(etapa, 5, true)).toBe('Sem internet na etapa 2 de 5');
    expect(textoDoErro(etapa, 5, false)).toBe('Parou na etapa 2 de 5');
  });

  it('RD-0239: com a lista na tela, o erro não repete o número da etapa (a lista já marca a que parou)', () => {
    expect(textoDoErro(etapa, 5, true, true)).toBe('Sem internet');
    expect(textoDoErro(etapa, 5, false, true)).toBe('A sincronização parou');
  });
});
