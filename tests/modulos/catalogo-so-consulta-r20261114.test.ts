/**
 * Catálogo só para consulta (decisão do dono do produto, R-20261114-151000-alexandre). Sem banco: roda local e no CI.
 *  - PR do modulo-vendedor (nuvem/catalogo-orcamento-modulo-vendedor): sai "Adicionar ao pedido" do Catálogo; entra
 *    "Adicionar ao orçamento" (slot `produto.acoes`), que abre a folha `adicionar-ao-orcamento` com os orçamentos EM ABERTO do
 *    vendedor e, sem nenhum, só "Nenhum orçamento em aberto.". A ação mexe só no orçamento escolhido (mesma via do "Editar").
 *  - PR do modulo-catalogo (nuvem/copiar-codigo-modulo-catalogo): botão "Copiar código" na lista (saiu da ficha, R-20261120-055304); copia o mesmo
 *    código exibido (`erp_code`) e não cria pedido.
 * Os dois estados valem (este arquivo entra no `main` antes dos PRs): o estado é lido do fonte. Antes do PR, os casos novos
 * conferem o que vale hoje (ou não se aplicam) e o caso de valor × regra usa a regra que já existe (`orcamentoEmAberto`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const empurrados: string[] = [];
vi.mock('expo-router', () => ({
  router: {
    push: (h: string) => empurrados.push(h),
    navigate: (h: string) => empurrados.push(h),
    replace: (h: string) => empurrados.push(h),
  },
}));

import { caminhoDoLinkInterno, linkInternoNavegavel } from '@macuxi/platform-sdk';
import { localIsoDate } from '@macuxi/comum/fuso';
import { subtituloProduto } from '../../modules/catalogo/app/lib/apresentacao';
import { dataDaValidade } from '../../modules/vendedor/domain/orcamento';
import { orcamentoEmAberto } from '../../modules/vendedor/domain/resumo-inicio';
import { SO_ORCAMENTO } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const existe = (rel: string) => existsSync(join(RAIZ, rel));
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const INDEX_VENDEDOR = ler('modules/vendedor/app/index.ts');
/** Estado do PR do modulo-catalogo: o botão "Copiar código". */
const COPIAR_CODIGO = existe('modules/catalogo/app/lib/copiar-codigo.ts');

const TELAS_CATALOGO = ['catalogo.tsx', 'produto.tsx', 'comum.tsx'].map((t) => `modules/catalogo/app/telas/${t}`);
/** Bloco da extensão `produto.acoes` no index do Vendedor (do `slot:` até o próximo `slot:`). */
const blocoProdutoAcoes = (): string => {
  const ini = INDEX_VENDEDOR.indexOf("slot: 'produto.acoes'");
  if (ini < 0) return '';
  const fim = INDEX_VENDEDOR.indexOf('slot: ', ini + 10);
  return INDEX_VENDEDOR.slice(ini, fim < 0 ? undefined : fim);
};

