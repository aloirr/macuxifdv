/**
 * T-0126 (RN-VEN-38): parte pura da folha "Sair do pedido?" e da retomada do rascunho. Spec: docs/design/formulario-pendencias.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { apoioDaRetomada, eventoDaSaida, tituloDaRetomada, type PassoDaSaida } from './pendencias';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('T-0166 (RD-0179): o bloco "Falta para salvar" saiu do kit', () => {
  it('sem BlocoPendencias nem abasComPendencia; a falta é a do campo (falta.ts)', () => {
    const rn = ler('./pendencias-rn.tsx');
    const puro = ler('./pendencias.ts');
    expect(rn).not.toMatch(/export function BlocoPendencias/);
    expect(puro).not.toMatch(/export function abasComPendencia/);
    expect(puro).not.toMatch(/TITULO_FALTA_PARA_SALVAR/);
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
