/**
 * R-20261114-145000: o desenho do Início enquadrado, conferido pela estrutura da tela (sem render nativo): o Sincronizar fica
 * fora da área que rola, a saudação cabe na largura inteira, e o sino mora no painel do topo, não na linha de "Metas do mês".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { escalaInicio } from './escala-inicio';

const fonte = readFileSync(join(__dirname, 'tela-inicio-campo.tsx'), 'utf8');
const corpoDaTela = fonte.slice(fonte.indexOf('export function TelaInicioCampo'), fonte.indexOf('const leituraDaMeta'));
const dentroDoScreen = corpoDaTela.slice(corpoDaTela.indexOf('<Screen'), corpoDaTela.indexOf('</Screen>'));
const painel = corpoDaTela.slice(corpoDaTela.indexOf('<View style={[layoutCabecalho'), corpoDaTela.indexOf('<Screen'));

describe('R-20261114-145000: Início do Campo enquadrado', () => {
  it('o Sincronizar e a última sincronização ficam fora do Screen (fora da rolagem)', () => {
    expect(corpoDaTela).toContain('testID="inicio-sincronizar"');
    expect(dentroDoScreen).not.toContain('inicio-sincronizar');
    expect(dentroDoScreen).not.toContain('inicio.ultima-sincronizacao');
    expect(corpoDaTela.indexOf('inicio-sincronizar')).toBeGreaterThan(corpoDaTela.indexOf('</Screen>'));
  });

  it('a saudação ocupa uma linha e encolhe até 0,6 em vez de ser cortada', () => {
    const saudacao = painel.slice(painel.indexOf('inicio.saudacao'), painel.indexOf('</Text>', painel.indexOf('inicio.saudacao')));
    expect(saudacao).toContain('numberOfLines={1}');
    expect(saudacao).toContain('adjustsFontSizeToFit');
    expect(saudacao).toMatch(/minimumFontScale=\{0\.[5-7]\d?\}/);
  });

  it('o sino está no painel do topo e não na linha de "Metas do mês"', () => {
    expect(painel).toContain('{sinoDoPainel}');
    expect(dentroDoScreen).not.toContain('sinoDoPainel');
    expect(dentroDoScreen).not.toContain('sino(');
    expect(corpoDaTela).toContain('useSinoCabecalho()');
  });

  it('a tela usa a escala pela janela e pela fonte do sistema (useWindowDimensions)', () => {
    expect(fonte).toContain('useWindowDimensions()');
    expect(fonte).toContain('escalaInicio({');
    expect(fonte).toContain('fontScale: janela.fontScale');
  });

  it('o avatar do painel é pequeno (40) e não tira largura da saudação', () => {
    expect(fonte).toMatch(/avatar: \{ width: e\.painel\.avatar, height: e\.painel\.avatar/);
    expect(escalaInicio({ kit: { h2: 17, label: 12, sub: 13, ultima: 12 }, largura: 412, altura: 915, fontScale: 1, topo: 24, base: 24 }).painel.avatar).toBe(40);
  });
});
