import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estadoDaCaixaDoGrupo, filtrarGruposPorBusca, mudancasDaCaixaDoGrupo, niveisAcimaDoTeto } from '@macuxi/ui/web';
import { rotasDePerfisV2 } from '../../api/perfis-v2';
import type { CatalogoResposta, PerfilDetalheV2 } from '../../contracts';
import {
  alternarLinha,
  aplicarMarcacoes,
  AVISO_AUTOGESTAO,
  contarMudancas,
  copiarDoPerfil,
  corpoDoPut,
  edicaoDoDetalhe,
  ehAutogestao,
  erroDeAlvos,
  escolherNivel,
  frasesDoHistorico,
  montarGrupos,
} from './perfis-tabela';

type P = PerfilDetalheV2['permissoes'][number];
const perm = (chave: string, extra: Partial<P> = {}): P => ({ chave, concedida: false, nivel: null, alvos: null, trava: null, disponivel: true, ...extra });
const ch = (chave: string, modulo = 'core', extra: Partial<CatalogoResposta['areas'][number]['chaves'][number]> = {}) => ({ chave, descricao: `Descrição de ${chave}`, modulo, nivel: null, alvos: false, disponivel: true, motivo: null, ...extra });

const catalogo: CatalogoResposta = {
  versao: 2,
  areas: [
    { area: 'acesso', rotulo: 'Onde entra', chaves: [ch('acesso.bko'), ch('acesso.campo')] },
    { area: 'dados', rotulo: 'Dados', chaves: [ch('dados.escopo', 'core', { nivel: 'escopo' })] },
    { area: 'usuarios', rotulo: 'Usuários e perfis', chaves: [ch('perfil.gerir'), ch('usuario.criar'), ch('usuario.editar'), ch('usuario.desativar'), ch('senha.redefinir', 'core', { alvos: true })] },
    { area: 'pedidos', rotulo: 'Pedidos', chaves: [ch('pedido.ver', 'vendedor'), ch('pedido.criar', 'vendedor'), ch('pedido.cancelar', 'vendedor')] },
    { area: 'treinamento', rotulo: 'Treinamento', chaves: [ch('treinamento.ver', 'treinamento', { disponivel: false, motivo: 'MODULO_SEM_LICENCA' }), ch('treinamento.gerenciar', 'treinamento', { disponivel: false, motivo: 'MODULO_SEM_LICENCA' })] },
  ],
};
const detalhe = (cargo: PerfilDetalheV2['perfil']['cargo'], permissoes: P[], usuarios = 0, codigo = 'vendedor'): PerfilDetalheV2 => ({
  perfil: { codigo, nome: 'Vendedor', descricao: null, cargo, ativo: true, usuarios, onde_entra: ['campo'] },
  permissoes,
  teto_escopo: cargo === 'administrativo' ? 'tenant' : 'carteira',
  alvos_possiveis: [{ codigo: 'vendedor', nome: 'Vendedor', cargo: 'vendedor', onde_entra: ['campo'] }],
  modulos: ['core', 'vendedor'],
  atualizado_em: '2026-11-27T12:00:00.000Z',
});
const todas = [
  ...catalogo.areas.flatMap((a) => a.chaves.map((c) => c.chave)),
].map((c) => perm(c, c.startsWith('treinamento') ? { disponivel: false } : {}));
const comTrava = (d: PerfilDetalheV2, chave: string, mensagem: string): PerfilDetalheV2 => ({ ...d, permissoes: d.permissoes.map((p) => (p.chave === chave ? { ...p, trava: { regra: 'RN-CORE-33', mensagem } } : p)) });
const marca = (d: PerfilDetalheV2, chaves: string[], extra: Partial<P> = {}): PerfilDetalheV2 => ({ ...d, permissoes: d.permissoes.map((p) => (chaves.includes(p.chave) ? { ...p, concedida: true, ...extra } : p)) });
const grupos = (d: PerfilDetalheV2, autogestao = false, edicao = edicaoDoDetalhe(d)) => montarGrupos({ catalogo, detalhe: d, edicao, autogestao, rotuloDoCargo: 'Vendedor' });
const linha = (gs: ReturnType<typeof grupos>, id: string) => gs.flatMap((g) => g.linhas).find((l) => l.id === id)!;

