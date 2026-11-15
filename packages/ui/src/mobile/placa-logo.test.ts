import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { caixaDaPlacaLogo, ESTILO_PLACA_LOGO, PLACA_LOGO, rotuloDaPlacaLogo } from './placa-logo';

// placa-logo-rn.tsx importa react-native (não roda no node): a conferência do componente é sobre o texto do arquivo.
const fonteRn = readFileSync(new URL('./placa-logo-rn.tsx', import.meta.url), 'utf8');
const indice = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const puro = readFileSync(new URL('./puro.ts', import.meta.url), 'utf8');

describe('PlacaLogoCliente (T-0182; docs/design/telas/logo-cliente.md §1, §3 e §5)', () => {
  it('medidas da spec: carga 64 × até 112 com logo 48 × até 96; mais 52 × até 176 com logo 36 × até 152', () => {
    expect(PLACA_LOGO.carga).toEqual({ altura: 64, larguraMaxima: 112, alturaLogo: 48, larguraMaximaLogo: 96, folgaVertical: 8, folgaLateral: 8 });
    expect(PLACA_LOGO.mais).toEqual({ altura: 52, larguraMaxima: 176, alturaLogo: 36, larguraMaximaLogo: 152, folgaVertical: 8, folgaLateral: 12 });
    for (const m of Object.values(PLACA_LOGO)) {
      expect(m.altura).toBe(m.alturaLogo + 2 * m.folgaVertical);
      expect(m.larguraMaxima).toBe(m.larguraMaximaLogo + 2 * m.folgaLateral);
    }
  });

  it('placa branca, raio 12, borda #DFE2E6 de 1 dp', () => {
    expect(ESTILO_PLACA_LOGO).toEqual({ fundo: '#FFFFFF', borda: '#DFE2E6', larguraBorda: 1, raio: 12 });
  });

  it('logo larga: logo e placa na largura máxima (o contain reduz a altura, sem esticar)', () => {
    expect(caixaDaPlacaLogo('carga', 4)).toEqual({ larguraPlaca: 112, larguraLogo: 96, alturaLogo: 48 });
    expect(caixaDaPlacaLogo('mais', 6)).toEqual({ larguraPlaca: 176, larguraLogo: 152, alturaLogo: 36 });
  });

  it('logo média: a placa encolhe até a logo mais as folgas', () => {
    expect(caixaDaPlacaLogo('carga', 1.5)).toEqual({ larguraPlaca: 88, larguraLogo: 72, alturaLogo: 48 });
    expect(caixaDaPlacaLogo('mais', 2)).toEqual({ larguraPlaca: 96, larguraLogo: 72, alturaLogo: 36 });
  });

  it('logo quadrada ou alta: a placa nunca fica mais estreita que alta', () => {
    expect(caixaDaPlacaLogo('carga', 1).larguraPlaca).toBe(64);
    expect(caixaDaPlacaLogo('carga', 0.5)).toEqual({ larguraPlaca: 64, larguraLogo: 24, alturaLogo: 48 });
    expect(caixaDaPlacaLogo('mais', 0.5).larguraPlaca).toBe(52);
  });

  it('proporção desconhecida ou inválida: caixa máxima (a logo continua inteira no contain)', () => {
    for (const p of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(caixaDaPlacaLogo('carga', p)).toEqual({ larguraPlaca: 112, larguraLogo: 96, alturaLogo: 48 });
    }
  });

  it('leitura: "Logo da <nome fantasia>"; sem nome, decorativa (null)', () => {
    expect(rotuloDaPlacaLogo('Exemplo Norte')).toBe('Logo da Exemplo Norte');
    expect(rotuloDaPlacaLogo('  Exemplo Norte ')).toBe('Logo da Exemplo Norte');
    for (const v of [undefined, null, '', '   ']) expect(rotuloDaPlacaLogo(v)).toBeNull();
  });

  it('o componente: contain, sem tint/sombra/filtro, borda opcional e decorativa fora do TalkBack', () => {
    expect(fonteRn).toContain('resizeMode="contain"');
    expect(fonteRn).not.toMatch(/tintColor|shadow|elevation|blurRadius|resizeMode="(cover|stretch)"/);
    expect(fonteRn).toContain('borderWidth: borda ? ESTILO_PLACA_LOGO.larguraBorda : 0');
    expect(fonteRn).toContain("importantForAccessibility={rotulo ? 'yes' : 'no-hide-descendants'}");
    expect(fonteRn).toContain('accessibilityElementsHidden={rotulo === null}');
    expect(fonteRn).toContain('accessibilityLabel={rotulo ?? undefined}');
    expect(fonteRn).toContain('source={{ uri: fonte }}');
  });

  it('exportado pelo índice (componente) e pelo puro (medidas e leitura)', () => {
    expect(indice).toContain("export * from './placa-logo';");
    expect(indice).toContain("export * from './placa-logo-rn';");
    expect(puro).toContain("export * from './placa-logo';");
  });
});
