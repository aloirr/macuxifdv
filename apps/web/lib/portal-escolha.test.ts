/**
 * T-0093 (ADR 0031; spec docs/design/portal-entrar.md §1 a §4): entrada só com e-mail e senha, escolha de empresa e "Trocar de
 * empresa". Partes puras da sessão (`lib/portal-sessao.ts`) e o fluxo de ponta no modo falso (`lib/portal-falso.ts`), contra o
 * `SessaoPortalSchema` do SDK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODIGO_USUARIO_SEM_FILIAL, MENSAGEM_USUARIO_SEM_FILIAL, SessaoPortalSchema } from '@macuxi/platform-sdk';
import { ImportarEquipeRespostaSchema, mensagemBloqueioPorTentativas } from '@macuxi/core/contracts';

import { CONTA_SENHA_A_TROCAR, CONTAS_FALSAS, responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL, ROTAS_PUBLICAS_PORTAL } from './portal-rotas';
import {
  avisoDaEmpresaIndisponivel,
  CAMINHO_ESCOLHER_EMPRESA,
  CHAVE_AVISO_PORTAL,
  CHAVE_EMPRESA_INDISPONIVEL,
  consumirAvisoPortal,
  consumirEmpresaIndisponivel,
  desvioDaPaginaDaEmpresa,
  desvioDoErro,
  destinoDaSessao,
  destinoDepoisDoLogin,
  ehTimeMacuxi,
  guardarAvisoPortal,
  guardarEmpresaIndisponivel,
  itensDaEscolha,
  lerDesvioPortal,
  MENSAGEM_EMPRESA_INDISPONIVEL,
  MENSAGEM_PORTAL_SEM_FILIAL,
  mensagemDaEmpresaIndisponivel,
  passoDaEscolha,
  pedirDesvioPortal,
  podeTrocarDeEmpresa,
  retirarDesvioPortal,
  salvarSessaoPortal,
  sessaoSemEmpresa,
  type SessaoPortal,
} from './portal-sessao';

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

const A = { id: '0b6f1a52-5c1e-4c4e-9a43-00000000000a', codigo: 'atacado-norte', nome: 'Atacado Norte S.A.' };
const B = { id: '0b6f1a52-5c1e-4c4e-9a43-00000000000b', codigo: 'comercial-boa-vista', nome: 'Comercial Boa Vista Ltda' };
const prazos = { token: 't'.repeat(40), expira_em: '2026-11-07T15:15:00Z', sessao_expira_em: '2026-11-07T23:00:00Z' };
const timeMacuxi: SessaoPortal = { ...prazos, tipo: 'super_admin', empresa: null, empresas: [] };
const umaEmpresa: SessaoPortal = { ...prazos, tipo: 'admin_cliente', empresa: A, empresas: [A] };
const duasSemEscolha: SessaoPortal = { ...prazos, tipo: 'admin_cliente', empresa: null, empresas: [A, B] };
const duasEmB: SessaoPortal = { ...prazos, tipo: 'admin_cliente', empresa: B, empresas: [A, B] };
const C = { id: '0b6f1a52-5c1e-4c4e-9a43-00000000000c', codigo: 'casa-do-campo', nome: 'Casa do Campo ME' };
const tresEmB: SessaoPortal = { ...prazos, tipo: 'admin_cliente', empresa: B, empresas: [A, B, C] };

describe('para onde vai depois de entrar', () => {
  it('time da Macuxi: Empresas (ou a página de onde a guarda mandou)', () => {
    expect(destinoDaSessao(timeMacuxi)).toBe('/empresas');
    expect(destinoDepoisDoLogin(timeMacuxi, null)).toBe('/empresas');
    expect(destinoDepoisDoLogin(timeMacuxi, `/empresas/${B.id}#integracao`)).toBe(`/empresas/${B.id}#integracao`);
    expect(destinoDepoisDoLogin(timeMacuxi, '//mal.com')).toBe('/empresas');
  });
  it('admin do cliente com 1 empresa entra direto nela', () => {
    expect(destinoDaSessao(umaEmpresa)).toBe(`/empresas/${A.id}`);
    expect(destinoDepoisDoLogin(umaEmpresa, null)).toBe(`/empresas/${A.id}`);
    expect(destinoDepoisDoLogin(umaEmpresa, `/empresas/${A.id}#bases`)).toBe(`/empresas/${A.id}#bases`);
  });
  it('admin do cliente com 2+ sem escolher vai à "Escolha a empresa", mesmo com página de origem', () => {
    expect(destinoDaSessao(duasSemEscolha)).toBe(CAMINHO_ESCOLHER_EMPRESA);
    expect(destinoDepoisDoLogin(duasSemEscolha, `/empresas/${A.id}`)).toBe(CAMINHO_ESCOLHER_EMPRESA);
  });
  it('a página de origem de OUTRA empresa nunca abre sem escolher (multi-tenant)', () => {
    expect(destinoDepoisDoLogin(duasEmB, `/empresas/${A.id}#bases`)).toBe(`/empresas/${B.id}`);
    expect(destinoDepoisDoLogin(duasEmB, '/empresas')).toBe(`/empresas/${B.id}`);
    expect(destinoDepoisDoLogin(duasEmB, '/empresas/nova')).toBe(`/empresas/${B.id}`);
  });
});

describe('Escolha a empresa e Trocar de empresa (spec §2 e §3)', () => {
  it('2+ mostra a lista com os nomes, na ordem da sessão; selo "Atual" só na volta pelo Trocar', () => {
    expect(itensDaEscolha(duasSemEscolha).map((i) => [i.nome, i.codigo, i.atual])).toEqual([
      ['Atacado Norte S.A.', 'atacado-norte', false],
      ['Comercial Boa Vista Ltda', 'comercial-boa-vista', false],
    ]);
    const naVolta = itensDaEscolha(duasEmB);
    expect(naVolta.map((i) => i.atual)).toEqual([false, true]);
    expect(naVolta.map((i) => i.rotuloAcessivel)).toEqual(['Entrar em Atacado Norte S.A.', 'Entrar em Comercial Boa Vista Ltda, empresa atual']);
    expect(itensDaEscolha(timeMacuxi)).toEqual([]);
  });
  it('"Trocar de empresa" só para o admin do cliente com 2+; "Nova empresa" e a lista só para o time da Macuxi', () => {
    expect(podeTrocarDeEmpresa(duasEmB)).toBe(true);
    expect(podeTrocarDeEmpresa(duasSemEscolha)).toBe(true);
    expect(podeTrocarDeEmpresa(umaEmpresa)).toBe(false);
    expect(podeTrocarDeEmpresa(timeMacuxi)).toBe(false);
    expect(podeTrocarDeEmpresa(null)).toBe(false);
    expect(ehTimeMacuxi(timeMacuxi)).toBe(true);
    expect(ehTimeMacuxi(umaEmpresa)).toBe(false);
    expect(ehTimeMacuxi(undefined)).toBe(false);
  });
  it('trocar exige escolher: a página de outra empresa da lista leva à escolha; fora da lista, à empresa atual', () => {
    expect(desvioDaPaginaDaEmpresa(duasEmB, B.id)).toBeNull();
    expect(desvioDaPaginaDaEmpresa(duasEmB, A.id)).toBe(CAMINHO_ESCOLHER_EMPRESA);
    expect(desvioDaPaginaDaEmpresa(duasEmB, 'outra')).toBe(`/empresas/${B.id}`);
    expect(desvioDaPaginaDaEmpresa(duasSemEscolha, A.id)).toBe(CAMINHO_ESCOLHER_EMPRESA);
    expect(desvioDaPaginaDaEmpresa(umaEmpresa, B.id)).toBe(`/empresas/${A.id}`);
    expect(desvioDaPaginaDaEmpresa(timeMacuxi, B.id)).toBeNull();
  });
});

describe('403/409 de empresa (desenho T-0093 §4; spec §4)', () => {
  afterEach(() => {
    retirarDesvioPortal();
  });
  it('409 EMPRESA_NAO_ESCOLHIDA → escolha sem aviso; 403 EMPRESA_NAO_PERMITIDA → escolha (2+) ou entrada (1) com aviso', () => {
    expect(desvioDoErro(duasEmB, 409, 'EMPRESA_NAO_ESCOLHIDA')).toEqual({ para: 'escolher', aviso: null });
    expect(desvioDoErro(duasEmB, 403, 'EMPRESA_NAO_PERMITIDA')).toEqual({
      para: 'escolher',
      aviso: 'A empresa Comercial Boa Vista Ltda não está mais disponível para você.',
      empresa: { id: B.id, nome: B.nome },
    });
    expect(desvioDoErro(umaEmpresa, 403, 'EMPRESA_NAO_PERMITIDA')).toEqual({ para: 'entrar', aviso: MENSAGEM_EMPRESA_INDISPONIVEL });
    expect(MENSAGEM_EMPRESA_INDISPONIVEL).toBe('Esta empresa não está mais disponível para você.');
  });
  it('403 com 2+: a empresa é a da chamada (x-macuxi-tenant) ou, sem ela, a atual; fora da lista, o aviso genérico', () => {
    expect(desvioDoErro(tresEmB, 403, 'EMPRESA_NAO_PERMITIDA', A.id)).toMatchObject({ para: 'escolher', empresa: { id: A.id, nome: A.nome } });
    expect(desvioDoErro(tresEmB, 403, 'EMPRESA_NAO_PERMITIDA', 'outra')).toEqual({ para: 'escolher', aviso: MENSAGEM_EMPRESA_INDISPONIVEL });
    expect(desvioDoErro(duasSemEscolha, 403, 'EMPRESA_NAO_PERMITIDA')).toEqual({ para: 'escolher', aviso: MENSAGEM_EMPRESA_INDISPONIVEL });
    expect(mensagemDaEmpresaIndisponivel('Atacado Norte S.A.')).toBe('A empresa Atacado Norte S.A. não está mais disponível para você.');
  });
  it('sem laço depois do 403 (R-20261107-174216 🟡 2): a empresa sai da lista e da sessão, nem como "Atual"', () => {
    // 3 empresas, a atual (B) deu 403: sobram A e C, sem atual; a Escolha não mostra B
    const sem = sessaoSemEmpresa(tresEmB, B.id);
    expect(sem && SessaoPortalSchema.safeParse(sem).success).toBe(true);
    expect(sem?.empresa).toBeNull();
    expect(sem?.empresas.map((e) => e.id)).toEqual([A.id, C.id]);
    expect(itensDaEscolha(tresEmB, [B.id]).map((i) => [i.nome, i.atual])).toEqual([
      ['Atacado Norte S.A.', false],
      ['Casa do Campo ME', false],
    ]);
    expect(passoDaEscolha(tresEmB, [B.id])).toEqual({ tipo: 'lista' });
    // a guarda não leva mais de volta à página da empresa do 403
    if (!sem) throw new Error('sessão sem B');
    expect(destinoDaSessao(sem)).toBe(CAMINHO_ESCOLHER_EMPRESA);
    expect(desvioDaPaginaDaEmpresa(sem, B.id)).toBe(CAMINHO_ESCOLHER_EMPRESA);
  });
  it('403 com 2 empresas: sobrou 1 → entra direto nela; sobrou só a atual → a página dela; nenhuma → entrada', () => {
    // a atual (B) deu 403: a sessão com A sem escolha não vale pelo schema; a Escolha entra em A pela API
    expect(sessaoSemEmpresa(duasEmB, B.id)).toBeNull();
    expect(passoDaEscolha(duasEmB, [B.id])).toEqual({ tipo: 'entrar_em', id: A.id });
    // o toque em A deu 403 e B é a atual: sessão com B só, e a regra de 1 empresa leva à página dela
    const soB = sessaoSemEmpresa(duasEmB, A.id);
    expect(soB).toMatchObject({ empresa: B, empresas: [B] });
    expect(soB && destinoDaSessao(soB)).toBe('/empresas/' + B.id);
    expect(passoDaEscolha(duasEmB, [A.id])).toEqual({ tipo: 'pagina', id: B.id });
    expect(passoDaEscolha(duasSemEscolha, [A.id, B.id])).toEqual({ tipo: 'entrada' });
    expect(sessaoSemEmpresa(umaEmpresa, A.id)).toBeNull();
    expect(sessaoSemEmpresa(timeMacuxi, A.id)).toBeNull();
    expect(sessaoSemEmpresa(duasEmB, 'outra')).toBeNull();
  });
  it('a empresa do 403 vai para a Escolha uma vez, só com id e nome', () => {
    const st = new Memoria();
    guardarEmpresaIndisponivel({ id: B.id, nome: B.nome }, st);
    expect(JSON.parse(st.getItem(CHAVE_EMPRESA_INDISPONIVEL) ?? '{}')).toEqual({ id: B.id, nome: B.nome });
    expect(consumirEmpresaIndisponivel(st)).toEqual({ id: B.id, nome: B.nome });
    expect(consumirEmpresaIndisponivel(st)).toBeNull();
    st.setItem(CHAVE_EMPRESA_INDISPONIVEL, JSON.stringify({ id: 1, nome: '' }));
    expect(consumirEmpresaIndisponivel(st)).toBeNull();
  });
  it('T-0176 (RN-CORE-39; ADR 0056): 403 USUARIO_SEM_FILIAL (empresa.sem_filial) → a empresa sai como no 403 de empresa, com o texto aprovado', () => {
    expect(CODIGO_USUARIO_SEM_FILIAL).toBe('USUARIO_SEM_FILIAL');
    // RD-1009: só no portal, o texto manda o próprio admin ao Backoffice; o app e a 16f seguem com o do SDK
    expect(MENSAGEM_PORTAL_SEM_FILIAL).toBe('Sua conta está sem filial de cadastro. Entre no Backoffice e escolha a sua filial.');
    expect(MENSAGEM_PORTAL_SEM_FILIAL).not.toBe(MENSAGEM_USUARIO_SEM_FILIAL);
    // 1 empresa: a sessão acaba e a entrada mostra o aviso da conta sem filial (o portal não destrava; a filial se informa no BKO)
    expect(desvioDoErro(umaEmpresa, 403, CODIGO_USUARIO_SEM_FILIAL)).toEqual({ para: 'entrar', aviso: MENSAGEM_PORTAL_SEM_FILIAL });
    // 2+: a empresa da chamada (ou a atual) sai da lista da Escolha, com o mesmo texto aprovado, não o de empresa indisponível
    const d = desvioDoErro(duasEmB, 403, CODIGO_USUARIO_SEM_FILIAL);
    expect(d).toEqual({ para: 'escolher', aviso: MENSAGEM_PORTAL_SEM_FILIAL, empresa: { id: B.id, nome: B.nome, semFilial: true } });
    expect(desvioDoErro(tresEmB, 403, CODIGO_USUARIO_SEM_FILIAL, A.id)).toMatchObject({ empresa: { id: A.id, semFilial: true } });
    expect(desvioDoErro(tresEmB, 403, CODIGO_USUARIO_SEM_FILIAL, 'outra')).toEqual({ para: 'escolher', aviso: MENSAGEM_PORTAL_SEM_FILIAL });
    // o time da Macuxi nunca vem com sem_filial: nada a desviar
    expect(desvioDoErro(timeMacuxi, 403, CODIGO_USUARIO_SEM_FILIAL)).toBeNull();
    // a marca vai à Escolha uma vez e escolhe o aviso
    const st = new Memoria();
    guardarEmpresaIndisponivel({ id: B.id, nome: B.nome, semFilial: true }, st);
    const e = consumirEmpresaIndisponivel(st);
    expect(e).toEqual({ id: B.id, nome: B.nome, semFilial: true });
    expect(e && avisoDaEmpresaIndisponivel(e)).toBe(MENSAGEM_PORTAL_SEM_FILIAL);
    expect(avisoDaEmpresaIndisponivel({ id: B.id, nome: B.nome })).toBe(mensagemDaEmpresaIndisponivel(B.nome));
    // a entrada aceita o aviso da conta sem filial (texto fixo)
    guardarAvisoPortal(MENSAGEM_PORTAL_SEM_FILIAL, st);
    expect(consumirAvisoPortal(st)).toBe(MENSAGEM_PORTAL_SEM_FILIAL);
  });
  it('outros erros e o time da Macuxi não desviam', () => {
    expect(desvioDoErro(timeMacuxi, 403, 'EMPRESA_NAO_PERMITIDA')).toBeNull();
    expect(desvioDoErro(duasEmB, 403, 'PERFIL_SEM_ACESSO')).toBeNull();
    expect(desvioDoErro(duasEmB, 404, 'TENANT_NAO_ENCONTRADO')).toBeNull();
    expect(desvioDoErro(null, 409, 'EMPRESA_NAO_ESCOLHIDA')).toBeNull();
  });
  it('o desvio vale uma vez (a guarda consome)', () => {
    pedirDesvioPortal({ para: 'escolher', aviso: null });
    expect(lerDesvioPortal()).toEqual({ para: 'escolher', aviso: null });
    expect(retirarDesvioPortal()).toEqual({ para: 'escolher', aviso: null });
    expect(lerDesvioPortal()).toBeNull();
  });
  it('o aviso guardado é só o texto fixo da spec e vale uma vez', () => {
    const st = new Memoria();
    guardarAvisoPortal('qualquer texto com fulano@empresa.com.br', st);
    expect(st.getItem(CHAVE_AVISO_PORTAL)).toBeNull();
    guardarAvisoPortal(MENSAGEM_EMPRESA_INDISPONIVEL, st);
    expect(consumirAvisoPortal(st)).toBe(MENSAGEM_EMPRESA_INDISPONIVEL);
    expect(consumirAvisoPortal(st)).toBeNull();
  });
});

describe('rotas do portal sem primeiro acesso, TOTP nem convite', () => {
  it('só o login é público; escolher empresa leva o token', () => {
    expect(ROTAS_PUBLICAS_PORTAL).toEqual(['/plataforma/auth/login']);
    expect(ROTAS_PORTAL.escolherEmpresa).toBe('/plataforma/auth/empresa');
    expect(Object.values(ROTAS_PORTAL).filter((r) => typeof r === 'string' && /primeiro-acesso|totp|segundo-fator|recuperacao|convite/.test(r))).toEqual([]);
  });
});

describe('fluxo no modo falso (mesmos schemas da API)', () => {
  let st: Memoria;
  beforeEach(() => {
    st = new Memoria();
    vi.stubGlobal('window', { sessionStorage: st });
    zerarModoFalso();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SENHA = 'Senha#Forte2026';
  const login = async (email: string, senha = SENHA) => responderFalso('POST', ROTAS_PORTAL.login, { email, senha }, {});
  const sessaoDe = async (r: Response) => SessaoPortalSchema.parse(await r.json());
  const com = (s: SessaoPortal, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${s.token}`, ...extra });

  it('as três contas falsas: time da Macuxi, admin com 1 e com 2 empresas', () => {
    expect(Object.keys(CONTAS_FALSAS).sort()).toEqual(['admin@duas.com.br', 'admin@uma.com.br', 'time@macuxi.com.br']);
  });

  it('time da Macuxi: sessão sem empresa; vê todas', async () => {
    const s = await sessaoDe(await login('time@macuxi.com.br'));
    expect(s.tipo).toBe('super_admin');
    expect(destinoDaSessao(s)).toBe('/empresas');
    const lista = (await (await responderFalso('GET', ROTAS_PORTAL.empresas, undefined, com(s))).json()) as { itens: Record<string, unknown>[] };
    expect(lista.itens.length).toBeGreaterThanOrEqual(3);
    // Coluna Plano (§11.5): a tela usa só `plano` e `em_teste`; o modo falso não traz `teste_ate` (RD-0959).
    expect(lista.itens.every((i) => 'em_teste' in i && !('teste_ate' in i))).toBe(true);
  });

  it('1 empresa: entra direto (empresa já escolhida)', async () => {
    const s = await sessaoDe(await login('admin@uma.com.br'));
    expect(s.empresa?.nome).toBe('Distribuidora Uma Ltda');
    expect(destinoDaSessao(s)).toBe(`/empresas/${s.empresa?.id}`);
  });

  it('2+: lista com os nomes; rota de módulo sem escolher = 409; escolher dá token novo e mata o anterior; trocar exige escolher de novo', async () => {
    const s0 = await sessaoDe(await login('admin@duas.com.br'));
    expect(s0.empresa).toBeNull();
    expect(itensDaEscolha(s0).map((i) => i.nome)).toEqual(['Atacado Norte S.A.', 'Comercial Boa Vista Ltda']);
    const [a, b] = s0.empresas;
    if (!a || !b) throw new Error('sessão sem as duas empresas');
    expect((await responderFalso('GET', ROTAS_PORTAL.ordemCarga, undefined, com(s0, { 'x-macuxi-tenant': a.id }))).status).toBe(409);

    const s1 = await sessaoDe(await responderFalso('POST', ROTAS_PORTAL.escolherEmpresa, { tenant_id: a.id }, com(s0)));
    expect(s1.empresa?.id).toBe(a.id);
    expect(s1.token).not.toBe(s0.token);
    expect((await responderFalso('POST', ROTAS_PORTAL.renovar, undefined, com(s0))).status).toBe(401);
    expect((await responderFalso('GET', ROTAS_PORTAL.ordemCarga, undefined, com(s1, { 'x-macuxi-tenant': a.id }))).status).toBe(200);
    // outra empresa da lista sem escolher de novo: 403
    expect((await responderFalso('GET', ROTAS_PORTAL.ordemCarga, undefined, com(s1, { 'x-macuxi-tenant': b.id }))).status).toBe(403);

    const s2 = await sessaoDe(await responderFalso('POST', ROTAS_PORTAL.escolherEmpresa, { tenant_id: b.id }, com(s1)));
    expect(s2.empresa?.id).toBe(b.id);
    expect((await responderFalso('GET', ROTAS_PORTAL.ordemCarga, undefined, com(s2, { 'x-macuxi-tenant': a.id }))).status).toBe(403);
    // empresa fora da lista: 403 na escolha
    expect((await responderFalso('POST', ROTAS_PORTAL.escolherEmpresa, { tenant_id: '0b6f1a52-5c1e-4c4e-9a43-000000000099' }, com(s2))).status).toBe(403);
    // o admin do cliente não cria empresa nem vê as dos outros
    expect((await responderFalso('POST', ROTAS_PORTAL.empresas, {}, com(s2))).status).toBe(403);
    const lista = (await (await responderFalso('GET', ROTAS_PORTAL.empresas, undefined, com(s2))).json()) as { itens: { id: string }[] };
    expect(lista.itens.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('401 com a mesma resposta para e-mail inexistente e senha errada; 5 erros = 423, também para e-mail inexistente', async () => {
    const r1 = await login('ninguem@empresa.com.br');
    const r2 = await login('admin@uma.com.br', 'errada');
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(await r1.json()).toEqual(await r2.json());
    for (let i = 0; i < 4; i++) await login('ninguem@empresa.com.br');
    const r3 = await login('ninguem@empresa.com.br');
    expect(r3.status).toBe(423);
    // RN-CORE-31: a mesma frase do contrato do Core e os minutos que faltam em `detalhes`
    expect(await r3.json()).toEqual({ codigo: 'BLOQUEADO', mensagem: mensagemBloqueioPorTentativas(15), detalhes: { minutos_restantes: 15 } });
  });

  it('T-0094: admin com a senha ainda temporária = 403 SENHA_A_TROCAR só com a senha certa; sem sessão', async () => {
    const r = await login(CONTA_SENHA_A_TROCAR);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { codigo: string }).codigo).toBe('SENHA_A_TROCAR');
    expect((await login(CONTA_SENHA_A_TROCAR, 'errada')).status).toBe(401);
  });

  it('T-0094: Equipe por CSV sem convite; acessos enviados por e-mail; 503 EMAIL_INDISPONIVEL antes de gravar', async () => {
    const s = await sessaoDe(await login('admin@uma.com.br'));
    const tenant = s.empresa?.id ?? '';
    const cab = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos';
    const importar = (csv: string, modo: 'conferir' | 'gravar') => responderFalso('POST', ROTAS_PORTAL.equipeImportacoes, { csv, modo }, com(s, { 'x-macuxi-tenant': tenant }));
    const csv = [cab, 'Ana,ana@x.com.br,,supervisor,,,', 'Bia,bia@x.com.br,,vendedor,ana@x.com.br,,', ''].join('\n');
    const r = ImportarEquipeRespostaSchema.parse(await (await importar(csv, 'gravar')).json());
    expect(r).toMatchObject({ gravado: true, acessos_enviados: 2, email_acesso: 'enfileirado' });
    expect(r).not.toHaveProperty('convites');
    // de novo: ninguém novo, nenhum acesso
    expect(ImportarEquipeRespostaSchema.parse(await (await importar(csv, 'gravar')).json())).toMatchObject({ acessos_enviados: 0, email_acesso: null });
    const semEmail = [cab, 'Caio,caio@sem-email.com.br,,vendedor,,,', ''].join('\n');
    expect((await importar(semEmail, 'conferir')).status).toBe(200);
    const g = await importar(semEmail, 'gravar');
    expect(g.status).toBe(503);
    expect(((await g.json()) as { codigo: string }).codigo).toBe('EMAIL_INDISPONIVEL');
    // a lista da equipe fica na memória: nada de e-mail no sessionStorage
    expect(st.valores().join(' ')).not.toMatch(/ana@|bia@|caio@/);
  });

  it('nada de senha nem de e-mail no sessionStorage (sessão salva e estado do modo falso)', async () => {
    const s = await sessaoDe(await login('admin@duas.com.br'));
    salvarSessaoPortal(s, st);
    await login('admin@uma.com.br', 'errada');
    const tudo = st.valores().join('\n');
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain('errada');
    expect(tudo).not.toMatch(/admin@|time@|ninguem@/);
    expect(tudo).not.toMatch(/"senha"/);
  });

  it('passo Empresa: empresa nova sem admin = 422 RN-CORE-34; senha fraca = 422 RN-CORE-32 com as faltas; com admin = criado', async () => {
    const s = await sessaoDe(await login('time@macuxi.com.br'));
    const empresa = { codigo: 'nova-empresa', razao_social: 'Nova Empresa Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'vendedor', licencas: 3 }] };
    const sem = await responderFalso('POST', ROTAS_PORTAL.empresas, empresa, com(s));
    expect(sem.status).toBe(422);
    expect(((await sem.json()) as { codigo: string }).codigo).toBe('RN-CORE-34');
    const fraca = await responderFalso('POST', ROTAS_PORTAL.empresas, { ...empresa, admin: { nome: 'Ana', email: 'ana@nova.com.br', senha: 'semnumero' } }, com(s));
    expect(fraca.status).toBe(422);
    expect(await fraca.json()).toMatchObject({ codigo: 'RN-CORE-32', detalhes: { faltas: ['numero', 'especial'] } });
    const ok = await responderFalso('POST', ROTAS_PORTAL.empresas, { ...empresa, admin: { nome: 'Ana', email: 'ana@nova.com.br', senha: SENHA } }, com(s));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ resultado: 'criado', admin: 'criado' });
    expect(st.valores().join('\n')).not.toContain(SENHA);
  });
});
