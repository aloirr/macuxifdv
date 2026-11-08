/**
 * T-0126 (RN-CORE-36, RN-VEN-38): parte pura do padrão de pendências de preenchimento, da folha "Sair do pedido?" e da
 * retomada do rascunho. Spec: docs/design/formulario-pendencias.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  abasComPendencia,
  apoioDaRetomada,
  dicaDaPendencia,
  eventoDaSaida,
  LEITURA_ABA_COM_PENDENCIA,
  leituraDaPendencia,
  leituraDoBloco,
  leituraDoSalvar,
  linhaDaPendencia,
  ondeCorrigir,
  ordenarPendencias,
  TITULO_FALTA_PARA_SALVAR,
  tituloDaRetomada,
  type PassoDaSaida,
  type PendenciaPreenchimento,
} from './pendencias';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

const ABAS = [
  { id: 'itens', rotulo: 'Itens' },
  { id: 'detalhes', rotulo: 'Detalhes' },
  { id: 'resumo', rotulo: 'Resumo' },
];
const FRETE: PendenciaPreenchimento = { id: 'frete-fob', texto: 'Transportadora do frete FOB', aba: 'detalhes', campo: 'transportadora' };
const PRAZO: PendenciaPreenchimento = { id: 'prazo', texto: 'Prazo de pagamento', aba: 'itens', campo: 'prazo' };
const ITEM: PendenciaPreenchimento = { id: 'itens', texto: 'Pelo menos 1 item', aba: 'itens' };

describe('RN-CORE-36: bloco "Falta para salvar"', () => {
  it('texto da regra: uma linha por pendência com a aba onde corrigir', () => {
    expect(TITULO_FALTA_PARA_SALVAR).toBe('Falta para salvar');
    expect(linhaDaPendencia(FRETE, ABAS)).toBe('Transportadora do frete FOB — aba Detalhes');
    expect(linhaDaPendencia(PRAZO, ABAS)).toBe('Prazo de pagamento — aba Itens');
  });

  it('ordem das abas (a de preencher) e, dentro da aba, a do domain; repetida aparece uma vez', () => {
    expect(ordenarPendencias([FRETE, PRAZO, ITEM, FRETE], ABAS).map((p) => p.id)).toEqual(['prazo', 'itens', 'frete-fob']);
  });

  it('pendência da própria aba do bloco não diz a aba; o toque rola até o campo', () => {
    const desc = { id: 'desc', texto: 'Motivo do desconto', aba: 'resumo' };
    expect(ondeCorrigir(desc, ABAS)).toBeNull();
    expect(linhaDaPendencia(desc, ABAS)).toBe('Motivo do desconto');
    expect(leituraDaPendencia(desc, ABAS)).toBe('Falta: Motivo do desconto, nesta aba');
    expect(dicaDaPendencia(desc, ABAS)).toBe('Vai até o campo');
  });

  it('TalkBack: a linha diz o que falta e onde; a dica diz o que o toque faz; o travessão não é lido', () => {
    expect(leituraDaPendencia(FRETE, ABAS)).toBe('Falta: Transportadora do frete FOB, na aba Detalhes');
    expect(leituraDaPendencia(FRETE, ABAS)).not.toContain('—');
    expect(dicaDaPendencia(FRETE, ABAS)).toBe('Abre a aba Detalhes');
    expect(leituraDoBloco(1)).toBe('Falta para salvar: 1 pendência');
    expect(leituraDoBloco(2)).toBe('Falta para salvar: 2 pendências');
  });

  it('salvar desabilitado diz o motivo ao TalkBack; sem pendência, só o rótulo', () => {
    expect(leituraDoSalvar('Salvar', 2)).toBe('Salvar. Falta para salvar: 2 pendências, na lista acima');
    expect(leituraDoSalvar('Salvar', 0)).toBe('Salvar');
  });

  it('bolinha só nas abas com pendência, nunca na última (lá está o bloco)', () => {
    expect([...abasComPendencia([FRETE, PRAZO, ITEM], ABAS)].sort()).toEqual(['detalhes', 'itens']);
    expect([...abasComPendencia([FRETE], ABAS)]).toEqual(['detalhes']);
    expect(abasComPendencia([{ id: 'x', texto: 'X', aba: 'resumo' }], ABAS).size).toBe(0);
    expect(abasComPendencia([], ABAS).size).toBe(0);
    expect(LEITURA_ABA_COM_PENDENCIA).toBe('com pendência');
  });

  it('o componente: só a lista, sem botão "Corrigir"; texto em ink/ink2 no âmbar; nunca accent em texto', () => {
    const fonte = ler('./pendencias-rn.tsx');
    expect(fonte).not.toMatch(/['"`>]Corrigir/);
    expect(fonte).not.toMatch(/color:\s*colors\.accent\b/);
    expect(fonte).toMatch(/backgroundColor: colors\.warningBg/);
    expect(fonte).toMatch(/minHeight: ALVO_TOQUE/);
    expect(fonte).toMatch(/accessibilityLiveRegion="polite"/);
  });
});

describe('RN-VEN-38: folha "Sair do pedido?"', () => {
  const seq = (eventos: Parameters<typeof eventoDaSaida>[1][]) => {
    let passo: PassoDaSaida = 'opcoes';
    const acoes: unknown[] = [];
    for (const e of eventos) {
      const r = eventoDaSaida(passo, e);
      passo = r.passo;
      if (r.acao) acoes.push(r.acao);
    }
    return { passo, acoes };
  };

  it('Salvar pedido e Salvar orçamento fecham a folha e passam a ação à tela', () => {
    expect(seq(['salvar'])).toEqual({ passo: 'fechada', acoes: ['salvar'] });
    expect(seq(['salvar_alternativo'])).toEqual({ passo: 'fechada', acoes: ['salvar_alternativo'] });
  });

  it('Descartar nunca apaga no 1º toque: pede confirmação; Voltar da confirmação volta às opções', () => {
    expect(seq(['descartar'])).toEqual({ passo: 'confirmar_descarte', acoes: [] });
    expect(seq(['descartar', 'voltar_do_descarte'])).toEqual({ passo: 'opcoes', acoes: [] });
    expect(seq(['descartar', 'confirmar_descarte'])).toEqual({ passo: 'fechada', acoes: ['descartar'] });
    // Voltar do Android no diálogo = voltar às opções, nunca descartar
    expect(seq(['descartar', 'continuar'])).toEqual({ passo: 'opcoes', acoes: [] });
  });

  it('Continuar editando, toque fora e Voltar do Android com a folha aberta: só fecha', () => {
    expect(seq(['continuar'])).toEqual({ passo: 'fechada', acoes: ['continuar'] });
    expect(eventoDaSaida('fechada', 'salvar')).toEqual({ passo: 'fechada', acao: null });
  });

  it('a folha é a mesma na variante só-orçamento (sem `salvar`) e o descarte sempre passa pelo diálogo perigo', () => {
    const fonte = ler('./pendencias-rn.tsx');
    expect(fonte).toMatch(/\{salvar \? <OpcaoFolha/);
    expect(fonte).toMatch(/icone="trash" tom="perigo"/);
    expect(fonte).toMatch(/perigo\n\s+testID=\{`\$\{testID\}-descarte`\}/);
  });
});

describe('RN-VEN-38: retomada depois que o sistema fecha o app', () => {
  it('"Continuar pedido de <cliente>" e o apoio já formatado pelo módulo', () => {
    expect(tituloDaRetomada('pedido', ' Mercadinho São Jorge ')).toBe('Continuar pedido de Mercadinho São Jorge');
    expect(apoioDaRetomada(['2 itens', 'R$ 55,53', null, ' ', 'alterado às 10h34'])).toBe('2 itens · R$ 55,53 · alterado às 10h34');
  });

  it('"Agora não", toque fora e Voltar guardam o rascunho (ação "depois"), nunca descartam', () => {
    const fonte = ler('./pendencias-rn.tsx');
    expect(fonte).toMatch(/else if \(acao === 'continuar'\) onAcao\('depois'\)/);
  });
});
