import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ALTURA_CARGA_FUNDO,
  desenhoCargaFundo,
  desenhoCatalogoCarregando,
  FOLGA_TOQUE_CARGA,
  TEXTO_CATALOGO_CARREGANDO,
  TITULO_CATALOGO_CARREGANDO,
} from './carga-fundo';
import { ALVO_TOQUE } from './componentes';
import * as puro from './puro';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('IndicadorCargaFundo (onda 1 do catálogo, solução 5)', () => {
  it('com sinal: "Catálogo 63%", ícone sync e leitura do TalkBack', () => {
    const d = desenhoCargaFundo({ etapa: ' Catálogo ', percentual: 63.7 });
    expect(d).toMatchObject({ texto: 'Catálogo 63%', percentual: 63, icone: 'sync', rotuloAcessivel: 'Catálogo carregando, 63%' });
    expect(d.dica).toBe('Abre o detalhe da carga');
  });

  it('sem sinal: "Catálogo 63% · parado" com o ícone wifiOff; a causa fica no Sincronizar e no selo, o TalkBack lê junto', () => {
    const d = desenhoCargaFundo({ etapa: 'Catálogo', percentual: 63, semSinal: true });
    expect(d).toMatchObject({ texto: 'Catálogo 63% · parado', icone: 'wifiOff', rotuloAcessivel: 'Catálogo carregando, 63%, parado sem sinal' });
  });

  it('percentual inteiro de 0 a 99 (100% = o shell desmonta); valor inválido vira 0', () => {
    const p = (percentual: number) => desenhoCargaFundo({ etapa: 'Catálogo', percentual }).percentual;
    expect(p(-5)).toBe(0);
    expect(p(Number.NaN)).toBe(0);
    expect(p(99.9)).toBe(99);
    expect(p(100)).toBe(99);
    expect(p(42)).toBe(42);
  });

  it('linha fina de 32 dp com alvo de toque de 48 (hitSlop em cima e embaixo)', () => {
    expect(ALTURA_CARGA_FUNDO + 2 * FOLGA_TOQUE_CARGA).toBeGreaterThanOrEqual(ALVO_TOQUE);
    const rn = ler('./carga-fundo-rn.tsx');
    expect(rn).toContain('hitSlop={{ top: FOLGA_TOQUE_CARGA, bottom: FOLGA_TOQUE_CARGA }}');
    expect(rn).toContain('accessibilityRole="button"');
    expect(rn).toContain('accessibilityRole="progressbar"');
  });

  it('não é aviso: sem cor de alerta, sem explicação do que o app faz por trás (RN-VEN-42, R-20261110-192153)', () => {
    const rn = ler('./carga-fundo-rn.tsx');
    expect(rn).not.toMatch(/warning|danger/);
    const textos = [desenhoCargaFundo({ etapa: 'Catálogo', percentual: 10, semSinal: true }).texto, TITULO_CATALOGO_CARREGANDO, TEXTO_CATALOGO_CARREGANDO];
    for (const t of textos) expect(t).not.toMatch(/segundo plano|servidor|baixando|sincroniz|aguarde/i);
  });

  it('textos fechados do catálogo sem sinal durante a carga', () => {
    expect(TITULO_CATALOGO_CARREGANDO).toBe('Catálogo ainda carregando');
    expect(TEXTO_CATALOGO_CARREGANDO).toBe('Busque quando tiver sinal.');
  });

  it('CatalogoCarregando: na aba, só o texto (o indicador e o selo já dizem carregando e sem sinal, RD-0671)', () => {
    expect(desenhoCatalogoCarregando()).toEqual({ texto: 'Busque quando tiver sinal.' });
    expect(desenhoCatalogoCarregando({ comTitulo: false })).toEqual({ texto: 'Busque quando tiver sinal.' });
  });

  it('CatalogoCarregando comTitulo: ficha e Novo pedido levam o wifiOff e "Catálogo ainda carregando"', () => {
    expect(desenhoCatalogoCarregando({ comTitulo: true })).toEqual({ icone: 'wifiOff', titulo: 'Catálogo ainda carregando', texto: 'Busque quando tiver sinal.' });
  });

  it('CatalogoCarregando monta o EstadoVazio pelo desenho, com comTitulo falso por padrão; o vazio aceita ficar sem título', () => {
    const rn = ler('./carga-fundo-rn.tsx');
    expect(rn).toContain("export function CatalogoCarregando({ comTitulo = false, testID = 'catalogo-carregando' }: CatalogoCarregandoProps)");
    expect(rn).toContain('<EstadoVazio icone={d.icone} titulo={d.titulo} texto={d.texto} testID={testID} />');
    expect(ler('./base.tsx')).toContain('{titulo ? <Text style={s.vazioTitulo}>{titulo}</Text> : null}');
  });

  it('exportado no puro e no índice do kit', () => {
    expect(puro.desenhoCargaFundo).toBe(desenhoCargaFundo);
    expect(puro.desenhoCatalogoCarregando).toBe(desenhoCatalogoCarregando);
    const indice = ler('./index.ts');
    expect(indice).toContain("export * from './carga-fundo';");
    expect(indice).toContain("export * from './carga-fundo-rn';");
  });
});
