import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { dividirAcoes, eventoDoMenu, MAX_ACOES_NA_LINHA, rotuloCurtoOk, type PassoDoMenu } from './acoes';
import { DESCONTO_COMPACTO, equivalenteDoAjuste, MENOS, sentidoDoTipo, tipoEmReais } from './desconto';
import { PASSO_COMPACTO, TIPOS_AJUSTE } from './selecao';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('desconto compacto (T-0133, RN-VEN-18): parte pura', () => {
  it('a linha tem a altura do Passo compacto do item (44 dp) e usa os 4 tipos do item', () => {
    expect(DESCONTO_COMPACTO.altura).toBe(PASSO_COMPACTO.alvo);
    expect(TIPOS_AJUSTE.map((t) => t.rotulo)).toEqual(['Desc %', 'Desc R$', 'Acrésc %', 'Acrésc R$']);
  });

  it('sentido e unidade do tipo', () => {
    expect(sentidoDoTipo('desc_pct')).toBe('desconto');
    expect(sentidoDoTipo('desc_reais')).toBe('desconto');
    expect(sentidoDoTipo('acresc_pct')).toBe('acrescimo');
    expect(sentidoDoTipo('acresc_reais')).toBe('acrescimo');
    expect(tipoEmReais('desc_reais')).toBe(true);
    expect(tipoEmReais('acresc_pct')).toBe(false);
  });

  it('tipo em % mostra o equivalente em R$; tipo em R$ mostra em % (desenho do dono: "−R$ 0,20")', () => {
    expect(equivalenteDoAjuste('desc_pct', { cents: 20, pct: 1 })).toEqual({ texto: `${MENOS}R$ 0,20`, leitura: 'Equivale a R$ 0,20 de desconto', tom: 'sucesso' });
    expect(equivalenteDoAjuste('desc_reais', { cents: 20, pct: 1 })).toEqual({ texto: `${MENOS}1,0%`, leitura: 'Equivale a 1,0% de desconto', tom: 'sucesso' });
    expect(equivalenteDoAjuste('acresc_pct', { cents: 150, pct: 2.5 })?.texto).toBe('+R$ 1,50');
    expect(equivalenteDoAjuste('acresc_reais', { cents: 150, pct: 2.5 })).toEqual({ texto: '+2,5%', leitura: 'Equivale a 2,5% de acréscimo', tom: 'neutro' });
    expect(equivalenteDoAjuste('desc_pct', { cents: 123456, pct: 4.6 })?.texto).toBe(`${MENOS}R$ 1.234,56`);
  });

  it('no item o R$ é por unidade (medida); acima do limite fica vermelho', () => {
    expect(equivalenteDoAjuste('desc_pct', { cents: 100, pct: 5 }, { medida: 'FD' })).toEqual({ texto: `${MENOS}R$ 1,00/FD`, leitura: 'Equivale a R$ 1,00 de desconto por FD', tom: 'sucesso' });
    expect(equivalenteDoAjuste('desc_reais', { cents: 100, pct: 5 }, { medida: 'FD' })?.texto).toBe(`${MENOS}5,0%`);
    expect(equivalenteDoAjuste('desc_pct', { cents: 900, pct: 12 }, { erro: true })?.tom).toBe('erro');
  });

  it('sem valor, sem equivalente (a linha fica só com o campo)', () => {
    expect(equivalenteDoAjuste('desc_pct', null)).toBeNull();
    expect(equivalenteDoAjuste('desc_pct', { cents: 0, pct: 0 })).toBeNull();
    expect(equivalenteDoAjuste('desc_reais', { cents: 0, pct: 0 })).toBeNull();
    expect(equivalenteDoAjuste('desc_reais', { cents: 10, pct: Number.NaN })).toBeNull();
  });
});

