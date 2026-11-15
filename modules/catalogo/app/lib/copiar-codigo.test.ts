import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVISO_CODIGO_COPIADO, AVISO_CODIGO_NAO_COPIADO, copiarCodigo, definirCopiadorTexto, rotuloAcessivelCopiar, ROTULO_COPIAR_CODIGO } from './copiar-codigo';

const fonte = (arq: string) => readFileSync(join(__dirname, '..', arq), 'utf8');

describe('copiar o código do produto', () => {
  afterEach(() => definirCopiadorTexto(null));

  it('copia o código e avisa "Código copiado"', async () => {
    const copiar = vi.fn(async () => {});
    expect(await copiarCodigo('CB3401', copiar)).toEqual({ ok: true, aviso: 'Código copiado' });
    expect(copiar).toHaveBeenCalledWith('CB3401');
    expect(AVISO_CODIGO_COPIADO).toBe('Código copiado');
  });

  it('o shell pode injetar o copiador (expo-clipboard) e ele vale no lugar do padrão', async () => {
    const injetado = vi.fn(async () => {});
    definirCopiadorTexto(injetado);
    expect((await copiarCodigo('A1')).ok).toBe(true);
    expect(injetado).toHaveBeenCalledWith('A1');
  });

  it('falha ao copiar: aviso em português com a ação seguinte, sem quebrar a tela', async () => {
    const r = await copiarCodigo('A1', () => {
      throw new Error('sem acesso');
    });
    expect(r).toEqual({ ok: false, aviso: AVISO_CODIGO_NAO_COPIADO });
    expect(AVISO_CODIGO_NAO_COPIADO).toMatch(/tente de novo/i);
  });

  it('código vazio não copia nada', async () => {
    const copiar = vi.fn(async () => {});
    expect((await copiarCodigo('  ', copiar)).ok).toBe(false);
    expect(copiar).not.toHaveBeenCalled();
  });

  it('rótulo acessível leva o código; o visível é "Copiar código"', () => {
    expect(ROTULO_COPIAR_CODIGO).toBe('Copiar código');
    expect(rotuloAcessivelCopiar('CB3401')).toBe('Copiar código CB3401');
  });

  it('a ficha e o cartão têm o botão de copiar e o Catálogo não tem texto próprio de "Adicionar ao pedido"', () => {
    const comum = fonte('telas/comum.tsx');
    const produto = fonte('telas/produto.tsx');
    expect(comum).toContain('BotaoCopiarCodigo');
    expect(produto).toContain('<BotaoCopiarCodigo codigo={item.erp_code} variante="faixa"');
    expect(comum).toContain("'copy'");
    // Um aviso só: o toast é só do ícone da lista; a ficha confirma pelo rótulo e o leitor de tela anuncia quando não há toast.
    expect(comum).toContain("if (Platform.OS === 'android') ToastAndroid.show");
    expect(comum).toContain('else AccessibilityInfo.announceForAccessibility');
    for (const arq of [comum, produto, fonte('telas/catalogo.tsx')]) expect(arq).not.toMatch(/['"`>]\s*Adicionar ao pedido/);
  });
});
