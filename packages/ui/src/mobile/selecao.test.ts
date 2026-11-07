/**
 * T-0089, fatia U1 (R-20261106-073354): parte pura da lista suspensa, do campo de ajuste, do passo compacto e dos textos dos
 * cartões "Crédito do cliente" e "Leve mais e pague menos". Referência: R-20261106-0703-alexandre-novo-pedido-itens-v2.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  alvoDoPassoCompacto,
  CONSEQUENCIA_VENCIDO,
  larguraSegmentadoCompacto,
  lerDecimal,
  leituraDaOpcao,
  PASSO_COMPACTO,
  passoComTexto,
  posicaoDoMenu,
  sanearDecimal,
  SEGMENTADO_COMPACTO,
  textoAtualizacao,
  textoDaSelecao,
  textoDecimal,
  textoInadimplencia,
  textosLeveMais,
  TIPOS_AJUSTE,
} from './selecao';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');
const bloco = (fonte: string, nome: string) => /* corpo da função exportada até a próxima função de topo */ new RegExp(`export function ${nome}[\\s\\S]*?\\n}\\n`).exec(fonte)?.[0] ?? '';

describe('lista suspensa (Forma de pagamento e Prazo)', () => {
  const prazos = [
    { id: 'p28', rotulo: '28 dias' },
    { id: 'p2856', rotulo: '28/56 dias' },
    { id: 'p306090', rotulo: '30/60/90 dias', desabilitada: true, motivo: 'Acima do prazo médio do cliente' },
  ];

  it('RN-VEN-25: a lista mostra só o prazo; o motivo da opção desabilitada vai só para o leitor de tela', () => {
    expect(prazos.map((p) => p.rotulo)).toEqual(['28 dias', '28/56 dias', '30/60/90 dias']);
    expect(prazos.some((p) => /médio/.test(p.rotulo))).toBe(false);
    expect(leituraDaOpcao(prazos[2]!)).toBe('30/60/90 dias. Acima do prazo médio do cliente');
    expect(leituraDaOpcao(prazos[0]!)).toBe('28 dias');
    // habilitada não lê motivo, mesmo que venha
    expect(leituraDaOpcao({ rotulo: '28 dias', motivo: 'x' })).toBe('28 dias');
    // rótulo abreviado lê por extenso
    expect(leituraDaOpcao(TIPOS_AJUSTE[1]!)).toBe('Desconto em reais');
  });

  it('campo fechado: rótulo da marcada; sem marcada ou id fora da lista, o placeholder', () => {
    expect(textoDaSelecao(prazos, 'p2856', 'Escolha')).toEqual({ texto: '28/56 dias', vazio: false });
    expect(textoDaSelecao(prazos, null, 'Escolha')).toEqual({ texto: 'Escolha', vazio: true });
    expect(textoDaSelecao(prazos, 'sumiu', 'Escolha')).toEqual({ texto: 'Escolha', vazio: true });
  });

  it('menu abre logo abaixo do campo, com a largura dele, e rola acima de 5 opções', () => {
    const p = posicaoDoMenu({ campo: { x: 16, y: 120, largura: 160, altura: 48 }, janela: { largura: 360, altura: 780 }, quantidade: 3 });
    expect(p).toEqual({ left: 16, width: 160, top: 172, maxHeight: 3 * 48 + 2, acima: false });
    const muitas = posicaoDoMenu({ campo: { x: 16, y: 120, largura: 160, altura: 48 }, janela: { largura: 360, altura: 780 }, quantidade: 9 });
    expect(muitas.maxHeight).toBe(5 * 48 + 2);
  });

  it('sem espaço embaixo (campo perto do teclado ou do fim), abre acima; nunca sai da janela', () => {
    const p = posicaoDoMenu({ campo: { x: 300, y: 700, largura: 52, altura: 44 }, janela: { largura: 360, altura: 780 }, quantidade: 4, larguraMinima: 168 });
    expect(p.acima).toBe(true);
    expect(p.bottom).toBe(780 - 700 + 4);
    expect(p.width).toBe(168);
    expect(p.left + p.width).toBeLessThanOrEqual(360 - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});

describe('campo de ajuste com o tipo ao lado (Desc %, Desc R$, Acrésc %, Acrésc R$)', () => {
  it('os 4 tipos, nesta ordem, com leitura por extenso', () => {
    expect(TIPOS_AJUSTE.map((t) => t.rotulo)).toEqual(['Desc %', 'Desc R$', 'Acrésc %', 'Acrésc R$']);
    expect(TIPOS_AJUSTE.map((t) => t.id)).toEqual(['desc_pct', 'desc_reais', 'acresc_pct', 'acresc_reais']);
    for (const t of TIPOS_AJUSTE) expect(t.rotuloAcessivel).toMatch(/^(Desconto|Acréscimo) em (porcentagem|reais)$/);
  });

  it('saneia o decimal digitado: ponto vira vírgula, uma vírgula só, casas limitadas', () => {
    expect(sanearDecimal('3.5')).toBe('3,5');
    expect(sanearDecimal('3,456')).toBe('3,45');
    expect(sanearDecimal('a1')).toBe('1');
    expect(sanearDecimal(',')).toBe('0,');
    expect(sanearDecimal('1,2,3')).toBe('1,23');
    expect(sanearDecimal('7,9', 0)).toBe('7');
  });

  it('lê o decimal ("3,0", "3.5", "1.234,56"); sem dígito → null', () => {
    expect(lerDecimal('3,0')).toBe(3);
    expect(lerDecimal('3.5')).toBe(3.5);
    expect(lerDecimal('1.234,56')).toBe(1234.56);
    expect(lerDecimal(' ')).toBeNull();
    expect(lerDecimal(',')).toBeNull();
    expect(textoDecimal(3)).toBe('3,0');
    expect(textoDecimal(12.5, 2)).toBe('12,50');
    expect(textoDecimal(Number.NaN)).toBe('');
  });
});

describe('passo compacto (− n +) da linha 3 do item: bug do "+" e alvo de toque', () => {
  it('visual de 30 dp com botões de 32 dp; alvo de 44 × 44 dp do próprio botão (sem hitSlop)', () => {
    expect(PASSO_COMPACTO.altura).toBeGreaterThanOrEqual(28);
    expect(PASSO_COMPACTO.altura).toBeLessThanOrEqual(32);
    expect(PASSO_COMPACTO.botao).toBeLessThanOrEqual(32);
    expect(alvoDoPassoCompacto()).toEqual({ largura: 44, altura: 44 });
    expect(PASSO_COMPACTO.largura).toBe(2 * PASSO_COMPACTO.alvo + PASSO_COMPACTO.valor);
    // o recuo da moldura é o que o alvo passa do botão desenhado, do lado de fora
    expect(PASSO_COMPACTO.recuo).toBe(PASSO_COMPACTO.alvo - PASSO_COMPACTO.botao);
  });

  it('tocar "+" 3 vezes a partir de 0 dá 3 (cada toque lê o valor do momento)', () => {
    const vivo = { texto: '0', focado: false, valor: 0 };
    for (let i = 0; i < 3; i++) {
      vivo.valor = passoComTexto(vivo, 1);
      vivo.texto = String(vivo.valor);
    }
    expect(vivo.valor).toBe(3);
    expect(passoComTexto(vivo, -1)).toBe(2);
    expect(passoComTexto({ texto: '0', focado: false, valor: 0 }, -1)).toBe(0);
  });

  it('com o teclado aberto, o "+" parte do número digitado (digitar 5 e tocar + dá 6); texto vazio usa o valor', () => {
    expect(passoComTexto({ texto: '5', focado: true, valor: 1 }, 1)).toBe(6);
    expect(passoComTexto({ texto: '', focado: true, valor: 2 }, 1)).toBe(3);
    // sem foco, o texto velho não conta
    expect(passoComTexto({ texto: '9', focado: false, valor: 2 }, 1)).toBe(3);
    expect(passoComTexto({ texto: '5', focado: true, valor: 1 }, 1, 1, 0, 5)).toBe(5);
  });

  it('o componente usa ref do momento, contêiner de 44 dp e nenhum hitSlop no modo compacto', () => {
    const f = ler('./formulario.tsx');
    const passo = bloco(f, 'Passo');
    expect(passo).toContain('passoComTexto(vivo.current, direcao, passo, min, max)');
    expect(passo).toContain('vivo.current.focado = true');
    expect(f).toMatch(/passoCompacto: \{[^}]*height: PASSO_COMPACTO\.alvo[^}]*width: PASSO_COMPACTO\.largura/);
    expect(f).toMatch(/passoAlvoCompacto: \{[^}]*width: PASSO_COMPACTO\.alvo, height: PASSO_COMPACTO\.alvo/);
    const botao = /function BotaoPasso[\s\S]*?\n}\n/.exec(f)?.[0] ?? '';
    const compacto = botao.slice(botao.indexOf('if (compacto)'), botao.indexOf('  return (\n    <Pressable', botao.indexOf('if (compacto)') + 20));
    expect(compacto.length).toBeGreaterThan(50);
    expect(compacto).not.toContain('hitSlop');
  });
});

describe('Segmentado compacto (UN | CX) da linha 3 do item', () => {
  it('visual de 30 dp, alvo de 44 dp por opção; a largura cabe as opções sem transbordar (2 → 94, 3 → 144)', () => {
    expect(SEGMENTADO_COMPACTO.altura).toBe(PASSO_COMPACTO.altura);
    expect(SEGMENTADO_COMPACTO.alvo).toBeGreaterThanOrEqual(44);
    expect(larguraSegmentadoCompacto(2)).toBe(94);
    expect(larguraSegmentadoCompacto(3)).toBe(144);
    expect(larguraSegmentadoCompacto(0)).toBe(44);
  });

  it('o visual não estica até o alvo: flex 0 e altura de 30 dp no segItemCompacto; o .seg usa o mesmo vão da conta', () => {
    const f = ler('./formulario.tsx');
    expect(f).toMatch(/segItemCompacto: \{ flex: 0,[^}]*height: ALTURA_SEG_COMPACTO/);
    expect(f).toMatch(/segAlvoCompacto: \{[^}]*height: ALVO_SEG_COMPACTO/);
    expect(f).toMatch(/seg: \{ flexDirection: 'row', gap: SEGMENTADO_COMPACTO\.vao \}/);
    const seg = /export function Segmentado[\s\S]*?\n}\n/.exec(f)?.[0] ?? '';
    expect(seg.length).toBeGreaterThan(100);
    expect(seg).not.toContain('hitSlop');
  });
});

