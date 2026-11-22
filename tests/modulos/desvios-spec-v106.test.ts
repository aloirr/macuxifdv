/**
 * v1.0.6 — desvios de spec encaminhados pelo corretor-redundancias (docs/qualidade/redundancias/2026-11-13-v1.0.6.md,
 * seção "Encaminhado ao testes"), conferidos no FONTE: as telas importam React Native, que não roda no Node (mesmo padrão de
 * tests/modulos/demo-abas.test.ts). A lib pura do cartão (modules/catalogo/app/lib/grade.ts) carrega no Node e o D-V106-3
 * prova o comportamento dela.
 *
 * Convenção (a de kit-piloto-t0162.test.ts): `it` = vale hoje; `it.fails` = desvio aberto D-V106-n (fica vermelho quando
 * corrigido e vira `it` no mesmo commit).
 * - D-V106-1 subtítulo do Catálogo: vale "abaixo" (parecer de marca 2026-11-13-v1.0.6, MC-0008 corrigida); a spec
 *   docs/design/catalogo-grade.md §1.1 ainda diz "acima" e a prancha está na MC-0013 (designer-ux).
 * - D-V106-2 filtro vazio sem "Ver todos" (RD-0244): conforme.
 * - D-V106-3 "Equivale a" no cartão da grade (RN-CAT-09, catalogo-grade.md §2): a linha sai de `linhaDaMarca` (grade.ts);
 *   TalkBack (3a) corrigido no #151; destaque (3b) aberto (modulo-catalogo).
 * - D-V106-4 consulta de Pedidos cortada no servidor (pedido-v4.md:170): `cortada` gravado e nunca exibido (modulo-vendedor e
 *   designer-ux).
 * Roteiro do aparelho: docs/testes/v1.0.6-roteiro.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linhaDaMarca } from '../../modules/catalogo/app/lib/grade';
import type { ItemVitrine } from '../../modules/catalogo/contracts';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const CATALOGO = ler('modules/catalogo/app/telas/catalogo.tsx');
const COMUM = ler('modules/catalogo/app/telas/comum.tsx');
const FOLHA_FILTRO = ler('modules/catalogo/app/telas/estoque-filial.tsx');
const PEDIDOS = ler('modules/vendedor/app/screens/orders-screen.tsx');
const UI_MOBILE = readdirSync(join(RAIZ, 'packages/ui/src/mobile'))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
  .map((f) => ler(`packages/ui/src/mobile/${f}`))
  .join('\n');

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

/**
 * Grupo Categoria da `FolhaFiltroCatalogo`: o trecho do corpo (chips literais ou `GrupoDeChips`, RD-2577) que usa `onCategoria`.
 * Falha alto se a folha sumir ou o grupo não for único.
 */
function grupoCategoriaDaFolha(fonte: string): string {
  const inicio = fonte.indexOf('export function FolhaFiltroCatalogo');
  if (inicio < 0) throw new Error('estoque-filial.tsx sem `export function FolhaFiltroCatalogo`: atualize o caso D-V106-2');
  const corpo = fonte.indexOf('}) {', inicio);
  const fim = fonte.slice(corpo).search(/\n(?:export |function |const )/);
  const grupos = fonte
    .slice(corpo, fim < 0 ? undefined : corpo + fim)
    .split(/(?=<GrupoDeChips\b|<Text style=\{e\.grupo\}>)/)
    .filter((g) => /\bonCategoria\b/.test(g));
  if (grupos.length !== 1) throw new Error(`FolhaFiltroCatalogo com ${grupos.length} grupos que usam onCategoria: atualize o caso D-V106-2`);
  return grupos[0]!;
}

