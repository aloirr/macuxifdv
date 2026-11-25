/**
 * Menu do usuário (v1.0.34; R-20261124-083005, 083110 e 083356): identificação do botão (nome, perfil e cargo, sem repetir),
 * "Dados cadastrais" da sessão (só com linha além do botão), os erros do BKO e do portal na tabela do Core e a troca do portal
 * (modo falso: o time Macuxi pela rota do portal, ADR 0075; o admin do cliente pela rota pública do Core; a sessão do portal cai e
 * a entrada mostra o aviso).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERFIS } from '@macuxi/platform-sdk';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { CODIGOS_PORTAL, erroDaTrocaVoluntaria, TEXTOS_TROCAR_SENHA } from '@macuxi/core/contracts';

import {
  erroNoFormatoDoCore,
  identidadeDoBko,
  identidadeDoPortal,
  identificacaoDoBotao,
  iniciais,
  linhasDosDados,
  PERFIL_TIME_MACUXI,
  rotuloDoCargo,
  temDadosAlemDoBotao,
} from './menu-usuario';
import { ErroPortal, lerErroDaApi } from './portal-api';
import { responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL, ROTAS_PUBLICAS_PORTAL } from './portal-rotas';
import { corpoDaTrocaNoPortal, erroDaTrocaNoPortal, podeTrocarSenhaNoPortal, TEXTOS_TROCA_PORTAL } from './portal-senha';
import { consumirAvisoPortal, guardarAvisoPortal, MENSAGEM_SENHA_TROCADA_ENTRE, type SessaoPortal } from './portal-sessao';

const usuario = (perfil: (typeof PERFIS)[number] | null, nome = 'Ana Souza') => ({ name: nome, email: 'ana@uma.com.br', perfil, empresa: 'Distribuidora Uma' });

describe('identificação de quem entrou', () => {
  it('cargo exato nos 7 perfis base (ADR 0049)', () => {
    expect(Object.fromEntries(PERFIS.map((p) => [p, rotuloDoCargo(p)]))).toEqual({
      vendedor: 'Vendedor',
      promotor: 'Promotor',
      supervisor: 'Supervisor',
      gerente: 'Gerente',
      analista: 'Administrativo',
      assistente: 'Administrativo',
      admin: 'Administrativo',
    });
  });

  it('BKO: nome no título; perfil e cargo embaixo; cargo igual ao perfil aparece uma vez', () => {
    expect(identificacaoDoBotao(identidadeDoBko(usuario('admin'), 'Distribuidora Uma'))).toEqual({ titulo: 'Ana Souza', detalhe: 'Admin · Administrativo' });
    expect(identificacaoDoBotao(identidadeDoBko(usuario('supervisor'), null))).toEqual({ titulo: 'Ana Souza', detalhe: 'Supervisor' });
    expect(identificacaoDoBotao(identidadeDoBko(usuario(null), null))).toEqual({ titulo: 'Ana Souza', detalhe: null });
  });

  it('portal sem o nome (API anterior à 0102): time Macuxi sem cargo nem empresa; admin do cliente com o perfil, o cargo e a empresa', () => {
    const time = identidadeDoPortal({ tipo: 'super_admin', empresa: null });
    expect(identificacaoDoBotao(time)).toEqual({ titulo: PERFIL_TIME_MACUXI, detalhe: null });
    const admin = identidadeDoPortal({ tipo: 'admin_cliente', empresa: { nome: 'Distribuidora Uma Ltda' } });
    expect(identificacaoDoBotao(admin)).toEqual({ titulo: 'Admin', detalhe: 'Administrativo' });
    expect(linhasDosDados(admin).map((l) => [l.rotulo, l.valor])).toEqual([
      ['Perfil', 'Admin'],
      ['Cargo', 'Administrativo'],
      ['Empresa', 'Distribuidora Uma Ltda'],
    ]);
  });

  it('portal com o nome (ADR 0075): o time Macuxi mostra o nome e "Time Macuxi"; o admin do cliente, o perfil e o cargo da empresa', () => {
    const time = identidadeDoPortal({ tipo: 'super_admin', empresa: null, usuario: { nome: 'Carla Menezes', perfil: null, cargo: null } });
    expect(identificacaoDoBotao(time)).toEqual({ titulo: 'Carla Menezes', detalhe: PERFIL_TIME_MACUXI });
    // nome e perfil já estão no botão: "Dados cadastrais" repetiria
    expect(temDadosAlemDoBotao(time)).toBe(false);
    const admin = identidadeDoPortal({ tipo: 'admin_cliente', empresa: { nome: 'Distribuidora Uma Ltda' }, usuario: { nome: 'Paulo Ribeiro', perfil: 'Administrador', cargo: 'administrativo' } });
    expect(identificacaoDoBotao(admin)).toEqual({ titulo: 'Paulo Ribeiro', detalhe: 'Administrador · Administrativo' });
    expect(linhasDosDados(admin).map((l) => l.chave)).toEqual(['nome', 'perfil', 'cargo', 'empresa']);
    expect(temDadosAlemDoBotao(admin)).toBe(true);
    // admin sem vínculo de perfil (sa_quem_sou com perfil e cargo nulos): só o nome
    const semPerfil = identidadeDoPortal({ tipo: 'admin_cliente', empresa: { nome: 'Uma' }, usuario: { nome: 'Paulo Ribeiro', perfil: null, cargo: null } });
    expect(identificacaoDoBotao(semPerfil)).toEqual({ titulo: 'Paulo Ribeiro', detalhe: 'Admin' });
  });

  it('Dados cadastrais do BKO: nome, e-mail, perfil, cargo e empresa, nessa ordem', () => {
    expect(linhasDosDados(identidadeDoBko(usuario('gerente'), 'Distribuidora Uma')).map((l) => l.chave)).toEqual(['nome', 'email', 'perfil', 'cargo', 'empresa']);
  });

  it('iniciais: primeira e última palavra', () => {
    expect(iniciais('Ana Maria Souza')).toBe('AS');
    expect(iniciais('Time Macuxi')).toBe('TM');
    expect(iniciais('administrador')).toBe('A');
  });

  it('"Dados cadastrais" só com linha além do botão: o time Macuxi (só o perfil) não tem; BKO e admin do cliente têm', () => {
    expect(temDadosAlemDoBotao(identidadeDoPortal({ tipo: 'super_admin', empresa: null }))).toBe(false);
    expect(temDadosAlemDoBotao(identidadeDoPortal({ tipo: 'admin_cliente', empresa: { nome: 'Distribuidora Uma Ltda' } }))).toBe(true);
    expect(temDadosAlemDoBotao(identidadeDoBko(usuario('vendedor'), null))).toBe(true);
  });
});

describe('troca voluntária: erros do BKO (code) e do portal (codigo) na tabela do Core', () => {
  it('mesma resposta para os dois formatos, com os textos do login', () => {
    for (const e of [new ApiRequestError(401, 'CREDENCIAIS_INVALIDAS', 'x'), new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'x')]) {
      expect(erroDaTrocaVoluntaria(erroNoFormatoDoCore(e), 'Nova-senha-123')).toEqual({ texto: TEXTOS_TROCAR_SENHA.atualErrada, tom: 'danger', acao: 'limpar_atual' });
    }
    const muitas = [new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 120 }), new ErroPortal(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 120 })];
    const [bko, portal] = muitas.map((e) => erroDaTrocaVoluntaria(erroNoFormatoDoCore(e), 'a').texto);
    expect(bko).toBe(portal);
    expect(bko).toMatch(/2 minutos/);
    expect(erroDaTrocaVoluntaria(erroNoFormatoDoCore(new ApiRequestError(0, 'network', 'x')), 'a')).toEqual({ texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning', acao: 'ficar' });
    expect(erroDaTrocaVoluntaria(erroNoFormatoDoCore(new ApiRequestError(500, 'INTERNO', '{"stack":1}')), 'a').texto).toBe(TEXTOS_TROCAR_SENHA.outro);
  });
});

class Memoria implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('portal: troca da própria senha (modo falso, como a API)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => vi.unstubAllGlobals());

  const entrar = async (email: string) => (await (await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'Senha#Forte2026' }, {})).json()) as SessaoPortal;
  /** Time Macuxi: rota do portal com o token (ADR 0075). */
  const trocarSuper = (s: SessaoPortal, senha_atual: string, senha_nova: string) => responderFalso('POST', ROTAS_PORTAL.trocarSenhaSuperAdmin, { senha_atual, senha_nova }, { Authorization: `Bearer ${s.token}` });
  /** Admin do cliente: rota pública do Core, sem token, com o código da empresa e o e-mail digitado. */
  const trocarAdmin = (s: SessaoPortal, senha_atual: string, senha_nova: string) =>
    responderFalso('POST', ROTAS_PORTAL.trocarSenha, corpoDaTrocaNoPortal(s as SessaoPortal & { empresa: { codigo: string } }, { email: ' admin@uma.com.br ', senha_atual, senha_nova }), {});
  const codigo = async (r: Response) => ((await r.json()) as { codigo: string }).codigo;

  it('time Macuxi pela rota do portal (com token); admin do cliente pela rota pública do Core; admin sem empresa escolhida não tem a opção', async () => {
    expect(ROTAS_PORTAL.trocarSenhaSuperAdmin).toBe('/plataforma/auth/senha');
    expect(ROTAS_PUBLICAS_PORTAL).not.toContain(ROTAS_PORTAL.trocarSenhaSuperAdmin);
    expect(ROTAS_PORTAL.trocarSenha).toBe('/auth/senha/trocar');
    expect(ROTAS_PUBLICAS_PORTAL).toContain(ROTAS_PORTAL.trocarSenha);
    expect(podeTrocarSenhaNoPortal(await entrar('time@macuxi.com.br'))).toBe(true);
    expect(podeTrocarSenhaNoPortal(await entrar('admin@uma.com.br'))).toBe(true);
    expect(podeTrocarSenhaNoPortal(await entrar('admin@duas.com.br'))).toBe(false);
  });

  it('a sessão traz o nome: o time Macuxi sem perfil; o admin com o perfil e o cargo da empresa; sem empresa, sem usuario', async () => {
    expect((await entrar('time@macuxi.com.br')).usuario).toEqual({ nome: 'Carla Menezes', perfil: null, cargo: null });
    expect((await entrar('admin@uma.com.br')).usuario).toEqual({ nome: 'Paulo Ribeiro', perfil: 'Administrador', cargo: 'administrativo' });
    expect((await entrar('admin@duas.com.br')).usuario).toBeNull();
  });

  it('time Macuxi: 401 senha atual errada, 422 RN-CORE-32 e RN-CORE-34, 409 SENHA_MUDOU; 204 derruba a sessão', async () => {
    const s = await entrar('time@macuxi.com.br');
    expect((await trocarSuper(s, 'errada', 'Nova-senha-123')).status).toBe(401);
    expect(await codigo(await trocarSuper(s, 'Atual-1', 'curta'))).toBe('RN-CORE-32');
    expect(await codigo(await trocarSuper(s, 'Nova-senha-123', 'Nova-senha-123'))).toBe('RN-CORE-34');
    expect(await codigo(await trocarSuper(s, 'mudou', 'Nova-senha-123'))).toBe('SENHA_MUDOU');
    expect((await trocarSuper(s, 'Atual-1', 'Nova-senha-123')).status).toBe(204);
    expect((await responderFalso('POST', ROTAS_PORTAL.renovar, undefined, { Authorization: `Bearer ${s.token}` })).status).toBe(401);
  });

  it('a rota do portal recusa o admin do cliente: 403 TROCA_SO_SUPER_ADMIN', async () => {
    const s = await entrar('admin@uma.com.br');
    expect(await codigo(await trocarSuper(s, 'Atual-1', 'Nova-senha-123'))).toBe(CODIGOS_PORTAL.trocaSoSuperAdmin);
  });

  it('time Macuxi: 5 senhas atuais erradas = 423 BLOQUEADO com os minutos', async () => {
    const s = await entrar('time@macuxi.com.br');
    for (let i = 0; i < 5; i++) await trocarSuper(s, 'errada', 'Nova-senha-123');
    const r = await trocarSuper(s, 'Atual-1', 'Nova-senha-123');
    expect(r.status).toBe(423);
    expect(erroDaTrocaNoPortal(lerErroDaApi(423, await r.json())).texto).toBe('Muitas tentativas. Tente de novo em 15 minutos.');
  });

  it('admin do cliente, corpo: o código da empresa da sessão e o e-mail sem espaços', async () => {
    const s = await entrar('admin@uma.com.br');
    expect(corpoDaTrocaNoPortal(s as SessaoPortal & { empresa: { codigo: string } }, { email: ' admin@uma.com.br ', senha_atual: 'a', senha_nova: 'b' })).toEqual({
      codigo_empresa: s.empresa?.codigo,
      email: 'admin@uma.com.br',
      senha_atual: 'a',
      senha_nova: 'b',
      app: 'web',
    });
  });

  it('admin do cliente: senha atual errada = 401; fora da regra = 422 RN-CORE-32; igual = RN-CORE-34; certa = revoga a sessão do portal, sem token de renovação', async () => {
    const s = await entrar('admin@uma.com.br');
    expect((await trocarAdmin(s, 'errada', 'Nova-senha-123')).status).toBe(401);
    expect(await codigo(await trocarAdmin(s, 'Atual-1', 'curta'))).toBe('RN-CORE-32');
    expect(await codigo(await trocarAdmin(s, 'Nova-senha-123', 'Nova-senha-123'))).toBe('RN-CORE-34');
    const ok = await trocarAdmin(s, 'Atual-1', 'Nova-senha-123');
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain('refresh');
    expect((await responderFalso('POST', ROTAS_PORTAL.renovar, undefined, { Authorization: `Bearer ${s.token}` })).status).toBe(401);
  });

  it('erros na gaveta: os da rota do portal (423, 409, 403 com a mensagem da API) e, no resto, a tabela do Core', () => {
    expect(erroDaTrocaNoPortal(new ErroPortal(423, 'BLOQUEADO', 'x', { minutos_restantes: 3 }))).toEqual({ texto: 'Muitas tentativas. Tente de novo em 3 minutos.', tom: 'danger', acao: 'ficar' });
    expect(erroDaTrocaNoPortal(new ErroPortal(409, CODIGOS_PORTAL.senhaMudou, 'x'))).toEqual({ texto: TEXTOS_TROCA_PORTAL.senhaMudou, tom: 'danger', acao: 'ficar' });
    expect(erroDaTrocaNoPortal(new ErroPortal(403, CODIGOS_PORTAL.trocaSoSuperAdmin, 'Texto do Core.'))).toEqual({ texto: 'Texto do Core.', tom: 'danger', acao: 'ficar' });
    expect(erroDaTrocaNoPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'x'))).toEqual({ texto: TEXTOS_TROCAR_SENHA.atualErrada, tom: 'danger', acao: 'limpar_atual' });
    expect(erroDaTrocaNoPortal(new ErroPortal(422, 'RN-CORE-34', 'x'))).toEqual({ texto: TEXTOS_TROCAR_SENHA.igualAAtual, tom: 'danger', acao: 'limpar_novas' });
    expect(erroDaTrocaNoPortal(new ErroPortal(422, 'RN-CORE-32', 'x', { faltas: ['maiuscula'] }), 'nova-senha-123').acao).toBe('destacar');
  });

  it('o aviso "Senha trocada. Entre de novo." é aceito pela entrada (uma vez)', () => {
    expect(MENSAGEM_SENHA_TROCADA_ENTRE).toBe('Senha trocada. Entre de novo.');
    guardarAvisoPortal(MENSAGEM_SENHA_TROCADA_ENTRE);
    expect(consumirAvisoPortal()).toBe(MENSAGEM_SENHA_TROCADA_ENTRE);
    expect(consumirAvisoPortal()).toBeNull();
  });
});