describe('R-20261114-151000 — o Catálogo não cria pedido (a)', () => {
  beforeEach(() => {
    empurrados.length = 0;
  });

  it('as telas do Catálogo não têm texto, rota nem ação de pedido próprios (os dois estados)', () => {
    for (const rel of TELAS_CATALOGO) {
      const fonte = semComentarios(ler(rel));
      expect(fonte, rel).not.toMatch(/Adicionar ao pedido/);
      expect(fonte, rel).not.toMatch(/irParaNovoPedido|hrefNovoPedido|novo-pedido|\/v1\/vendedor\/pedidos/);
      expect(fonte, rel).not.toMatch(/['"]pedido\.(criar|editar)['"]/);
      expect(fonte, rel).not.toMatch(/@macuxi\/vendedor/);
    }
  });

  it('a única ação que o Vendedor põe no Catálogo: "Adicionar ao orçamento" (sem abrir pedido novo); antes do PR, "Adicionar ao pedido"', () => {
    const bloco = semComentarios(blocoProdutoAcoes());
    expect(bloco, 'extensão produto.acoes do Vendedor').not.toBe('');
    // uma extensão só no slot
    expect(INDEX_VENDEDOR.split("slot: 'produto.acoes'").length - 1).toBe(1);
    if (!SO_ORCAMENTO) {
      expect(bloco).toContain("rotulo: 'Adicionar ao pedido'");
      return;
    }
    expect(bloco).toContain("id: 'adicionar-ao-orcamento'");
    expect(bloco).toContain("rotulo: 'Adicionar ao orçamento'");
    expect(bloco).toContain("acao: 'pedido.criar'");
    expect(bloco).toMatch(/apps: \['campo'\]/);
    expect(bloco).toMatch(/abrir: \(ctx\) => irParaAdicionarAoOrcamento\(ctx\.produtoId, ctx\.nomeProduto\)/);
    expect(bloco).not.toMatch(/Adicionar ao pedido|irParaNovoPedido|hrefNovoPedido|deixarProdutoPendente|novo-pedido/);
    // o index não usa mais o produto pendente do editor de pedido
    expect(semComentarios(INDEX_VENDEDOR)).not.toMatch(/deixarProdutoPendente|pegarOrigemEditor/);
  });

  it('a rota da ação abre a folha `adicionar-ao-orcamento` (página registrada, só Campo, sem promotor), nunca o `novo-pedido`', async () => {
    if (!SO_ORCAMENTO) return;
    const rotas = (await import('../../modules/vendedor/app/rotas')) as unknown as Record<string, unknown>;
    const ir = rotas.irParaAdicionarAoOrcamento as (produtoId: string, nome: string) => void;
    const href = rotas.hrefAdicionarAoOrcamento as (produtoId: string, nome: string) => string;
    const CAMINHO = rotas.CAMINHO_ADICIONAR_AO_ORCAMENTO as string;
    expect(CAMINHO).toBe('adicionar-ao-orcamento');
    ir('11111111-1111-4111-8111-111111111111', 'Café 500 g');
    expect(empurrados).toHaveLength(1);
    expect(empurrados[0]).toBe(href('11111111-1111-4111-8111-111111111111', 'Café 500 g'));
    expect(empurrados[0]).toMatch(/^\/m\/adicionar-ao-orcamento\?/);
    expect(empurrados[0]).not.toContain('novo-pedido');
    const qs = new URLSearchParams(empurrados[0]!.split('?')[1]);
    expect([qs.get('produtoId'), qs.get('nome')]).toEqual(['11111111-1111-4111-8111-111111111111', 'Café 500 g']);
    expect(caminhoDoLinkInterno(empurrados[0]!)).toBe(CAMINHO);
    expect(linkInternoNavegavel(empurrados[0]!)).toBe(empurrados[0]);
    const pagina = INDEX_VENDEDOR.split('\n').find((l) => /\{ id: 'adicionar-ao-orcamento',/.test(l)) ?? '';
    expect(pagina).toMatch(/caminho: 'adicionar-ao-orcamento'/);
    expect(pagina).toMatch(/componente: AdicionarAoOrcamentoScreen \}/);
  });

  it('a folha não cria nem abre pedido: só lista os orçamentos em aberto e grava no escolhido; vazio = só "Nenhum orçamento em aberto."', () => {
    if (!SO_ORCAMENTO) return;
    const tela = semComentarios(ler('modules/vendedor/app/screens/adicionar-ao-orcamento-screen.tsx'));
    expect(tela).not.toMatch(/irParaNovoPedido|hrefNovoPedido|NewOrder|novo-pedido|enviarPedido|criarPedido|randomUUID|uuid/i);
    expect(tela).not.toMatch(/Adicionar ao pedido/);
    expect(tela).toMatch(/const lista = app\.orcamentosParaAdicionar;/);
    expect(tela).toMatch(/await app\.adicionarProdutoAoOrcamento\(id, produtoId\)/);
    // vazio: só a frase da regra (sem descrição nem botão)
    expect(tela).toMatch(/lista\.length === 0 \? \(\s*<EstadoVazio testID="adicionar-ao-orcamento-vazio" icone="clipboard" titulo=\{TEXTO_SEM_ORCAMENTO_EM_ABERTO\} \/>/);
    const vazio = /<EstadoVazio[^>]*\/>/.exec(tela)?.[0] ?? '';
    expect(vazio).not.toMatch(/descricao|acao|botao/i);
    // a linha da lista mostra o número e a data de criação no FUSO do tenant (nunca o dia em UTC)
    expect(tela).toMatch(/dataDaValidade\(localIsoDate\(o\.criado_em, app\.tz\), true\)/);
    expect(tela).not.toMatch(/criado_em\.slice\(/);
  });

  it('a gravação usa a via do "Editar orçamento" (rascunho de edição + salvarEdicao) no orçamento escolhido, sem documento novo', () => {
    if (!SO_ORCAMENTO) return;
    const estado = ler('modules/vendedor/app/state/use-vendedor.ts');
    const ini = estado.indexOf('const adicionarProdutoAoOrcamento = useCallback(');
    expect(ini).toBeGreaterThan(0);
    const bloco = semComentarios(estado.slice(ini, estado.indexOf('\n  );\n', ini)));
    expect(bloco).toMatch(/prepararRascunhoDoPedido\(orcamentoId, 'edit'\)/);
    expect(bloco).toMatch(/salvarEdicao\(orcamentoId, r\.rascunho, cliente, catalogo\)/);
    expect(bloco).not.toMatch(/randomUUID|novoId|enviarPedido|irParaNovoPedido|'new'|'duplicate'/);
    // a lista que a folha mostra sai da regra do domain, do vendedor da sessão, com tipo/status/conversão do documento
    const lista = estado.slice(estado.indexOf('const orcamentosParaAdicionar = useMemo('), ini);
    expect(lista).toMatch(/orcamentosEmAberto\(/);
    expect(lista).toMatch(/tipo: p\.tipo, status: p\.status, convertido_pedido_id: p\.convertido_pedido_id \?\? null, vendedor_id: p\.seller_id/);
    expect(lista).toMatch(/vendedor\.id,?\s*\)/);
  });
});

interface DocTeste {
  id: string;
  tipo?: string | null;
  status: string;
  convertido_pedido_id?: string | null;
  vendedor_id: string;
  numero: string;
  cliente_nome: string;
  criado_em: string;
}
type OrcamentosEmAberto = (docs: readonly DocTeste[], vendedorId: string) => { id: string; numero: string; cliente_nome: string; criado_em: string }[];

describe('R-20261114-151000 — "Adicionar ao orçamento" só lista orçamentos em aberto (b; valor × regra RN-VEN-18/30)', () => {
  const TIPOS = ['orcamento', 'pedido', undefined, null] as const;
  const STATUS = ['local', 'queued', 'pending_approval', 'received', 'approved', 'sent_to_erp', 'invoiced', 'rejected', 'cancelled'] as const;
  const CONV = [null, '99999999-9999-4999-8999-999999999999'] as const;
  const VENDEDORES = ['v1', 'v2'] as const;
  const docs: DocTeste[] = [];
  let n = 0;
  for (const tipo of TIPOS)
    for (const status of STATUS)
      for (const conv of CONV)
        for (const vendedor_id of VENDEDORES) {
          n += 1;
          // criação espalhada em minutos (a ordem esperada é do mais novo ao mais antigo)
          const criado_em = new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + ((n * 7919) % 1000) * 60_000).toISOString();
          docs.push({ id: `d${n}`, tipo, status, convertido_pedido_id: conv, vendedor_id, numero: `ORC-${n}`, cliente_nome: `Cliente ${n}`, criado_em });
        }
  /** O esperado pela regra única do card do Início (RN-VEN-18): orçamento, não cancelado, não convertido; só do vendedor. */
  const esperado = (vendedor: string) =>
    docs
      .filter((d) => d.vendedor_id === vendedor && orcamentoEmAberto({ tipo: d.tipo === 'orcamento' ? 'orcamento' : 'pedido', status: d.status, total_cents: 0, convertido_pedido_id: d.convertido_pedido_id ?? null }))
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
      .map((d) => d.id);

  it('a matriz cobre em aberto e fora', () => {
    // a regra (convertido, cancelado e pedido fora) é de modules/vendedor/domain/resumo-inicio.test.ts; aqui, o "esperado" não é vazio nem tudo
    const e = esperado('v1');
    expect(e.length).toBeGreaterThan(0);
    expect(e.length).toBeLessThan(docs.length / 2);
  });

  it('a lista da folha (`orcamentosEmAberto`) = a regra, em todas as combinações tipo × status × conversão × vendedor, do mais novo ao mais antigo', async () => {
    if (!SO_ORCAMENTO) return;
    const mod = (await import('../../modules/vendedor/domain/orcamento-em-aberto' as string)) as { orcamentosEmAberto: OrcamentosEmAberto; TEXTO_SEM_ORCAMENTO_EM_ABERTO: string };
    for (const v of VENDEDORES) {
      const r = mod.orcamentosEmAberto(docs, v);
      expect(r.map((o) => o.id), v).toEqual(esperado(v));
      for (const o of r) {
        const d = docs.find((x) => x.id === o.id)!;
        // o que a linha mostra é o do documento (número, cliente e data), sem troca
        expect(o).toEqual({ id: d.id, numero: d.numero, cliente_nome: d.cliente_nome, criado_em: d.criado_em });
        expect(d.tipo).toBe('orcamento');
        expect(d.status).not.toBe('cancelled');
        expect(d.convertido_pedido_id).toBeNull();
      }
    }
    // sem nenhum em aberto: lista vazia e só a frase
    expect(mod.orcamentosEmAberto(docs.filter((d) => d.tipo !== 'orcamento' || d.convertido_pedido_id || d.status === 'cancelled'), 'v1')).toEqual([]);
    expect(mod.orcamentosEmAberto([], 'v1')).toEqual([]);
    expect(mod.TEXTO_SEM_ORCAMENTO_EM_ABERTO).toBe('Nenhum orçamento em aberto.');
  });

  it('data da linha no fuso do tenant: criado 15/11 02:30 UTC = 14/11/2026 em Manaus; virada de mês (01/12 03:59 UTC = 30/11) e de ano', () => {
    const tela = (iso: string, tz: string) => dataDaValidade(localIsoDate(iso, tz), true);
    expect(tela('2026-11-15T02:30:00.000Z', 'America/Manaus')).toBe('14/11/2026');
    expect(tela('2026-11-15T02:30:00.000Z', 'America/Sao_Paulo')).toBe('14/11/2026');
    expect(tela('2026-11-15T04:30:00.000Z', 'America/Manaus')).toBe('15/11/2026');
    expect(tela('2026-12-01T03:59:00.000Z', 'America/Manaus')).toBe('30/11/2026');
    expect(tela('2027-01-01T02:00:00.000Z', 'America/Manaus')).toBe('31/12/2026');
  });
});

describe('PR do modulo-catalogo — "Copiar código" copia o código exibido e não cria pedido', () => {
  // R-20261120-055304 (spec campo-v1017 §4, item 13)
  it('só o cartão da lista passa o `erp_code` do produto ao botão (a ficha não tem o botão); a ficha exibe esse mesmo código no subtítulo', async () => {
    const produto = semComentarios(ler('modules/catalogo/app/telas/produto.tsx'));
    expect(produto).not.toContain('BotaoCopiarCodigo');
    if (!COPIAR_CODIGO) return;
    const comum = semComentarios(ler('modules/catalogo/app/telas/comum.tsx'));
    expect(produto).toMatch(/subtitulo: `\$\{subtituloProduto\(item\)\}/);
    const cartao = comum.slice(comum.indexOf('export function CartaoGrade('));
    expect(cartao).toContain('<BotaoCopiarCodigo codigo={item.erp_code} />');
    expect(comum.match(/<BotaoCopiarCodigo /g), 'um botão só, o do cartão').toHaveLength(1);
    // valor × rótulo: o código copiado é o que o cartão e o subtítulo da ficha mostram
    const item = { brand: 'Freiomax', erp_code: 'CB3401' };
    const copiados: string[] = [];
    const mod = (await import('../../modules/catalogo/app/lib/copiar-codigo' as string)) as {
      copiarCodigo: (codigo: string, padrao?: (t: string) => void | Promise<void>) => Promise<{ ok: boolean; aviso: string }>;
      ROTULO_COPIAR_CODIGO: string;
    };
    const r = await mod.copiarCodigo(item.erp_code, (t) => void copiados.push(t));
    expect(r).toEqual({ ok: true, aviso: 'Código copiado' });
    expect(copiados).toEqual(['CB3401']);
    expect(subtituloProduto(item).split(' · ')).toContain(copiados[0]);
    expect(mod.ROTULO_COPIAR_CODIGO).toBe('Copiar código');
  });

  it('o botão só copia: sem rota, pedido, sync nem extensão de pedido', () => {
    if (!COPIAR_CODIGO) return;
    const comum = semComentarios(ler('modules/catalogo/app/telas/comum.tsx'));
    const ini = comum.indexOf('export function BotaoCopiarCodigo(');
    expect(ini).toBeGreaterThanOrEqual(0);
    const fim = comum.indexOf('\nexport function ', ini + 10);
    const botao = comum.slice(ini, fim < 0 ? undefined : fim);
    expect(botao).toMatch(/copiarCodigo\(codigo, \(t\) => Clipboard\.setString\(t\)\)/);
    expect(botao).not.toMatch(/router|irPara|href|pedido|useExtensoes|motor|push\(/i);
    const lib = semComentarios(ler('modules/catalogo/app/lib/copiar-codigo.ts'));
    expect(lib).not.toMatch(/^import /m);
  });
});