describe('cartão "Crédito do cliente" (RN-VEN-12, RN-VEN-13)', () => {
  it('alerta de inadimplência com quantidade, valor, dias e a consequência (texto da referência)', () => {
    expect(textoInadimplencia({ titulos: 2, valorCents: 48000, dias: 12, consequencia: CONSEQUENCIA_VENCIDO })).toBe(
      'Cliente inadimplente: 2 títulos vencidos · R$ 480,00 · há 12 dias. Só à vista ou com aprovação.',
    );
    expect(textoInadimplencia({ titulos: 1, valorCents: 9990, dias: 1 })).toBe('Cliente inadimplente: 1 título vencido · R$ 99,90 · há 1 dia.');
    expect(textoInadimplencia({ titulos: 1, valorCents: 100, dias: 0, consequencia: 'Só à vista' })).toBe('Cliente inadimplente: 1 título vencido · R$ 1,00 · vence hoje. Só à vista.');
  });

  it('data da última sincronização no fuso do tenant (vale offline)', () => {
    const tz = 'America/Manaus';
    const agora = '2026-11-06T14:00:00Z';
    expect(textoAtualizacao('2026-11-06T10:20:00Z', agora, tz)).toBe('Atualizado hoje às 06:20');
    expect(textoAtualizacao('2026-11-05T22:02:00Z', agora, tz)).toBe('Atualizado ontem às 18:02');
    expect(textoAtualizacao('2026-11-03T22:02:00Z', agora, tz)).toBe('Atualizado em 03/11 às 18:02');
    expect(textoAtualizacao(null, agora, tz)).toBe('Ainda não sincronizado');
  });

  it('o cartão não tem "Após este pedido", o alerta é a Faixa de erro e não há texto fixo', () => {
    const c = ler('./cartoes-pedido.tsx');
    const cartao = bloco(c, 'CartaoCredito');
    expect(cartao.length).toBeGreaterThan(200);
    expect(cartao).not.toMatch(/Após este pedido/);
    expect(cartao).toContain('<Faixa tom="erro" texto={alerta}');
    expect(cartao).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
  });
});