describe('rodapé de ações compacto e menu ⋮ (T-0133, RF-VEN-05): parte pura', () => {
  it('rótulo curto: 1 palavra, até 10 letras', () => {
    for (const r of ['Editar', 'PDF', 'Duplicar']) expect(rotuloCurtoOk(r), r).toBe(true);
    for (const r of ['Cancelar orçamento', 'Compartilhar', '', '  ']) expect(rotuloCurtoOk(r), r).toBe(false);
  });

  it('até 4 ações na linha; o resto vai para o menu ⋮', () => {
    expect(MAX_ACOES_NA_LINHA).toBe(4);
    expect(dividirAcoes(['a', 'b', 'c'])).toEqual({ linha: ['a', 'b', 'c'], menu: [] });
    expect(dividirAcoes(['a', 'b', 'c', 'd', 'e'])).toEqual({ linha: ['a', 'b', 'c', 'd'], menu: ['e'] });
    expect(dividirAcoes(['a', 'b'], 0)).toEqual({ linha: [], menu: ['a', 'b'] });
  });

  it('opção com confirmação nunca age no 1º toque; Voltar do diálogo devolve à folha', () => {
    const fechado: PassoDoMenu = { tipo: 'fechado' };
    const aberto = eventoDoMenu(fechado, { tipo: 'abrir' });
    expect(aberto).toEqual({ passo: { tipo: 'aberto' }, executar: null });
    const pedindo = eventoDoMenu(aberto.passo, { tipo: 'escolher', id: 'cancelar', comConfirmacao: true });
    expect(pedindo).toEqual({ passo: { tipo: 'confirmando', id: 'cancelar' }, executar: null });
    expect(eventoDoMenu(pedindo.passo, { tipo: 'voltar' })).toEqual({ passo: { tipo: 'aberto' }, executar: null });
    expect(eventoDoMenu(pedindo.passo, { tipo: 'confirmar' })).toEqual({ passo: { tipo: 'fechado' }, executar: 'cancelar' });
    expect(eventoDoMenu(aberto.passo, { tipo: 'escolher', id: 'pdf', comConfirmacao: false })).toEqual({ passo: { tipo: 'fechado' }, executar: 'pdf' });
    expect(eventoDoMenu(aberto.passo, { tipo: 'voltar' })).toEqual({ passo: { tipo: 'fechado' }, executar: null });
    // toque perdido fora do passo certo não executa nada
    expect(eventoDoMenu(fechado, { tipo: 'confirmar' }).executar).toBeNull();
    expect(eventoDoMenu(fechado, { tipo: 'escolher', id: 'x', comConfirmacao: false }).executar).toBeNull();
  });
});

