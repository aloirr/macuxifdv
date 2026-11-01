/**
 * T-0028 — abas que o shell mobile monta na demo (tenant `demo`: core, catálogo, vendedor e promotor licenciados; o
 * gestor não). O shell (`criarShell` do platform-sdk) recebe os manifestos e as páginas que cada módulo declara em
 * `modules/<m>/app/index.ts` (`moduloApp.paginas`). As telas importam React Native, que não roda no Node: as páginas
 * são lidas do FONTE (id, navegacao e apps), como no shells.test.ts, e montadas no `criarShell` real.
 * Matriz: tests/plano/demo-matriz.md (D-C00 e D-G00..D-G01).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarShell, modulosEfetivos, type Manifesto, type ModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_INSTALADOS } from '../../apps/mobile/src/lib/instalados';

const RAIZ = join(__dirname, '..', '..');
const LICENCIADOS_DEMO = ['core', 'catalogo', 'vendedor', 'promotor'];
/** Módulos por perfil na demo (`plataforma.perfil_modulo` do seed, docs/banco/README.md "Base de demo"). */
const DO_PERFIL: Record<string, string[]> = {
  vendedor: ['core', 'catalogo', 'vendedor'],
  promotor: ['core', 'catalogo', 'promotor'],
  supervisor: ['core', 'catalogo', 'vendedor', 'promotor'],
};

interface PaginaFonte {
  id: string;
  caminho: string;
  titulo: string;
  navegacao?: string;
  acao?: string;
  apps: Array<'campo' | 'gestao'>;
}

/** Páginas declaradas no `moduloApp` do módulo (vazio se o módulo não tem telas: `export {}`). */
function paginasDoFonte(modulo: string): PaginaFonte[] {
  const arq = join(RAIZ, 'modules', modulo, 'app', 'index.ts');
  if (!existsSync(arq)) return [];
  const fonte = readFileSync(arq, 'utf8');
  const bloco = /paginas:\s*\[([\s\S]*?)\n\s*\],/.exec(fonte)?.[1] ?? '';
  return [...bloco.matchAll(/\{\s*id:\s*'([^']+)'([^\n]*)\}/g)].map(([, id, resto]) => {
    const campo = (k: string) => new RegExp(`(?:^|[\\s,{])${k}:\\s*'([^']+)'`).exec(resto!)?.[1];
    const apps = (/apps:\s*\[([^\]]*)\]/.exec(resto!)?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    return { id: id!, caminho: campo('caminho')!, titulo: campo('titulo')!, navegacao: campo('navegacao'), acao: campo('acao'), apps: apps as PaginaFonte['apps'] };
  });
}

const MODULOS: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) => ({
  manifesto: m,
  paginas: paginasDoFonte(m.id).map((p) => ({ ...p, componente: p.id })),
}));

function abas(variante: 'campo' | 'gestao', perfil: Perfil): string[] {
  const shell = criarShell<string>(variante, MODULOS);
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS as Manifesto[], ativosNoTenant: LICENCIADOS_DEMO as never, doPerfil: DO_PERFIL[perfil] as never });
  return shell.montar({ perfil, modulosAtivos: ativos }).navegacao.map((n) => n.rotulo);
}

describe('T-0028 — abas do app na demo (shell real, páginas do fonte)', () => {
  it('D-C00: Campo do vendedor tem Rota, Clientes, Metas e Pedidos; o do promotor não tem Pedidos (RN-PRO-01)', () => {
    const v = abas('campo', 'vendedor');
    for (const a of ['Rota', 'Clientes', 'Metas', 'Pedidos']) expect(v, `vendedor: ${a}`).toContain(a);
    const p = abas('campo', 'promotor');
    for (const a of ['Rota', 'Clientes', 'Metas']) expect(p, `promotor: ${a}`).toContain(a);
    expect(p).not.toContain('Pedidos');
  });

  it.fails('D-C00b NÃO EXISTE: o promotor tem a aba Loja (trade: gôndola, share, preço, ruptura) — modules/promotor/app/index.ts exporta {}', () => {
    expect(abas('campo', 'promotor')).toContain('Loja');
  });

  it.fails('D-C00c NÃO EXISTE: a aba Catálogo (modules/catalogo/app/index.ts exporta {})', () => {
    expect(abas('campo', 'vendedor')).toContain('Catálogo');
  });

  it('D-G00: o Gestão da supervisora monta Clientes e Pedidos (o Início é do shell; T-0029 §7)', () => {
    expect(abas('gestao', 'supervisor')).toEqual(['Clientes', 'Pedidos']);
  });

  it('D-G01 (T-0029): o Gestão tem a aba Pedidos (manifesto do Vendedor com apps.gestao; páginas pedidos/pedido em [campo, gestao]); novo-pedido só no Campo', () => {
    expect(abas('gestao', 'supervisor')).toContain('Pedidos');
    expect(paginasDoFonte('vendedor').find((p) => p.id === 'novo-pedido')?.apps).toEqual(['campo']);
  });

  it.fails('D-G05 NÃO EXISTE: o Gestão tem Equipe e Aprovações (módulo gestor sem telas e não licenciado no tenant demo)', () => {
    const g = abas('gestao', 'supervisor');
    expect(g).toContain('Equipe');
    expect(g).toContain('Aprovações');
  });
});
