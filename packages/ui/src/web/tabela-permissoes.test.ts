import { describe, expect, it } from 'vitest';
import { contraste } from '../comum/contraste';
import {
  ariaCheckedDaCaixa,
  CaixaMarcar,
  contagemDoGrupo,
  CORES_CAIXA,
  estadoDaCaixaDoGrupo,
  filtrarGruposPorBusca,
  LinhaPermissao,
  mudancasDaCaixaDoGrupo,
  niveisAcimaDoTeto,
  normalizarBusca,
  textoDaContagem,
  textoDoTeto,
  textoSemLicenca,
  type EstadoDaLinha,
} from './tabela-permissoes';

type No = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function nos(x: unknown): No[] {
  if (Array.isArray(x)) return x.flatMap(nos);
  if (!x || typeof x !== 'object' || !('props' in x)) return [];
  const n = x as No;
  if (typeof n.type === 'function') return [n, ...nos((n.type as (p: unknown) => unknown)(n.props))];
  return [n, ...nos(n.props.children)];
}
const nada = () => undefined;

// "Onde entra" do Vendedor na simulação: só o app Campo é livre
const ondeEntra: EstadoDaLinha[] = [
  { id: 'bko', marcada: false, travada: true },
  { id: 'campo', marcada: true },
  { id: 'gestao', marcada: false, travada: true },
  { id: 'portal', marcada: false, travada: true },
];

describe('contagem do grupo', () => {
  it('conta todas as linhas, livres ou não ("1 de 4 ligadas")', () => {
    const c = contagemDoGrupo(ondeEntra);
    expect(c).toEqual({ ligadas: 1, total: 4 });
    expect(textoDaContagem(c.ligadas, c.total)).toBe('1 de 4 ligadas');
  });
  it('travada marcada também conta', () => {
    expect(contagemDoGrupo([{ id: 'a', marcada: true, travada: true }, { id: 'b', marcada: false }])).toEqual({ ligadas: 1, total: 2 });
  });
});

describe('tri-estado da caixa do grupo', () => {
  it('olha só as livres: todas, nenhuma, parte', () => {
    expect(estadoDaCaixaDoGrupo(ondeEntra)).toBe('todas');
    expect(estadoDaCaixaDoGrupo([{ id: 'a', marcada: false }, { id: 'b', marcada: false }, { id: 'c', marcada: true, travada: true }])).toBe('nenhuma');
    expect(estadoDaCaixaDoGrupo([{ id: 'a', marcada: true }, { id: 'b', marcada: false }])).toBe('parte');
  });
  it('sem livres (tudo travado ou sem licença) fica desabilitada', () => {
    expect(estadoDaCaixaDoGrupo([{ id: 'a', marcada: true, travada: true }])).toBe('sem-livres');
    expect(estadoDaCaixaDoGrupo([{ id: 'a', marcada: true }], true)).toBe('sem-livres');
    expect(estadoDaCaixaDoGrupo([{ id: 'a', marcada: true, semLicenca: true }])).toBe('sem-livres');
    expect(estadoDaCaixaDoGrupo([])).toBe('sem-livres');
  });
  it('aria-checked: true, false e "mixed"', () => {
    expect(ariaCheckedDaCaixa('todas')).toBe(true);
    expect(ariaCheckedDaCaixa('nenhuma')).toBe(false);
    expect(ariaCheckedDaCaixa('parte')).toBe('mixed');
    expect(ariaCheckedDaCaixa('sem-livres')).toBe(false);
  });
});

describe('clique na caixa do grupo', () => {
  it('parte ou nenhuma: liga só as livres desligadas, sem mexer nas travadas', () => {
    const linhas: EstadoDaLinha[] = [{ id: 'a', marcada: true }, { id: 'b', marcada: false }, { id: 'c', marcada: false, travada: true }];
    expect(mudancasDaCaixaDoGrupo(linhas)).toEqual({ b: true });
  });
  it('todas: desliga as livres e deixa a travada marcada como está', () => {
    const linhas: EstadoDaLinha[] = [{ id: 'a', marcada: true }, { id: 'b', marcada: true }, { id: 'c', marcada: true, travada: true }];
    expect(mudancasDaCaixaDoGrupo(linhas)).toEqual({ a: false, b: false });
  });
  it('sem licença ou sem livres: nada muda', () => {
    expect(mudancasDaCaixaDoGrupo([{ id: 'a', marcada: false }], true)).toEqual({});
    expect(mudancasDaCaixaDoGrupo(ondeEntra.filter((l) => l.travada))).toEqual({});
  });
});

