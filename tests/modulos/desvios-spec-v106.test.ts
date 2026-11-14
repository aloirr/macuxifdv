/**
 * v1.0.6 — desvios de spec encaminhados pelo corretor-redundancias (docs/qualidade/redundancias/2026-11-13-v1.0.6.md,
 * seção "Encaminhado ao testes"), conferidos no FONTE: as telas importam React Native, que não roda no Node (mesmo padrão de
 * tests/modulos/demo-abas.test.ts).
 *
 * Convenção (a de kit-piloto-t0162.test.ts): `it` = vale hoje; `it.fails` = desvio aberto D-V106-n (fica vermelho quando
 * corrigido e vira `it` no mesmo commit).
 * - D-V106-1 subtítulo do Catálogo: vale "abaixo" (parecer de marca 2026-11-13-v1.0.6, MC-0008 corrigida); a spec
 *   docs/design/catalogo-grade.md §1.1 ainda diz "acima" e a prancha está na MC-0013 (designer-ux).
 * - D-V106-2 filtro vazio sem "Ver todos" (RD-0244): conforme.
 * - D-V106-3 "Equivale a" no cartão da grade (RN-CAT-09, catalogo-grade.md §2): TalkBack e destaque abertos (modulo-catalogo).
 * - D-V106-4 consulta de Pedidos cortada no servidor (pedido-v4.md:170): `cortada` gravado e nunca exibido (modulo-vendedor e
 *   designer-ux).
 * Roteiro do aparelho: docs/testes/v1.0.6-roteiro.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const CATALOGO = ler('modules/catalogo/app/telas/catalogo.tsx');
const COMUM = ler('modules/catalogo/app/telas/comum.tsx');
const PEDIDOS = ler('modules/vendedor/app/screens/orders-screen.tsx');

/**
 * Corpo do `CartaoGrade` (de `export function CartaoGrade` até o próximo `\nexport `, ou o fim do arquivo). Falha alto se a
 * função sumir ou mudar de nome, para nenhum `it.fails` passar por erro de leitura.
 */
function corpoDoCartaoGrade(fonte: string): string {
  const inicio = fonte.indexOf('export function CartaoGrade');
  if (inicio < 0) throw new Error('comum.tsx sem `export function CartaoGrade`: atualize o teste antes de ler os casos D-V106-3');
  const fim = fonte.indexOf('\nexport ', inicio + 1);
  return fonte.slice(inicio, fim < 0 ? undefined : fim);
}
const CARTAO_GRADE = corpoDoCartaoGrade(COMUM);

/** Mesma guarda para a tela de Pedidos: sem a constante do corte, os casos D-V106-4 não leem o que pensam ler. */
if (!/PAGINAS_MAXIMAS_DA_CONSULTA/.test(PEDIDOS)) throw new Error('orders-screen.tsx sem PAGINAS_MAXIMAS_DA_CONSULTA: atualize os casos D-V106-4');

describe('D-V106-1 — subtítulo do Catálogo abaixo do título (MC-0008)', () => {
  it('catalogo.tsx usa posicaoSubtitulo "abaixo" e não "acima"', () => {
    expect(CATALOGO).toMatch(/posicaoSubtitulo:\s*'abaixo'/);
    expect(CATALOGO).not.toMatch(/posicaoSubtitulo:\s*'acima'/);
    expect(CATALOGO).not.toContain("'acima'");
  });
});

describe('D-V106-2 — filtro sem produto sem "Ver todos" (RD-0244, catalogo-grade.md §5)', () => {
  it('o vazio do filtro só tem o título; o chip "Todas" volta a categoria para null', () => {
    const linhaVazio = CATALOGO.split('\n').find((l) => l.includes('Nenhum produto em'));
    expect(linhaVazio, 'linha do EstadoVazio do filtro').toBeDefined();
    expect(linhaVazio).not.toContain('acao=');
    expect(CATALOGO).not.toContain('Ver todos');
    const chipTodas = CATALOGO.split('\n').find((l) => l.includes('label="Todas"'));
    expect(chipTodas, 'chip "Todas"').toBeDefined();
    expect(chipTodas).toContain('escolherCategoria(f, null)');
  });
});

describe('D-V106-3 — "Equivale a" no cartão da grade (RN-CAT-09, catalogo-grade.md §2)', () => {
  it('a linha da marca vira "Equivale a …" quando a busca achou pelo código do concorrente', () => {
    expect(CARTAO_GRADE).toContain('Equivale a ${');
  });

  // D-V106-3a ABERTO — dono: modulo-catalogo (comum.tsx:59). Fere catalogo-grade.md §2 ("TalkBack do cartão: <nome>, <marca>,
  // <preço>, <estoque>", com a marca = a linha exibida): quando a linha mostra "Equivale a …", o TalkBack lê `item.brand`,
  // um texto que não está na tela. Correção esperada: passar `linhaMarca` no lugar de `item.brand`.
  it.fails('o TalkBack lê a mesma linha que a tela mostra (linhaMarca, não item.brand)', () => {
    expect(CARTAO_GRADE).toMatch(/rotuloAcessivelDoCartao\(\[\s*item\.description,\s*linhaMarca\b/);
  });

  // D-V106-3b ABERTO — dono: modulo-catalogo (comum.tsx, CartaoGrade). Fere RN-CAT-09 e catalogo-grade.md §2 ("com o trecho
  // destacado"): o cartão mostra o "Equivale a …" em texto corrido, sem o trecho que casou com a busca. O `partirPorMarcas`
  // de app/lib/apresentacao.ts existe e não é usado (RD-0245 do corretor).
  it.fails('o trecho que casou com a busca aparece destacado no cartão', () => {
    expect(CARTAO_GRADE).toMatch(/partirPorMarcas|destaque|Destacad/);
  });
});

describe('D-V106-4 — consulta de Pedidos cortada no servidor (pedido-v4.md:170)', () => {
  it('a consulta marca cortada = true quando chega à última página permitida', () => {
    expect(PEDIDOS).toContain('PAGINAS_MAXIMAS_DA_CONSULTA - 1) cortada = true');
  });

  // D-V106-4 ABERTO — donos: modulo-vendedor (orders-screen.tsx) e designer-ux (onde e com que texto o aviso fica, no lugar do
  // "· 1.000 mais recentes" que saiu com a linha "Total R$" na T-0170, commit c88c72f). Fere pedido-v4.md:170: o corte do
  // servidor fica sem aviso e o vendedor pode tomar a lista (e os cards) como completa. A leitura `.cortada` no render é o que
  // falta; a declaração do tipo (`cortada?: boolean`), o `cortada = true` e o `, cortada })` não casam com esta regex.
  it.fails('a tela lê consulta.cortada para avisar que a lista foi cortada', () => {
    expect(PEDIDOS).toMatch(/\.cortada\b/);
  });
});