describe('Perfis em tabela (ADR 0073, E5)', () => {
  it('RN-CORE-33: a trava pelo cargo leva o motivo escrito, sem código de regra, e a caixa do grupo não mexe nela', () => {
    const d = comTrava(detalhe('vendedor', todas), 'acesso.bko', 'Este cargo nunca entra no BKO nem no portal.');
    const gs = grupos(d);
    const l = linha(gs, 'acesso.bko');
    expect(l.trava).toEqual({ motivo: 'Este cargo nunca entra no BKO nem no portal.' });
    expect(l.trava?.motivo).not.toMatch(/RN-/);
    const acesso = gs.find((g) => g.id === 'acesso')!;
    const m = mudancasDaCaixaDoGrupo(acesso.linhas.map((x) => ({ id: x.id, marcada: x.marcada, travada: !!x.trava })));
    expect(m).toEqual({ 'acesso.campo': true });
  });

  it('RN-CORE-33: o cargo fica travado quando o perfil tem usuários e a trava não vai no corpo do PUT', () => {
    const d = comTrava(marca(detalhe('vendedor', todas, 3), ['acesso.campo']), 'acesso.bko', 'Este cargo nunca entra no BKO nem no portal.');
    const corpo = corpoDoPut(d, edicaoDoDetalhe(d), { nome: 'Vendedor', descricao: '', cargo: 'vendedor' });
    expect(corpo.cargo).toBeUndefined();
    expect(corpo.permissoes.map((p) => p.chave)).toEqual(['acesso.campo']);
    expect(corpo.atualizado_em).toBe('2026-11-27T12:00:00.000Z');
    const sem = detalhe('vendedor', todas, 0);
    expect(d.perfil.usuarios > 0).toBe(true);
    expect(sem.perfil.usuarios > 0).toBe(false);
  });

  it('RN-CORE-02: módulo sem licença vira grupo com a frase, desabilitado, e guarda o valor no PUT', () => {
    const d = marca(detalhe('vendedor', todas), ['treinamento.ver'], {});
    const g = grupos(d).find((x) => x.id === 'treinamento')!;
    expect(g.semLicenca?.mensagem).toBe('Ative o módulo Treinamento em Módulos para usar estas permissões.');
    expect(estadoDaCaixaDoGrupo(g.linhas.map((l) => ({ id: l.id, marcada: l.marcada })), true)).toBe('sem-livres');
    expect(mudancasDaCaixaDoGrupo(g.linhas.map((l) => ({ id: l.id, marcada: l.marcada })), true)).toEqual({});
    expect(corpoDoPut(d, edicaoDoDetalhe(d), { nome: 'V', descricao: '', cargo: 'vendedor' }).permissoes.map((p) => p.chave)).toContain('treinamento.ver');
  });

  it('RN-CORE-35: a autogestão trava as 5 chaves da gestão do acesso sem motivo na linha e o aviso é um só', () => {
    const chaves = ['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
    const d = marca(detalhe('administrativo', todas, 1, 'admin'), chaves);
    expect(ehAutogestao(d, 'admin')).toBe(true);
    expect(ehAutogestao(d, 'outro')).toBe(false);
    const gs = grupos(d, true);
    for (const c of chaves) expect(linha(gs, c).trava).toEqual({});
    expect(linha(gs, 'senha.redefinir').trava).toBeNull();
    expect(gs.flatMap((g) => g.linhas).filter((l) => l.trava?.motivo)).toHaveLength(0);
    expect(AVISO_AUTOGESTAO).not.toMatch(/RN-|chave|tenant/i);
    // sem a gestão completa, não é autogestão
    expect(ehAutogestao(marca(detalhe('administrativo', todas, 1, 'admin'), ['perfil.gerir']), 'admin')).toBe(false);
  });

  it('caixa do grupo: tri-estado, liga só as livres e desliga quando todas as livres estão ligadas', () => {
    const d = detalhe('vendedor', todas);
    let e = edicaoDoDetalhe(d);
    const pedidos = () => grupos(d, false, e).find((g) => g.id === 'pedidos')!;
    const est = () => pedidos().linhas.map((l) => ({ id: l.id, marcada: l.marcada, travada: !!l.trava }));
    expect(estadoDaCaixaDoGrupo(est())).toBe('nenhuma');
    e = alternarLinha(e, { id: 'pedido.ver', tipo: 'caixa' }, true);
    expect(estadoDaCaixaDoGrupo(est())).toBe('parte');
    e = aplicarMarcacoes(e, pedidos().linhas, mudancasDaCaixaDoGrupo(est()));
    expect(estadoDaCaixaDoGrupo(est())).toBe('todas');
    e = aplicarMarcacoes(e, pedidos().linhas, mudancasDaCaixaDoGrupo(est()));
    expect(estadoDaCaixaDoGrupo(est())).toBe('nenhuma');
  });

  it('RN-CORE-04: o escopo acima do teto do cargo leva cadeado e o motivo escrito', () => {
    const d = marca(detalhe('vendedor', todas), ['dados.escopo'], { nivel: 'carteira' });
    const l = linha(grupos(d), 'dados.escopo');
    expect(l.teto).toBe('carteira');
    expect(l.motivoTeto).toBe('O cargo Vendedor vai até "Carteira própria".');
    expect([...niveisAcimaDoTeto(l.niveis!, l.teto)]).toEqual(['equipe', 'equipes_abaixo', 'tenant']);
    expect(corpoDoPut(d, escolherNivel(edicaoDoDetalhe(d), 'dados.escopo', 'carteira'), { nome: 'V', descricao: '', cargo: 'vendedor' }).permissoes.find((p) => p.chave === 'dados.escopo')?.nivel).toBe('carteira');
    expect(grupos(d).find((g) => g.id === 'dados')?.semCaixa).toBe(true);
  });

  it('RN-PRO-01: o promotor não cria nem altera pedido (cadeado do cargo, fora do PUT e fora da cópia)', () => {
    const msg = 'Perfil de promotor nunca cria, edita, cancela, exclui ou aprova pedido.';
    let d = detalhe('promotor', todas, 0, 'promotor');
    for (const c of ['pedido.criar', 'pedido.cancelar']) d = comTrava(d, c, msg);
    d = marca(d, ['pedido.ver']);
    const gs = grupos(d);
    expect(linha(gs, 'pedido.criar').trava?.motivo).toBe(msg);
    expect(linha(gs, 'pedido.cancelar').trava?.motivo).toBe(msg);
    expect(linha(gs, 'pedido.ver').trava).toBeNull();
    const origem = marca(detalhe('vendedor', todas), ['pedido.ver', 'pedido.criar', 'pedido.cancelar']);
    const copiado = copiarDoPerfil(edicaoDoDetalhe(d), gs, origem, 'carteira');
    expect(copiado['pedido.criar']?.concedida).toBe(false);
    expect(copiado['pedido.ver']?.concedida).toBe(true);
    const forcado = { ...copiado, 'pedido.criar': { concedida: true, nivel: null, alvos: null } };
    expect(corpoDoPut(d, forcado, { nome: 'P', descricao: '', cargo: 'promotor' }).permissoes.map((p) => p.chave)).not.toContain('pedido.criar');
  });

  it('RN-CORE-34: ligar a redefinição de senha sem nenhum perfil bloqueia o salvar com a frase da linha', () => {
    const d = detalhe('administrativo', todas, 0, 'admin');
    const e = alternarLinha(edicaoDoDetalhe(d), { id: 'senha.redefinir', tipo: 'alvos' }, true);
    expect(erroDeAlvos({ id: 'senha.redefinir', tipo: 'alvos', marcada: true }, e)).toBe('Marque pelo menos um perfil ou desligue esta permissão.');
    expect(erroDeAlvos({ id: 'senha.redefinir', tipo: 'alvos', marcada: true }, { ...e, 'senha.redefinir': { concedida: true, nivel: null, alvos: ['*'] } })).toBeNull();
  });

  it('a busca acha pelo nome da linha e do grupo, sem acento', () => {
    const ks = grupos(detalhe('vendedor', todas)).map((g) => ({ id: g.id, titulo: g.titulo, linhas: g.linhas }));
    expect(filtrarGruposPorBusca(ks, 'usuarios').map((g) => g.id)).toEqual(['usuarios']);
    expect(filtrarGruposPorBusca(ks, 'zzz')).toEqual([]);
  });

  it('conta as mudanças não salvas e escreve o histórico sem chave nem JSON', () => {
    const d = detalhe('vendedor', todas);
    const e = alternarLinha(edicaoDoDetalhe(d), { id: 'pedido.ver', tipo: 'caixa' }, true);
    const ident = { nome: 'Vendedor', descricao: '', cargo: 'vendedor' };
    expect(contarMudancas(edicaoDoDetalhe(d), e, ident, ident)).toBe(1);
    expect(contarMudancas(edicaoDoDetalhe(d), e, ident, { ...ident, nome: 'Outro' })).toBe(2);
    const f = frasesDoHistorico({ permissoes: {} }, { permissoes: { 'pedido.ver': {} } }, () => 'Ver pedidos');
    expect(f).toEqual(['Ver pedidos: ligada']);
  });

  it('RN-CORE-35: só quem tem perfil.gerir cria e edita perfis (rotas da API e a página)', () => {
    const escrita = rotasDePerfisV2.filter((r) => r.metodo !== 'GET');
    expect(escrita.length).toBeGreaterThanOrEqual(3);
    for (const r of escrita) expect(r.acao).toBe('perfil.gerir');
    for (const r of rotasDePerfisV2.filter((x) => x.caminho !== 'perfis/opcoes')) expect(r.acao).toBe('perfil.gerir');
    const pagina = readFileSync(new URL('../components/perfis/perfis-page.tsx', import.meta.url), 'utf8');
    expect(pagina).toContain("usePode('perfil.gerir')");
    expect(pagina).toMatch(/if \(!podeGerir\) return <Notice/);
  });

  it('o cabeçalho usa o cadeado do kit para o cargo e nunca o emoji', () => {
    const src = readFileSync(new URL('../components/perfis/cabecalho-perfil.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<IconLock size={13} className="shrink-0" />');
    expect(src).not.toContain('🔒');
  });
});
