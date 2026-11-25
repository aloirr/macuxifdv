/**
 * Menu do usuário (v1.0.34; R-20261124-083005, 083110 e 083356): identificação do botão (nome, perfil e cargo, sem repetir),
 * "Dados cadastrais" da sessão (só com linha além do botão), os erros do BKO e do portal na tabela do Core e a troca do portal
 * (modo falso: revoga a sessão do portal e a entrada mostra o aviso).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERFIS } from '@macuxi/platform-sdk';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { erroDaTrocaVoluntaria, TEXTOS_TROCAR_SENHA } from '@macuxi/core/contracts';

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
import { ErroPortal } from './portal-api';
import { responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL } from './portal-rotas';
import { corpoDaTrocaNoPortal, podeTrocarSenhaNoPortal } from './portal-senha';
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

  it('portal: time Macuxi sem cargo nem empresa; admin do cliente com o perfil, o cargo e a empresa atual', () => {
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
    // a empresa já é o título da página da empresa no portal (RD-3122)
    expect(temDadosAlemDoBotao(identidadeDoPortal({ tipo: 'admin_cliente', empresa: { nome: 'Distribuidora Uma Ltda' } }))).toBe(false);
    // no BKO a empresa conta (só perfil, cargo e empresa: a empresa é o dado novo)
    expect(temDadosAlemDoBotao(identidadeDoBko({ name: '', email: '', perfil: 'admin' }, 'Distribuidora Uma'))).toBe(true);
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

describe('portal: troca do admin do cliente (modo falso, como a API)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => vi.unstubAllGlobals());

  const entrar = async (email: string) => (await (await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'Senha#Forte2026' }, {})).json()) as SessaoPortal;
  const trocar = (s: SessaoPortal, senha_atual: string, senha_nova: string) =>
    responderFalso('POST', ROTAS_PORTAL.trocarSenha, s.empresa ? corpoDaTrocaNoPortal(s as SessaoPortal & { empresa: { codigo: string } }, { email: ' admin@uma.com.br ', senha_atual, senha_nova }) : {}, {});

  it('só o admin do cliente com empresa escolhida tem a opção; o time Macuxi não', async () => {
    expect(podeTrocarSenhaNoPortal(await entrar('time@macuxi.com.br'))).toBe(false);
    expect(podeTrocarSenhaNoPortal(await entrar('admin@duas.com.br'))).toBe(false);
    expect(podeTrocarSenhaNoPortal(await entrar('admin@uma.com.br'))).toBe(true);
  });

  it('corpo: o código da empresa da sessão e o e-mail sem espaços', async () => {
    const s = await entrar('admin@uma.com.br');
    expect(corpoDaTrocaNoPortal(s as SessaoPortal & { empresa: { codigo: string } }, { email: ' admin@uma.com.br ', senha_atual: 'a', senha_nova: 'b' })).toEqual({
      codigo_empresa: s.empresa?.codigo,
      email: 'admin@uma.com.br',
      senha_atual: 'a',
      senha_nova: 'b',
      app: 'web',
    });
  });

  it('senha atual errada = 401; fora da regra = 422 RN-CORE-32; igual = RN-CORE-34; certa = revoga a sessão do portal, sem token de renovação', async () => {
    const s = await entrar('admin@uma.com.br');
    expect((await trocar(s, 'errada', 'Nova-senha-123')).status).toBe(401);
    expect(((await (await trocar(s, 'Atual-1', 'curta')).json()) as { codigo: string }).codigo).toBe('RN-CORE-32');
    expect(((await (await trocar(s, 'Nova-senha-123', 'Nova-senha-123')).json()) as { codigo: string }).codigo).toBe('RN-CORE-34');
    const ok = await trocar(s, 'Atual-1', 'Nova-senha-123');
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain('refresh');
    expect((await responderFalso('POST', ROTAS_PORTAL.renovar, undefined, { Authorization: `Bearer ${s.token}` })).status).toBe(401);
  });

  it('o aviso "Senha trocada. Entre de novo." é aceito pela entrada (uma vez)', () => {
    guardarAvisoPortal(MENSAGEM_SENHA_TROCADA_ENTRE);
    expect(consumirAvisoPortal()).toBe(MENSAGEM_SENHA_TROCADA_ENTRE);
    expect(consumirAvisoPortal()).toBeNull();
  });
});
