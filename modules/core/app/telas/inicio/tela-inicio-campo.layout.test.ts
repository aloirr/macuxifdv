/**
 * R-20261114-145000: o desenho do Início enquadrado, conferido pela estrutura da tela (sem render nativo): o Sincronizar fica
 * fora da área que rola, a saudação cabe na largura inteira, e o sino mora no painel do topo, não na linha de "Metas do mês".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

  it('o avatar do painel usa o tamanho da escala', () => {
    expect(fonte).toMatch(/avatar: \{ width: e\.painel\.avatar, height: e\.painel\.avatar/);
  });

  it('variação C: foto à esquerda e os textos à direita dela (saudação com o sino na linha, data e frase embaixo)', () => {
    const iAvatar = painel.indexOf('inicio.avatar');
    const iSaud = painel.indexOf('inicio.saudacao');
    const iSino = painel.indexOf('{sinoDoPainel}');
    const iData = painel.indexOf('inicio.data');
    const iFrase = painel.indexOf('inicio.frase');
    expect(iAvatar).toBeGreaterThan(-1);
    expect(iAvatar).toBeLessThan(iSaud);
    expect(iSaud).toBeLessThan(iSino);
    expect(iSino).toBeLessThan(iData);
    expect(iData).toBeLessThan(iFrase);
  });

  it('variação C: o sino mantém o alvo de 48 dp, sobe 10 e avança 12 no respiro (margem negativa)', () => {
    expect(fonte).toMatch(/linhaSaudacao: \{[^}]*marginRight: -space\.md/);
    expect(fonte).toMatch(/sinoBox: \{[^}]*marginVertical: -10/);
    expect(painel).toContain('s.sinoBox');
  });

  it('variação C: saudação encolhe até 0,75 e depois reticências; frase em até 2 linhas; foto com resizeMode cover', () => {
    expect(painel).toMatch(/minimumFontScale=\{0\.75\}/);
    expect(painel).toContain('ellipsizeMode="tail"');
    expect(painel).toMatch(/inicio\.frase"[^>]*numberOfLines=\{2\}/);
    expect(painel).toContain('resizeMode="cover"');
    expect(painel).toContain('accessibilityLabel={`Foto de ${v.nome}`}');
  });

  it('variação C: um só alvo lido abre o Perfil e os textos ficam fora da leitura repetida', () => {
    expect(painel.match(/accessibilityLabel=\{`\$\{v\.saudacao\} Abrir perfil`\}/g)).toHaveLength(1);
    expect(painel.match(/onPress=\{onPerfil\}/g)?.length).toBeGreaterThanOrEqual(1);
    expect(painel).toContain('importantForAccessibility="no-hide-descendants"');
  });
});