describe('componentes do Novo pedido v2 (T-0133): conferência estática', () => {
  const ARQUIVOS = ['./desconto-rn.tsx', './historico-rn.tsx', './acoes-rn.tsx'];

  it('exportados no índice do kit (e a parte pura no puro)', () => {
    const indice = ler('./index.ts');
    for (const m of ['./desconto', './desconto-rn', '../comum/historico', './historico-rn', './acoes', './acoes-rn']) expect(indice).toContain(`export * from '${m}'`);
    const puro = ler('./puro.ts');
    for (const m of ['./desconto', './acoes', '../comum/historico']) expect(puro).toContain(`export * from '${m}'`);
    const fonte = ARQUIVOS.map(ler).join('\n');
    for (const nome of ['DescontoCompacto', 'TagHistorico', 'HistoricoEmTags', 'RodapeAcoes', 'MenuMais']) expect(fonte, nome).toMatch(new RegExp(`export function ${nome}\\b`));
    expect(ler('../web/index.ts')).toContain("export * from './historico'");
    expect(ler('../web/historico.tsx')).toMatch(/export function HistoricoEmTags\b/);
  });

  it('nenhum texto fixo: sem frase entre tags, nem rótulo ou placeholder literal', () => {
    for (const arq of [...ARQUIVOS, '../web/historico.tsx']) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
      expect(src, arq).not.toMatch(/(accessibilityLabel|accessibilityHint|placeholder|title|aria-label)=["'][^"']+["']/);
    }
  });

  it('contraste: nenhum texto em colors.accent (texto laranja só accentInk; sobre o laranja, onAccent pelo Botao)', () => {
    for (const arq of ARQUIVOS) expect(ler(arq), arq).not.toMatch(/colors\.accent\b(?!Ink|Soft|Light|Tint|Line)/);
  });

  it('alvos: ações e ⋮ com 48 dp; a linha do desconto com a altura do Passo compacto', () => {
    const acoes = ler('./acoes-rn.tsx');
    expect(acoes).toMatch(/acao: \{[^}]*minHeight: ALVO_TOQUE/);
    expect(acoes).toMatch(/mais: \{[^}]*width: ALVO_TOQUE, height: ALVO_TOQUE/);
    expect(acoes).toContain('nivel="principal"');
    expect(ler('./desconto-rn.tsx')).toMatch(/linha: \{[^}]*minHeight: DESCONTO_COMPACTO\.altura/);
    // sem − e + no desconto: nada de Passo no componente
    expect(ler('./desconto-rn.tsx')).not.toMatch(/<Passo\b/);
  });

  it('o ⋮ tem desenho próprio no kit de ícones', () => {
    const icone = ler('./icon.tsx');
    expect(icone).toContain("| 'mais'");
    expect(icone).toContain("case 'mais':");
  });
});

describe('acréscimos do kit para o Novo pedido v2 (T-0133)', () => {
  it('folha "Sair do pedido?" ganha Apenas salvar (grava rascunho, aceita pendências)', async () => {
    const { eventoDaSaida } = await import('./pendencias');
    expect(eventoDaSaida('opcoes', 'apenas_salvar')).toEqual({ passo: 'fechada', acao: 'apenas_salvar' });
    expect(eventoDaSaida('confirmar_descarte', 'apenas_salvar')).toEqual({ passo: 'opcoes', acao: null });
    const folha = ler('./pendencias-rn.tsx');
    expect(folha).toContain('apenasSalvar?: OpcaoDaSaida');
    expect(folha).toContain("onEvento('apenas_salvar')");
  });

  it('alerta de inadimplência da aba Venda em 2 linhas e a linha do cliente liberado', async () => {
    const { alertaInadimplencia, TEXTO_CLIENTE_LIBERADO, CONSEQUENCIA_VENCIDO } = await import('./selecao');
    expect(alertaInadimplencia({ titulos: 1, valorCents: 340000, dias: 12, consequencia: CONSEQUENCIA_VENCIDO })).toEqual({
      texto: 'Cliente inadimplente · 1 título vencido · R$ 3.400,00 · 12 dias',
      apoio: 'Só à vista ou com aprovação',
    });
    expect(alertaInadimplencia({ titulos: 2, valorCents: 48000, dias: 0 })).toEqual({ texto: 'Cliente inadimplente · 2 títulos vencidos · R$ 480,00 · vence hoje', apoio: null });
    expect(TEXTO_CLIENTE_LIBERADO).toBe('Cliente liberado · sem título vencido');
  });

  it('Botao quebra em 2 linhas só com a prop; Faixa tem 2ª linha; LinhaResumo exportada', () => {
    const base = ler('./base.tsx');
    expect(base).toContain('numberOfLines={quebrarLinha ? 2 : 1}');
    const valores = ler('./valores.tsx');
    expect(valores).toMatch(/export function LinhaResumo\b/);
    expect(valores).toContain('apoio?: string | null;');
  });
});

describe('BackLink com voltar trocado (T-0133, R-20261108-133640)', () => {
  it('aceita aoVoltar (abre a folha de saída) sem mudar o padrão', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toContain('aoVoltar?: () => void;');
    expect(ui).toContain('aoVoltar ? aoVoltar() : router.canGoBack() ? router.back() : router.replace(fallback as never)');
  });
});
