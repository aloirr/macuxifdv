/**
 * T-0094 fatia S (R-20261108-005744): "Redefinir senha" do admin da empresa no portal, só para o time da Macuxi. Partes puras
 * (`lib/portal-admins.ts`) e o fluxo no modo falso (`lib/portal-falso.ts`), contra os schemas do SDK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListaAdminsDaEmpresaSchema, RedefinirSenhaAdminRespostaSchema, SessaoPortalSchema, type AdminDaEmpresa } from '@macuxi/platform-sdk';

import { acaoDoErro, etiquetasDoAdmin, podeRedefinir, textoDoResultado, TEXTOS_ADMINS, tituloDoDialogo } from './portal-admins';
import { ErroPortal, MENSAGEM_SEM_CONEXAO } from './portal-api';
import { responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL } from './portal-rotas';

// hora-fixa-ok: AGORA só é comparado com instantes fixos deste teste (etiquetas), nunca com o relógio real
const AGORA = Date.parse('2026-11-08T12:00:00Z');
const admin = (x: Partial<AdminDaEmpresa> = {}): AdminDaEmpresa => ({
  usuario_id: '5d1e2c0a-7b3f-4a51-8c2d-000000000001',
  nome: 'Ana Souza',
  email: 'ana@uma.com.br',
  ativo: true,
  bloqueado: false,
  tem_senha: true,
  trocar_senha: false,
  senha_expira_em: null,
  ...x,
});

describe('rotas', () => {
  it('tenant e usuário no caminho, sem x-macuxi-tenant', () => {
    expect(ROTAS_PORTAL.adminsDaEmpresa('t1')).toBe('/plataforma/empresas/t1/admins');
    expect(ROTAS_PORTAL.redefinirSenhaAdmin('t1', 'u1')).toBe('/plataforma/empresas/t1/admins/u1/redefinir-senha');
  });
});

describe('partes puras', () => {
  it('só admin ativo e não bloqueado pode ser redefinido (também com troca pendente ou vencida)', () => {
    expect(podeRedefinir(admin())).toBe(true);
    expect(podeRedefinir(admin({ trocar_senha: true, senha_expira_em: '2026-11-01T00:00:00Z' }))).toBe(true);
    expect(podeRedefinir(admin({ bloqueado: true }))).toBe(false);
    expect(podeRedefinir(admin({ ativo: false }))).toBe(false);
  });

  it('etiquetas com texto e tom da spec (ciclo-de-senha §5), no fuso da empresa', () => {
    expect(etiquetasDoAdmin(admin(), AGORA)).toEqual([]);
    expect(etiquetasDoAdmin(admin({ trocar_senha: true, senha_expira_em: '2026-11-09T18:30:00Z' }), AGORA, 'America/Manaus')).toEqual([
      { texto: 'Troca de senha pendente · vence em 09/11 às 14:30', tom: 'warning' },
    ]);
    expect(etiquetasDoAdmin(admin({ trocar_senha: true, senha_expira_em: '2026-11-07T18:30:00Z' }), AGORA)).toEqual([{ texto: 'Senha temporária vencida', tom: 'danger' }]);
    expect(etiquetasDoAdmin(admin({ trocar_senha: true }), AGORA)).toEqual([{ texto: 'Troca de senha pendente', tom: 'warning' }]);
    expect(etiquetasDoAdmin(admin({ tem_senha: false }), AGORA)).toEqual([{ texto: 'Sem senha', tom: 'neutral' }]);
    expect(etiquetasDoAdmin(admin({ bloqueado: true, ativo: false }), AGORA).map((e) => e.texto)).toEqual(['Inativo', 'Bloqueado']);
  });

  it('diálogo e resultado: e-mail, 72 h e a validade no fuso; nunca a senha', () => {
    expect(tituloDoDialogo('Ana Souza')).toBe('Redefinir a senha de Ana Souza?');
    expect(TEXTOS_ADMINS.dialogoTexto('ana@uma.com.br')).toContain('ana@uma.com.br');
    expect(TEXTOS_ADMINS.dialogoTexto('x@y.com')).toMatch(/72 horas/);
    expect(textoDoResultado('ana@uma.com.br', { senha_expira_em: '2026-11-11T16:00:00Z' }, 'America/Manaus')).toBe(
      'Senha nova enviada por e-mail para ana@uma.com.br; vale 72 h (até 11/11 às 12:00).',
    );
  });

  it('erros da API: o que a tela faz', () => {
    const e = (status: number, codigo: string) => new ErroPortal(status, codigo, 'texto da API');
    expect(acaoDoErro(e(503, 'EMAIL_INDISPONIVEL'))).toEqual({ mensagem: TEXTOS_ADMINS.semEmail, recarregar: false, novoId: false, fechar: false });
    expect(acaoDoErro(e(409, 'ADMIN_ALTERADO'))).toMatchObject({ recarregar: true, novoId: true, fechar: true });
    expect(acaoDoErro(e(404, 'USUARIO_NAO_ENCONTRADO'))).toMatchObject({ mensagem: TEXTOS_ADMINS.naoEncontrado, recarregar: true, fechar: true });
    expect(acaoDoErro(e(409, 'PEDIDO_REPETIDO_DIFERENTE'))).toMatchObject({ novoId: true, fechar: false });
    expect(acaoDoErro(e(403, 'PERFIL_SEM_ACESSO'))).toMatchObject({ mensagem: TEXTOS_ADMINS.semAcesso, fechar: true });
    // sem rede: mesmo email_id na nova tentativa (idempotente)
    expect(acaoDoErro(new ErroPortal(0, 'sem_conexao', MENSAGEM_SEM_CONEXAO))).toEqual({ mensagem: MENSAGEM_SEM_CONEXAO, recarregar: false, novoId: false, fechar: false });
    expect(acaoDoErro(e(404, 'NAO_ENCONTRADO')).mensagem).toBe(TEXTOS_ADMINS.rotaAusente);
    expect(acaoDoErro(e(500, 'ERRO_INTERNO')).mensagem).toBe('texto da API');
    expect(acaoDoErro(new Error('{"x":1}')).mensagem).not.toContain('{');
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
  valores(): string[] {
    return [...this.m.values()];
  }
}

describe('modo falso (mesmos schemas da API)', () => {
  let st: Memoria;
  beforeEach(() => {
    st = new Memoria();
    vi.stubGlobal('window', { sessionStorage: st });
    zerarModoFalso();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const UMA = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
  const entrar = async (email: string) => SessaoPortalSchema.parse(await (await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'Senha#Forte2026' }, {})).json());
  const com = (token: string) => ({ Authorization: `Bearer ${token}` });
  const listar = async (token: string) => ListaAdminsDaEmpresaSchema.parse(await (await responderFalso('GET', ROTAS_PORTAL.adminsDaEmpresa(UMA), undefined, com(token))).json()).itens;
  const redefinir = (token: string, usuario: string, email_id: string) => responderFalso('POST', ROTAS_PORTAL.redefinirSenhaAdmin(UMA, usuario), { email_id }, { ...com(token), 'Content-Type': 'application/json' });

  it('time da Macuxi: lista, redefine (troca pendente com 72 h), repete o mesmo id sem mudar nada', async () => {
    const s = await entrar('time@macuxi.com.br');
    const lista = await listar(s.token);
    const ana = lista.find((a) => a.email === 'admin@uma.com.br');
    if (!ana) throw new Error('sem a Ana');
    expect(podeRedefinir(ana)).toBe(true);
    const id = crypto.randomUUID();
    const r1 = await redefinir(s.token, ana.usuario_id, id);
    expect(r1.status).toBe(200);
    const c1 = RedefinirSenhaAdminRespostaSchema.parse(await r1.json());
    expect(c1).toMatchObject({ email_id: id, email: 'enfileirado', repetida: false });
    // hora-fixa-ok: o modo falso usa o relógio real; aqui só a validade de ~72 h a partir de agora
    expect(Date.parse(c1.senha_expira_em) - Date.now()).toBeGreaterThan(71 * 3600_000);
    expect(JSON.stringify(c1)).not.toMatch(/senha"\s*:/);
    const depois = (await listar(s.token)).find((a) => a.usuario_id === ana.usuario_id);
    expect(depois).toMatchObject({ trocar_senha: true, senha_expira_em: c1.senha_expira_em });
    // mesmo id = mesma resposta, marcada como repetida
    const c2 = RedefinirSenhaAdminRespostaSchema.parse(await (await redefinir(s.token, ana.usuario_id, id)).json());
    expect(c2).toMatchObject({ email_id: id, senha_expira_em: c1.senha_expira_em, repetida: true });
    // mesmo id para outro admin = 409 PEDIDO_REPETIDO_DIFERENTE
    const ti = lista.find((a) => a.email.includes('@sem-email.'));
    const r3 = await redefinir(s.token, ti?.usuario_id ?? '', id);
    expect([r3.status, ((await r3.json()) as { codigo: string }).codigo]).toEqual([409, 'PEDIDO_REPETIDO_DIFERENTE']);
  });

  it('503 EMAIL_INDISPONIVEL sem mudar nada; bloqueado = 404', async () => {
    const s = await entrar('time@macuxi.com.br');
    const lista = await listar(s.token);
    const ti = lista.find((a) => a.email.includes('@sem-email.'));
    const bloqueado = lista.find((a) => a.bloqueado);
    if (!ti || !bloqueado) throw new Error('modo falso sem os casos');
    expect(podeRedefinir(bloqueado)).toBe(false);
    const r = await redefinir(s.token, ti.usuario_id, crypto.randomUUID());
    expect([r.status, ((await r.json()) as { codigo: string }).codigo]).toEqual([503, 'EMAIL_INDISPONIVEL']);
    expect((await listar(s.token)).find((a) => a.usuario_id === ti.usuario_id)).toEqual(ti);
    expect((await redefinir(s.token, bloqueado.usuario_id, crypto.randomUUID())).status).toBe(404);
  });

  it('admin do cliente: 403 PERFIL_SEM_ACESSO na lista e no redefinir', async () => {
    const s = await entrar('admin@uma.com.br');
    const l = await responderFalso('GET', ROTAS_PORTAL.adminsDaEmpresa(UMA), undefined, com(s.token));
    expect([l.status, ((await l.json()) as { codigo: string }).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect((await redefinir(s.token, '5d1e2c0a-7b3f-4a51-8c2d-000000000001', crypto.randomUUID())).status).toBe(403);
  });

  it('nada de e-mail dos admins no sessionStorage', async () => {
    const s = await entrar('time@macuxi.com.br');
    const lista = await listar(s.token);
    await redefinir(s.token, lista[0]?.usuario_id ?? '', crypto.randomUUID());
    expect(st.valores().join('\n')).not.toMatch(/@uma\.com\.br|@sem-email\./);
  });
});
