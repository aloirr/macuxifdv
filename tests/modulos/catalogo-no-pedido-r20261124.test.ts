/**
 * R-20261124-110151 — Catálogo aberto a partir do Novo pedido (RF-CAT-04, RN-PRO-01, regra 7). Sem banco.
 * Integração (unidades em modules/catalogo/contracts): href × shell real, `acoesDaTela` depois do shell (perfil, ação,
 * licença) e a página `catalogo-no-pedido` montada no `criarShell` real (páginas lidas do fonte: o app importa React Native).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acoesDaTela, hrefCatalogoNoPedido, type AcaoProduto } from '@macuxi/catalogo/contracts';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { criarShell, type ModuloId, type ModuloShell, type PaginaShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const FONTE_APP_CATALOGO = ler('modules/catalogo/app/index.ts');
const linhaDaPagina = (id: string) => FONTE_APP_CATALOGO.split('\n').find((l) => l.includes(`id: '${id}'`)) ?? '';

/** Páginas do Catálogo lidas do fonte (mesma leitura de promotor-sem-pedido.test.ts). */
const paginasCatalogo: PaginaShell<string>[] = ['catalogo', 'catalogo-no-pedido', 'produto'].map((id) => {
  const l = linhaDaPagina(id);
  const navegacao = /navegacao: '([^']+)'/.exec(l)?.[1];
  const apps = /apps: \[([^\]]*)\]/.exec(l)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) as ('campo' | 'gestao')[] | undefined;
  return {
    id,
    caminho: /caminho: '([^']+)'/.exec(l)![1]!,
    titulo: id,
    componente: id,
    acao: /\bacao: '([^']+)'/.exec(l)?.[1],
    ...(navegacao ? { navegacao, icone: 'search', ordem: 60 } : {}),
    ...(apps ? { apps } : {}),
  };
});

const pagar = { rotulo: 'x', testID: 't', abrir: () => undefined } satisfies AcaoProduto;
/** Três ações no slot: uma de pedido (escrita, `pedido.criar`), uma de consulta e uma sem `onde`. */
const extensoesVendedor = [
  { slot: 'produto.acoes', id: 'add-pedido', acao: 'pedido.criar', apps: ['campo' as const], payload: { ...pagar, onde: 'pedido' as const } },
  { slot: 'produto.acoes', id: 'add-orcamento', acao: 'pedido.criar', apps: ['campo' as const], payload: { ...pagar, onde: 'consulta' as const } },
  { slot: 'produto.acoes', id: 'ver-historico', acao: 'pedido.ver', payload: pagar },
];
const shell = (app: 'campo' | 'gestao') => {
  const modulos: ModuloShell<string>[] = [{ manifesto: core }, { manifesto: catalogo, paginas: paginasCatalogo }, { manifesto: vendedor, extensoes: extensoesVendedor }, { manifesto: promotor }];
  return criarShell(app, modulos);
};
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor'];
const naTela = (perfil: Perfil, ativos: ModuloId[], dentroDoPedido: boolean) =>
  acoesDaTela(shell('campo').montar({ perfil, modulosAtivos: ativos }).extensoes<AcaoProduto>('produto.acoes'), dentroDoPedido).map((e) => e.id);

describe('critério 1 — hrefCatalogoNoPedido', () => {
  it('o caminho do href é o da página registrada no shell', () => {
    const caminho = hrefCatalogoNoPedido({ pedidoEmCurso: 'p' }).slice('/m/'.length).split('?')[0]!;
    expect(shell('campo').montar({ perfil: 'vendedor', modulosAtivos: TODOS }).pagina(caminho)?.id).toBe('catalogo-no-pedido');
  });
});

describe('critério 2 — onde a ação aparece (shell real + acoesDaTela)', () => {
  it('vendedor: dentro do pedido, a de pedido e a sem "onde"; fora, a de consulta e a sem "onde"', () => {
    expect(naTela('vendedor', TODOS, true)).toEqual(['add-pedido', 'ver-historico']);
    expect(naTela('vendedor', TODOS, false)).toEqual(['add-orcamento', 'ver-historico']);
  });
});

describe('critério 3 — página catalogo-no-pedido', () => {
  it('shell: existe no Campo, não no Gestão; não entra na navegação; o promotor (produto.consultar) também a abre', () => {
    const campo = shell('campo').montar({ perfil: 'vendedor', modulosAtivos: TODOS });
    expect(campo.pagina('catalogo-no-pedido')?.modulo).toBe('catalogo');
    expect(campo.navegacao.map((n) => n.id)).not.toContain('catalogo-no-pedido');
    expect(shell('gestao').montar({ perfil: 'supervisor', modulosAtivos: TODOS }).pagina('catalogo-no-pedido')).toBeNull();
    expect(shell('campo').montar({ perfil: 'promotor', modulosAtivos: TODOS }).pagina('catalogo-no-pedido')).not.toBeNull();
    expect(shell('campo').montar({ perfil: 'vendedor', modulosAtivos: ['core'] }).pagina('catalogo-no-pedido')).toBeNull();
  });
});

describe('critério 4 — promotor e licença', () => {
  it('promotor nunca vê ação pedido.criar, dentro ou fora do pedido (RN-PRO-01)', () => {
    for (const dentro of [true, false]) expect(naTela('promotor', TODOS, dentro)).not.toContain('add-pedido');
    for (const dentro of [true, false]) expect(naTela('promotor', TODOS, dentro)).not.toContain('add-orcamento');
  });
  it('sem a licença do Vendedor (dono da ação), nenhuma ação dele aparece, dentro ou fora do pedido', () => {
    expect(naTela('vendedor', ['core', 'catalogo'], true)).toEqual([]);
    expect(naTela('vendedor', ['core', 'catalogo'], false)).toEqual([]);
  });
});
