/**
 * O conjunto do `moduloApp` do Catálogo (T-0052) passa no `criarShell` real com o manifesto real do Core: abas, índice
 * de busca com fonte do Core (`produto`), migrações do aparelho e o slot `cliente.acoes`. Erro aqui = o app não abre.
 * As telas (React Native) não rodam no Node: as páginas entram com o mesmo id/caminho/navegação/ação de `index.ts`.
 */
import { ProdutoSyncSchema } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { criarShell, definirEntidadeSync, definirModuloShell, modulosEfetivos, type Perfil } from '@macuxi/platform-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTIDADES_CONTEUDO, ENTIDADES_PRECO } from '../contracts';
import { migracoesAparelho } from '../db/aparelho';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';
import { INDICE_BUSCA_CATALOGO } from './indice';

const PAGINAS = [
  { id: 'catalogo', caminho: 'catalogo', titulo: 'Catálogo', navegacao: 'Catálogo', icone: 'search', ordem: 60, acao: 'produto.consultar', apps: ['campo', 'gestao'] as const, componente: 'TelaCatalogo' },
  { id: 'produto', caminho: 'produto', titulo: 'Produto', acao: 'produto.consultar', apps: ['campo', 'gestao'] as const, componente: 'TelaProduto' },
];

const catalogo = definirModuloShell<string>({
  manifesto: manifest,
  paginas: PAGINAS,
  entidadesSync: [...ENTIDADES_PRECO, ...ENTIDADES_CONTEUDO],
  consultas: [consultaPrecosClienteAparelho],
  migracoesAparelho,
  indicesBusca: [INDICE_BUSCA_CATALOGO],
  extensoes: [{ slot: 'cliente.acoes', id: 'ver-catalogo', acao: 'produto.consultar', payload: { rotulo: 'Ver catálogo' } }],
});
const core = definirModuloShell<string>({ manifesto: manifestoCore, entidadesSync: [definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoSyncSchema })] });

const efetivos = (perfil: Perfil) => modulosEfetivos({ manifestos: [manifestoCore, manifest], ativosNoTenant: ['core', 'catalogo'], doPerfil: ['core', 'catalogo'].filter((m) => (m === 'core' ? manifestoCore : manifest).perfis.includes(perfil)) as never });

describe('moduloApp do Catálogo no shell (T-0052; pedidos R-20261101-155035-engenheiro-apps e R-20261031-205433-banco-dados)', () => {
  it('as páginas do teste são as mesmas do index.ts (id, caminho, navegação, ação e apps)', () => {
    const fonte = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    for (const p of PAGINAS) {
      const linha = fonte.split('\n').find((l) => l.includes(`id: '${p.id}'`))!;
      expect(linha, p.id).toContain(`caminho: '${p.caminho}'`);
      expect(linha, p.id).toContain(`acao: '${p.acao}'`);
      expect(linha, p.id).toContain("apps: ['campo', 'gestao']");
      if (p.navegacao) expect(linha, p.id).toContain(`navegacao: '${p.navegacao}'`);
    }
  });

  for (const app of ['campo', 'gestao'] as const) {
    it(`${app}: o shell monta (índice com fonte do Core, migrações, slot do Core) e a aba Catálogo aparece para todos os perfis de campo/gestão`, () => {
      const shell = criarShell(app, [core, catalogo]);
      for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente'] as const) {
        const v = shell.montar({ perfil, modulosAtivos: efetivos(perfil) });
        expect(v.navegacao.map((n) => n.rotulo), perfil).toContain('Catálogo');
        expect(v.pagina('produto'), perfil).not.toBeNull();
        expect(v.extensoes('cliente.acoes').map((e) => `${e.modulo}/${e.id}`), perfil).toEqual(['catalogo/ver-catalogo']);
      }
    });
  }

  it('RN-CORE-03: sem o Catálogo efetivo, nem aba nem atalho', () => {
    const v = criarShell('campo', [core, catalogo]).montar({ perfil: 'vendedor', modulosAtivos: ['core'] });
    expect(v.navegacao.map((n) => n.rotulo)).not.toContain('Catálogo');
    expect(v.extensoes('cliente.acoes')).toEqual([]);
  });

  it('RN-PRO-01: nenhuma página do Catálogo exige ação de pedido', () => {
    expect(PAGINAS.every((p) => !p.acao.startsWith('pedido'))).toBe(true);
  });
});
