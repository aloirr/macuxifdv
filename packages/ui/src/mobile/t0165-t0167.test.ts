/**
 * T-0166 (falta no campo, só na tentativa; RD-0170, RD-0177), T-0165 (Balao e CampoEscolha, pedido-v4.md §5.3, §5.4 e §5.6) e
 * T-0167 (fim da lista da busca: "Mostrando 20 de 87", "+ Mostrar mais" e "Você quis dizer…"). Partes puras e o desenho.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BALAO, larguraMaximaDoBalao, posicaoDoBalao } from './balao';
import { BOTAO_EDITAR, folgaDoBotaoEditar, leituraDoBotaoEditar, tomDoBotaoEditar } from './botao-editar';
import {
  leituraDoMostrarMais,
  PAGINA_DA_BUSCA,
  proximaPaginaDaBusca,
  textoDaContagemDaBusca,
  textoNadaEncontrado,
  textoVoceQuisDizer,
} from './busca';
import { filtrarOpcoes, semAcento, textoDoCampoEscolha } from './campo-escolha';
import { FALTA_OBRIGATORIO, faltaVisivel, leituraDoCampoComFalta, MARCA_DA_FALTA } from './falta';
import { colors, contraste } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('T-0166: falta no campo, só na tentativa (RN-CORE-36)', () => {
  const vazio = { texto: FALTA_OBRIGATORIO, quando: 'vazio' as const };
  const invalido = { texto: 'CNPJ inválido', quando: 'invalido' as const };
  const maximo = { texto: 'Máx. 10,0%', quando: 'imediata' as const };

  it('obrigatório vazio: nada antes da tentativa; "Obrigatório" depois', () => {
    expect(faltaVisivel(vazio, { tentou: false })).toBeNull();
    expect(faltaVisivel(vazio, { tentou: false, saiu: true })).toBeNull();
    expect(faltaVisivel(vazio, { tentou: true })).toBe('Obrigatório');
  });

  it('valor inválido: aparece ao sair do campo ou na tentativa', () => {
    expect(faltaVisivel(invalido, { tentou: false })).toBeNull();
    expect(faltaVisivel(invalido, { tentou: false, saiu: true })).toBe('CNPJ inválido');
    expect(faltaVisivel(invalido, { tentou: true })).toBe('CNPJ inválido');
  });

  it('o máximo do desconto aparece na hora (RD-0177); sem falta ou texto vazio, nada', () => {
    expect(faltaVisivel(maximo, { tentou: false })).toBe('Máx. 10,0%');
    expect(faltaVisivel(null, { tentou: true })).toBeNull();
    expect(faltaVisivel({ texto: '  ', quando: 'vazio' }, { tentou: true })).toBeNull();
  });

  it('TalkBack: rótulo, valor e falta; marca em danger 2 dp (6,4:1)', () => {
    expect(leituraDoCampoComFalta('Transportadora', 'Escolher', 'Obrigatório')).toBe(
      'Transportadora, Escolher, Obrigatório',
    );
    expect(leituraDoCampoComFalta('Transportadora', 'Rápido Norte', null)).toBe(
      'Transportadora, Rápido Norte',
    );
    expect(MARCA_DA_FALTA.cor).toBe(colors.danger);
    expect(MARCA_DA_FALTA.larguraBorda).toBe(2);
  });

  it('o componente não tem fundo vermelho nem texto fixo', () => {
    const fonte = ler('./falta-rn.tsx');
    expect(fonte).not.toMatch(/dangerBg/);
    expect(fonte).not.toMatch(/['"`>]Obrigatório/);
    expect(fonte).toMatch(/accessibilityLiveRegion="polite"/);
  });
});

describe('T-0165: CampoEscolha (pedido-v4.md §5.6)', () => {
  const opcoes = [
    { id: 't1', rotulo: 'Rápido Norte' },
    { id: 't2', rotulo: 'Transamazônica Cargas' },
    { id: 't3', rotulo: 'Expresso São João' },
  ];

  it('busca sem acento e sem caixa, cada palavra em qualquer ordem; vazia mostra todas na ordem do módulo', () => {
    expect(semAcento('  Água   SANITÁRIA ')).toBe('agua sanitaria');
    expect(filtrarOpcoes(opcoes, 'rapido').map((o) => o.id)).toEqual(['t1']);
    expect(filtrarOpcoes(opcoes, 'joao sao').map((o) => o.id)).toEqual(['t3']);
    expect(filtrarOpcoes(opcoes, 'AMAZ').map((o) => o.id)).toEqual(['t2']);
    expect(filtrarOpcoes(opcoes, '').map((o) => o.id)).toEqual(['t1', 't2', 't3']);
    expect(filtrarOpcoes(opcoes, 'xyz')).toEqual([]);
  });

  it('campo: a escolhida, a opção livre ("Outra") ou o placeholder', () => {
    expect(textoDoCampoEscolha(opcoes, 't2', 'Escolher')).toEqual({
      texto: 'Transamazônica Cargas',
      vazio: false,
    });
    expect(textoDoCampoEscolha(opcoes, null, 'Escolher')).toEqual({ texto: 'Escolher', vazio: true });
    expect(textoDoCampoEscolha(opcoes, 'sumiu', 'Escolher')).toEqual({ texto: 'Escolher', vazio: true });
    expect(textoDoCampoEscolha(opcoes, 't1', 'Escolher', 'Outra')).toEqual({ texto: 'Outra', vazio: false });
  });

  it('desenho: opção final sempre por último, falta com borda e texto, sem texto fixo', () => {
    const fonte = ler('./campo-escolha-rn.tsx');
    expect(fonte).toMatch(/bordaDaFalta\(falta\)/);
    expect(fonte).toMatch(/<TextoDaFalta texto=\{falta\}/);
    expect(fonte.indexOf('lista.map')).toBeLessThan(fonte.indexOf('{opcaoFinal ?'));
    expect(fonte).not.toMatch(/['`>](Escolher|Buscar|Fechar|Outra)['`<]/);
    expect(fonte).not.toMatch(/color:\s*colors\.accent\b/);
  });

  it('ListaSuspensa (Forma e Prazo) com falta: borda e texto embaixo, como o CampoEscolha (RD-0170)', () => {
    const fonte = ler('./suspensa.tsx');
    expect(fonte).toMatch(/falta\?: string \| null;/);
    expect(fonte).toMatch(/bordaDaFalta\(falta\)/);
    expect(fonte).toMatch(/<TextoDaFalta texto=\{falta\}/);
    // o texto fica fora da âncora do menu: o menu continua abrindo colado ao campo
    const lista = fonte.slice(fonte.indexOf('export function ListaSuspensa'), fonte.indexOf('export function CampoAjuste'));
    const fimDaAncora = lista.indexOf('</Pressionavel>\n        </View>');
    expect(fimDaAncora).toBeGreaterThan(0);
    expect(lista.indexOf('<TextoDaFalta')).toBeGreaterThan(fimDaAncora);
  });
});

describe('T-0165: Balao (pedido-v4.md §5.3 e §5.4)', () => {
  const janela = { largura: 360, altura: 760 };

  it('abre embaixo do alvo, alinhado a ele, com a seta sobre o alvo', () => {
    const p = posicaoDoBalao({
      alvo: { x: 16, y: 200, largura: 120, altura: 20 },
      janela,
      balao: { largura: 240, altura: 60 },
    });
    expect(p.acima).toBe(false);
    expect(p.left).toBe(16);
    expect(p.top).toBe(200 + 20 + BALAO.seta + BALAO.folga);
    expect(p.setaX).toBe(60);
  });

  it('nunca sai da janela: empurra para dentro na borda direita e a seta não encosta no canto', () => {
    const p = posicaoDoBalao({
      alvo: { x: 330, y: 200, largura: 24, altura: 20 },
      janela,
      balao: { largura: 240, altura: 60 },
    });
    expect(p.left).toBe(360 - BALAO.margem - 240);
    expect(p.left + 240).toBeLessThanOrEqual(360 - BALAO.margem);
    expect(p.setaX).toBeLessThanOrEqual(240 - BALAO.raio - BALAO.seta);
  });

  it('sem espaço embaixo, abre acima (seta para baixo)', () => {
    const p = posicaoDoBalao({
      alvo: { x: 16, y: 700, largura: 120, altura: 20 },
      janela,
      balao: { largura: 240, altura: 60 },
    });
    expect(p.acima).toBe(true);
    expect(p.top + 60 + BALAO.seta + BALAO.folga).toBe(700);
  });

  it('largura até 300 dp, 8 dp das bordas; fecha no toque e no Voltar; fundo ink', () => {
    expect(larguraMaximaDoBalao(412)).toBe(300);
    expect(larguraMaximaDoBalao(280)).toBe(264);
    const fonte = ler('./balao-rn.tsx');
    expect(fonte).toMatch(/onRequestClose=\{fechar\}/);
    expect(fonte).toMatch(/onPress=\{fechar\}/);
    expect(fonte).toMatch(/backgroundColor: colors\.ink/);
  });
});

describe('T-0167: fim da lista da busca', () => {
  it('"Mostrando 20 de 87"; com tudo à vista, nada', () => {
    expect(PAGINA_DA_BUSCA).toBe(20);
    expect(textoDaContagemDaBusca(20, 87)).toBe('Mostrando 20 de 87');
    expect(textoDaContagemDaBusca(80, 87)).toBe('Mostrando 80 de 87');
    expect(textoDaContagemDaBusca(87, 87)).toBeNull();
    expect(textoDaContagemDaBusca(20, 12)).toBeNull();
    expect(textoDaContagemDaBusca(20, 1240)).toBe('Mostrando 20 de 1.240');
  });

  it('cada toque traz os próximos 20, sem passar do total', () => {
    expect(proximaPaginaDaBusca(20, 87)).toBe(40);
    expect(proximaPaginaDaBusca(80, 87)).toBe(87);
    expect(leituraDoMostrarMais(80, 87)).toBe('Mostrar mais 7 produtos, mostrando 80 de 87');
  });

  it('nada encontrado e "Você quis dizer…" só com termo diferente', () => {
    expect(textoNadaEncontrado(' agau ')).toBe('Nenhum produto com “agau”.');
    expect(textoVoceQuisDizer('água', 'agau')).toBe('Você quis dizer “água”?');
    expect(textoVoceQuisDizer(null, 'agau')).toBeNull();
    expect(textoVoceQuisDizer('Agau', 'agau')).toBeNull();
  });
});

describe('T-0165: BotaoEditar, o lápis do item já no pedido (R-20261112-082212; pedido-v4.md §5.8)', () => {
  it('linha 44 dp (aba Itens) e tabela 32 dp (Resumo), os dois com alvo de 48 dp', () => {
    expect(BOTAO_EDITAR.linha.lado).toBe(44);
    expect(BOTAO_EDITAR.tabela.lado).toBe(32);
    expect(BOTAO_EDITAR.linha.lado + 2 * folgaDoBotaoEditar('linha')).toBeGreaterThanOrEqual(48);
    expect(BOTAO_EDITAR.tabela.lado + 2 * folgaDoBotaoEditar('tabela')).toBeGreaterThanOrEqual(48);
  });

  it('borda accent, fundo accentSoft e ícone accentInk com contraste ≥ 4,5:1 sobre o fundo', () => {
    expect(BOTAO_EDITAR.borda).toBe(colors.accent);
    expect(BOTAO_EDITAR.fundo).toBe(colors.accentSoft);
    expect(contraste(BOTAO_EDITAR.icone, BOTAO_EDITAR.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('tom adicionado (14/11/2026): verde de situação, borda mais grossa que a do padrão', () => {
    const { adicionado, padrao } = BOTAO_EDITAR.tons;
    expect(adicionado.fundo).toBe(colors.successBg);
    expect(adicionado.borda).toBe(colors.success);
    expect(adicionado.icone).toBe(colors.success);
    expect(adicionado.larguraBorda).toBeGreaterThan(padrao.larguraBorda);
  });

  it('tom adicionado: ícone 5,51:1 sobre successBg e borda 6,43:1 sobre o branco (surface), ambos ≥ 3:1', () => {
    const { adicionado } = BOTAO_EDITAR.tons;
    expect(contraste(adicionado.icone, adicionado.fundo)).toBeGreaterThanOrEqual(3);
    expect(contraste(adicionado.icone, adicionado.fundo)).toBeCloseTo(5.51, 2);
    expect(contraste(adicionado.borda, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contraste(adicionado.borda, colors.surface)).toBeGreaterThanOrEqual(3);
  });

  it('tomDoBotaoEditar: adicionado na linha e padrao na tabela, salvo tom explícito', () => {
    expect(tomDoBotaoEditar('linha')).toBe('adicionado');
    expect(tomDoBotaoEditar('tabela')).toBe('padrao');
    expect(tomDoBotaoEditar('linha', 'padrao')).toBe('padrao');
    expect(tomDoBotaoEditar('tabela', 'adicionado')).toBe('adicionado');
  });

  it('tons.padrao repete os campos raiz de BOTAO_EDITAR', () => {
    expect(BOTAO_EDITAR.tons.padrao).toEqual({
      larguraBorda: BOTAO_EDITAR.larguraBorda,
      borda: BOTAO_EDITAR.borda,
      fundo: BOTAO_EDITAR.fundo,
      icone: BOTAO_EDITAR.icone,
    });
  });

  it('TalkBack: "<nome>, no pedido. Editar" na aba Itens e "Editar <código>" no Resumo', () => {
    expect(leituraDoBotaoEditar('Água mineral 1,5 L', 'linha')).toBe('Água mineral 1,5 L, no pedido. Editar');
    expect(leituraDoBotaoEditar(' AGU-1500 ', 'tabela')).toBe('Editar AGU-1500');
    expect(leituraDoBotaoEditar('', 'tabela')).toBe('Editar');
  });

  it('o componente usa o ícone edit e o toque do kit, sem texto visível', () => {
    const fonte = ler('./botao-editar-rn.tsx');
    expect(fonte).toContain('name="edit"');
    expect(fonte).toContain('<Pressionavel');
    expect(fonte).not.toMatch(/<Text[\s>]/);
  });
});