describe('cartão "Leve mais e pague menos" (RN-VEN-23)', () => {
  it('textos da próxima faixa iguais à referência, com leitura e o rótulo do toque', () => {
    const t = textosLeveMais({ produto: 'Água mineral 1,5 L', quantidadeMinima: 10, medida: 'FD', precoMedidaCents: 1990, precoHojeCents: 2031, faltam: 7 });
    expect(t.titulo).toBe('Água mineral 1,5 L · leve 10 FD');
    expect(t.apoio).toBe('R$ 19,90/FD (hoje R$ 20,31) · faltam 7 FD');
    expect(t.leitura).toBe('Água mineral 1,5 L: levando 10 FD, R$ 19,90 por FD, hoje R$ 20,31. Faltam 7 FD.');
    expect(t.rotuloAjustar).toBe('Ajustar para 10 FD');
    expect(textosLeveMais({ produto: 'X', quantidadeMinima: 5, medida: 'UN', precoMedidaCents: 100, faltam: 2 }).apoio).toBe('R$ 1,00/UN · faltam 2 UN');
  });

  it('sem item, o cartão não aparece; a linha inteira é o toque (alvo ≥ 48 dp)', () => {
    const c = ler('./cartoes-pedido.tsx');
    const cartao = bloco(c, 'CartaoLeveMais');
    expect(cartao).toContain('if (itens.length === 0) return null;');
    expect(cartao).toContain('onPress={i.onAjustar}');
    expect(cartao).toContain('accessibilityHint={i.rotuloAjustar}');
    expect(c).toMatch(/linha: \{ minHeight: ALVO_TOQUE \+ 8/);
  });
});

describe('lista suspensa e campo de ajuste: conferência estática', () => {
  const sus = ler('./suspensa.tsx');

  it('opção desabilitada: sem toque, cadeado, estado lido e motivo no rótulo acessível', () => {
    expect(sus).toContain('accessibilityLabel={leituraDaOpcao(o)}');
    expect(sus).toContain('accessibilityState={{ selected: marcada, disabled: off }}');
    expect(sus).toContain('disabled={off}');
    expect(sus).toMatch(/<Icon name="lock"/);
  });

  it('campo de ajuste sem hitSlop: tipo e valor com 44 dp dentro do contêiner, moldura de 30 dp atrás', () => {
    const ajuste = bloco(sus, 'CampoAjuste');
    expect(ajuste.length).toBeGreaterThan(200);
    expect(ajuste).not.toContain('hitSlop');
    expect(sus).toContain('const ALVO_AJUSTE = PASSO_COMPACTO.alvo;');
    expect(sus).toMatch(/ajuste: \{[^}]*height: ALVO_AJUSTE/);
    expect(sus).toMatch(/ajusteTipoAlvo: \{[^}]*height: ALVO_AJUSTE/);
    expect(sus).toMatch(/ajusteValor: \{[^}]*height: ALVO_AJUSTE/);
    expect(sus).toMatch(/ajusteMoldura: \{[^}]*height: ALTURA_AJUSTE/);
  });

  it('nenhum texto fixo nos componentes e exportados no índice e no puro', () => {
    for (const nome of ['ListaSuspensa', 'CampoAjuste']) expect(bloco(sus, nome), nome).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
    const indice = ler('./index.ts');
    for (const arq of ['./selecao', './periodo', './suspensa', './filtro', './cartoes-pedido']) expect(indice).toContain(`export * from '${arq}'`);
    const puro = ler('./puro.ts');
    for (const arq of ['./selecao', './periodo']) expect(puro).toContain(`export * from '${arq}'`);
  });
});