/** O `GrupoDeChips` do kit devolve null pela opção "todas" (quando existe). */
function grupoDeChipsDevolveNull(ui: string): boolean {
  const inicio = ui.search(/(?:function|const) GrupoDeChips\b/);
  if (inicio < 0) return false;
  const fim = ui.slice(inicio + 1).search(/\n(?:export |function )/);
  return /\(null\)/.test(ui.slice(inicio, fim < 0 ? undefined : inicio + 1 + fim));
}

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
  // R-20261120-055304 (spec campo-v1017 §4, item 11): chips na folha "Filtrar" (FolhaFiltroCatalogo, estoque-filial.tsx), literais
  // ou pelo GrupoDeChips do kit (RD-2577)
  it('o vazio do filtro só tem o título; o chip "Todas" da folha volta a categoria para null', () => {
    const linhaVazio = CATALOGO.split('\n').find((l) => l.includes('Nenhum produto em'));
    expect(linhaVazio, 'linha do EstadoVazio do filtro').toBeDefined();
    expect(linhaVazio).not.toContain('acao=');
    expect(CATALOGO).not.toContain('Ver todos');
    expect(CATALOGO, 'chips fora da tela').not.toMatch(/["'`>]Todas["'`<]/);
    const grupo = grupoCategoriaDaFolha(FOLHA_FILTRO);
    expect(grupo, 'grupo Categoria').toMatch(/\bCategoria\b/);
    expect(grupo, 'opção "Todas" no grupo').toMatch(/["'`>]Todas["'`<]/);
    const passaOHandler = /=\{onCategoria\}|:\s*onCategoria\b/.test(grupo);
    const nullMapeado = /\b(?:valor|value|id)\s*[:=]\s*\{?\s*null\b/.test(grupo) || (/<GrupoDeChips\b/.test(grupo) && grupoDeChipsDevolveNull(UI_MOBILE));
    expect(/onCategoria\(null\)/.test(grupo) || (passaOHandler && nullMapeado), '"Todas" volta a categoria para null').toBe(true);
    expect(CATALOGO).toContain('onCategoria={(id) => setFiltro((f) => escolherCategoria(f, id))}');
  });
});

describe('D-V106-3 — "Equivale a" no cartão da grade (RN-CAT-09, catalogo-grade.md §2)', () => {
  const FREIOMAX: NonNullable<ItemVitrine['equivale_a']> = {
    marca_id: '00000000-0000-4000-8000-000000000001',
    marca_nome: 'Freiomax',
    codigo: 'CB 3401',
    marcas: [[0, 8]],
  };

  it('a linha da marca vira "Equivale a <marca> <código>" quando a busca achou pelo código do concorrente', () => {
    expect(linhaDaMarca({ brand: 'Doce Vale', equivale_a: FREIOMAX })).toBe('Equivale a Freiomax CB 3401');
    expect(linhaDaMarca({ brand: '', equivale_a: FREIOMAX })).toBe('Equivale a Freiomax CB 3401');
  });

  // `brand` é string obrigatória no contrato (ProductBase, core/contracts): "sem marca" chega como ''.
  it('sem equivalência, a linha é a marca do cadastro; sem marca, fica vazia', () => {
    expect(linhaDaMarca({ brand: 'Doce Vale', equivale_a: null })).toBe('Doce Vale');
    expect(linhaDaMarca({ brand: 'Doce Vale' })).toBe('Doce Vale');
    expect(linhaDaMarca({ brand: '', equivale_a: null })).toBe('');
    expect(linhaDaMarca({ brand: '' })).toBe('');
  });

  it('o CartaoGrade exibe a linha que vem de linhaDaMarca(item)', () => {
    expect(CARTAO_GRADE).toContain('const linhaMarca = linhaDaMarca(item);');
    expect(CARTAO_GRADE).toMatch(/<Text style=\{g\.marca\}[^>]*>\s*\{linhaMarca\}\s*<\/Text>/);
  });

  // D-V106-3a corrigido no #151 (comum.tsx:59): o TalkBack lê `linhaMarca`, a mesma linha que a tela mostra
  // (catalogo-grade.md §2: "<nome>, <marca>, <preço>, <estoque>").
  it('o TalkBack lê a mesma linha que a tela mostra (linhaMarca, não item.brand)', () => {
    expect(CARTAO_GRADE).toMatch(/rotuloAcessivelDoCartao\(\[\s*item\.description,\s*linhaMarca\b/);
  });

  // D-V106-3b ABERTO — dono: modulo-catalogo (comum.tsx, CartaoGrade). Fere RN-CAT-09 e catalogo-grade.md §2 ("com o trecho
  // destacado"): o cartão mostra o "Equivale a …" em texto corrido, sem o trecho que casou com a busca. O `partirPorMarcas`
  // de app/lib/apresentacao.ts existe e não é usado (RD-0245 do corretor).
  // Guarda do it.fails abaixo: ele tem de falhar pela falta do destaque, não pelo `payload.destaque` da extensão
  // `produto.acoes` (botão principal da ficha, em BotoesAcao), que fica fora do corpo lido do CartaoGrade.
  it('o corpo lido do CartaoGrade não inclui o `destaque` dos botões da extensão', () => {
    expect(COMUM).toMatch(/\.payload\.destaque\b/);
    expect(CARTAO_GRADE.startsWith('export function CartaoGrade')).toBe(true);
    expect(CARTAO_GRADE).not.toMatch(/\bdestaque\b/);
  });

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