describe('busca', () => {
  const grupos = [
    { id: 'pedidos', titulo: 'Pedidos', linhas: [{ rotulo: 'Ver pedidos' }, { rotulo: 'Aprovar pedidos' }] },
    { id: 'usuarios', titulo: 'Usuários e perfis', linhas: [{ rotulo: 'Gerenciar perfis' }, { rotulo: 'Criar usuários' }] },
  ];
  it('sem acento e sem caixa', () => {
    expect(normalizarBusca('  Permissão ')).toBe('permissao');
    expect(filtrarGruposPorBusca(grupos, 'USUARIOS').map((g) => g.id)).toEqual(['usuarios']);
  });
  it('título que casa mantém o grupo inteiro; senão, só as linhas que casam', () => {
    expect(filtrarGruposPorBusca(grupos, 'usuários')[0]?.linhas).toHaveLength(2);
    const r = filtrarGruposPorBusca(grupos, 'aprovar');
    expect(r).toHaveLength(1);
    expect(r[0]?.linhas.map((l) => l.rotulo)).toEqual(['Aprovar pedidos']);
  });
  it('vazia devolve tudo; sem resultado devolve nenhum grupo', () => {
    expect(filtrarGruposPorBusca(grupos, ' ')).toHaveLength(2);
    expect(filtrarGruposPorBusca(grupos, 'xyz')).toEqual([]);
  });
});

describe('escopo e textos', () => {
  const niveis = [
    { valor: 'carteira', rotulo: 'Carteira própria' },
    { valor: 'equipe', rotulo: 'Equipe' },
    { valor: 'abaixo', rotulo: 'Equipes abaixo' },
    { valor: 'empresa', rotulo: 'Toda a empresa' },
  ];
  it('os níveis depois do teto ficam com cadeado', () => {
    expect([...niveisAcimaDoTeto(niveis, 'carteira')]).toEqual(['equipe', 'abaixo', 'empresa']);
    expect(niveisAcimaDoTeto(niveis, 'empresa').size).toBe(0);
    expect(niveisAcimaDoTeto(niveis, null).size).toBe(0);
  });
  it('motivos sem código de regra', () => {
    expect(textoDoTeto('Vendedor', 'Carteira própria')).toBe('O cargo Vendedor vai até "Carteira própria".');
    expect(textoSemLicenca('Treinamento')).toBe('Ative o módulo Treinamento em Módulos para usar estas permissões.');
  });
});

describe('caixa e linha', () => {
  it('✓ branco na travada marcada passa de 3:1 (a marcada normal também)', () => {
    expect(contraste(CORES_CAIXA.check, CORES_CAIXA.travadaMarcada)).toBeGreaterThanOrEqual(3.5);
    expect(contraste(CORES_CAIXA.check, CORES_CAIXA.marcada)).toBeGreaterThanOrEqual(4.5);
  });
  it('caixa do grupo em parte: role checkbox com aria-checked="mixed"', () => {
    const b = CaixaMarcar({ estado: 'mixed', onAlternar: nada, rotulo: 'Todas de Pedidos' }) as unknown as No;
    expect(b.props.role).toBe('checkbox');
    expect(b.props['aria-checked']).toBe('mixed');
    expect(b.props['data-estado']).toBe('parte');
  });
  it('linha travada: caixa focável com aria-disabled, clique sem efeito e motivo como descrição', () => {
    let chamou = false;
    const a = nos(LinhaPermissao({ id: 'bko', rotulo: 'Entrar no backoffice', marcada: false, onAlternar: () => (chamou = true), trava: { motivo: 'Vendedor nunca entra no BKO' } }));
    const caixa = a.find((n) => n.props['data-testid'] === 'permissao.bko.caixa')!;
    expect(caixa.props['aria-disabled']).toBe(true);
    expect(caixa.props['aria-describedby']).toBe('bko-motivo');
    (caixa.props.onClick as () => void)();
    expect(chamou).toBe(false);
  });
  it('linha livre: clique inverte o valor', () => {
    let valor: boolean | null = null;
    const a = nos(LinhaPermissao({ id: 'campo', rotulo: 'Entrar no app Campo', marcada: true, onAlternar: (v) => (valor = v) }));
    (a.find((n) => n.props['data-testid'] === 'permissao.campo.caixa')!.props.onClick as () => void)();
    expect(valor).toBe(false);
  });
});
