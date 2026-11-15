/**
 * T-0094 (ADR 0032; RN-CORE-33/34): login com troca obrigatória, "Crie sua senha" (`senha/trocar`), "Esqueci a senha"
 * (`senha/esqueci`), `sessao_versao` no token e perfil fora do app. Banco e e-mail em memória (a porta real chega pela fatia S).
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { CODIGOS_AUTH, EsqueciSenhaRequestSchema, LoginSenhaRequestSchema, TrocarSenhaRequestSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { bancoDeTeste, contextoPublico, estadoInicial, fabricaEmMemoria, hashBarato, logSilencioso, SEGREDO, senhasDeTeste, TENANT_A, TENANT_B, type EstadoMemoria } from './apoio-teste';
import type { MensagemEmail, ServicoEmail } from './email';
import { criarLimiteDeFalhas } from './limite-login';
import { verificarJwtAcesso } from './seguranca';

const SENHA = 'Teste@1234';
const NOVA = 'Nova#Senha2026';
let t0: Date;
const relogio = () => t0;
const avancarMin = (m: number) => {
  t0 = new Date(t0.getTime() + m * 60_000);
};

let e: EstadoMemoria;
let senhas: ReturnType<typeof senhasDeTeste>;
let auth: ReturnType<typeof criarAutenticacao>;
let mail: { enviados: MensagemEmail[]; ativo: boolean; servico: ServicoEmail };
const { banco, consultas } = bancoDeTeste();

const novoMail = () => {
  const m = { enviados: [] as MensagemEmail[], ativo: true, servico: null as unknown as ServicoEmail };
  m.servico = {
    disponivel: () => m.ativo,
    enfileirar: async (_db, msg) => {
      if (!m.ativo) return 'indisponivel';
      m.enviados.push(msg);
      return 'enfileirado';
    },
  };
  return m;
};

const dados = (o: Record<string, unknown> = {}) => ({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br', senha: SENHA, ...o });
const login = (o: Record<string, unknown> = {}, ip = '127.0.0.1') => auth.login(contextoPublico(LoginSenhaRequestSchema.parse(dados(o)), banco, relogio, ip));
const trocar = (o: Record<string, unknown> = {}) =>
  auth.trocarSenha(contextoPublico(TrocarSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br', senha_atual: SENHA, senha_nova: NOVA, ...o }), banco, relogio));
const esqueci = (o: Record<string, unknown> = {}, ip = '127.0.0.1') => {
  const ctx = { ...contextoPublico(EsqueciSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br', ...o }), banco, relogio, ip), email: mail.servico };
  return auth.esqueciSenha(ctx as never);
};

async function falha(p: Promise<unknown>): Promise<ErroHttpModulo> {
  try {
    await p;
  } catch (x) {
    expect(x).toBeInstanceOf(ErroHttpModulo);
    return x as ErroHttpModulo;
  }
  throw new Error('deveria ter falhado');
}

const vend = () => e.usuarios.get('u-vend')!;
const comTemporaria = async (horas = 72) => {
  const u = vend();
  u.trocar_senha = true;
  u.senha_expira_em = new Date(t0.getTime() + horas * 3_600_000);
};

beforeEach(async () => {
  t0 = new Date('2026-11-07T12:00:00Z');
  e = await estadoInicial();
  senhas = senhasDeTeste();
  mail = novoMail();
  consultas.length = 0;
  auth = criarAutenticacao({
    segredo: () => SEGREDO,
    repos: fabricaEmMemoria(e),
    senhas,
    limiteLogin: criarLimiteDeFalhas(),
    limiteEsqueciIp: criarLimiteDeFalhas(5, 15 * 60_000),
    limiteEsqueciChave: criarLimiteDeFalhas(3, 60 * 60_000),
  });
});

describe('RN-CORE-34: login com senha temporária (SENHA_A_TROCAR e SENHA_TEMPORARIA_VENCIDA)', () => {
  it('RN-CORE-34: senha temporária certa responde 403 SENHA_A_TROCAR sem sessão e sem gravar ultimo_login_em', async () => {
    await comTemporaria(10);
    const erro = await falha(login());
    expect(erro.status).toBe(403);
    expect(erro.codigo).toBe(CODIGOS_AUTH.senhaATrocar);
    expect(erro.detalhes).toEqual({ motivo: 'primeiro_acesso', expira_em: new Date(t0.getTime() + 10 * 3_600_000).toISOString() });
    expect(e.sessoes).toHaveLength(0);
    expect(vend().ultimo_login_em).toBeNull();
    expect(e.leituraDeExibicao).toEqual([]); // nem o nome da empresa sai
  });

  it('RN-CORE-34: quem já entrou antes recebe o motivo senha_temporaria; senha master sem validade (P5) devolve expira_em nulo', async () => {
    await comTemporaria(10);
    vend().ultimo_login_em = new Date('2026-11-01T00:00:00Z');
    expect((await falha(login())).detalhes).toMatchObject({ motivo: 'senha_temporaria' });
    vend().senha_expira_em = null;
    expect((await falha(login())).detalhes).toMatchObject({ expira_em: null });
  });

  it('RN-CORE-34: 71 h 59 min vale; 72 h exatas dá 410 SENHA_TEMPORARIA_VENCIDA (só com a senha certa)', async () => {
    await comTemporaria(72);
    avancarMin(71 * 60 + 59);
    expect((await falha(login())).codigo).toBe(CODIGOS_AUTH.senhaATrocar);
    avancarMin(1);
    const vencida = await falha(login());
    expect(vencida.status).toBe(410);
    expect(vencida.codigo).toBe(CODIGOS_AUTH.senhaVencida);
    expect(e.sessoes).toHaveLength(0);
    // senha errada não revela o estado: continua credencial inválida
    expect((await falha(login({ senha: 'errada' }))).status).toBe(401);
  });

  it('RN-CORE-34: SENHA_A_TROCAR não conta como falha (nem bloqueia o usuário)', async () => {
    await comTemporaria(10);
    for (let i = 0; i < 6; i++) expect((await falha(login())).codigo).toBe(CODIGOS_AUTH.senhaATrocar);
    expect(vend().tentativas_falhas).toBe(0);
  });

  it('RN-CORE-34: o login faz SEMPRE duas conferências de senha (usuário com e sem temporária, inexistente, empresa inexistente)', async () => {
    const conferencias = () => senhas.contagem.verificar + senhas.contagem.gastar;
    const medir = async (p: Promise<unknown>) => {
      const antes = conferencias();
      await p.catch(() => undefined);
      return conferencias() - antes;
    };
    expect(await medir(login())).toBe(2); // definitiva, sem temporária
    vend().senha_temporaria_hash = await hashBarato('Outra#Temp123');
    vend().senha_temporaria_expira_em = new Date(t0.getTime() + 3_600_000);
    vend().senha_temporaria_criada_em = t0;
    expect(await medir(login())).toBe(2); // com temporária
    expect(await medir(login({ senha: 'errada' }))).toBe(2);
    expect(await medir(login({ email: 'ninguem@exemplo.com.br' }))).toBe(2);
    expect(await medir(login({ codigo_empresa: 'naoexiste' }))).toBe(2);
  });
});

describe('RN-CORE-33: perfil fora do app (PERFIL_FORA_DO_APP)', () => {
  it('RN-CORE-33: promotor tentando o Gestão recebe 403 com a mensagem do app certo, sem sessão — só depois da senha certa', async () => {
    const erro = await falha(login({ email: 'promotor@exemplo.com.br', app: 'gestao' }));
    expect(erro.status).toBe(403);
    expect(erro.codigo).toBe('PERFIL_FORA_DO_APP');
    expect(erro.message).toContain('Macuxi Campo');
    expect(e.sessoes).toHaveLength(0);
    expect((await falha(login({ email: 'promotor@exemplo.com.br', app: 'gestao', senha: 'errada' }))).status).toBe(401);
  });

  it('RN-CORE-33: vendedor no backoffice (web) é recusado; no Campo entra; sem `app` (APK antigo) não é conferido', async () => {
    expect((await falha(login({ app: 'web' }))).codigo).toBe('PERFIL_FORA_DO_APP');
    await expect(login({ app: 'campo' })).resolves.toBeTruthy();
    await expect(login()).resolves.toBeTruthy();
  });

  it('RN-CORE-33: o app errado vem antes da troca de senha (nada é revelado além da recusa)', async () => {
    await comTemporaria(10);
    expect((await falha(login({ app: 'web' }))).codigo).toBe('PERFIL_FORA_DO_APP');
  });
});

describe('RN-CORE-34: Crie sua senha (senha/trocar)', () => {
  it('RN-CORE-34: com a temporária e uma senha nova boa devolve a sessão, sobe a sessao_versao e grava só o hash', async () => {
    await comTemporaria(10);
    const r = await trocar();
    expect(r.usuario.email).toBe('vendedor@exemplo.com.br');
    expect(r.tenant.codigo).toBe('alfa');
    const u = vend();
    expect(u.trocar_senha).toBe(false);
    expect(u.senha_expira_em).toBeNull();
    expect(u.sessao_versao).toBe(1);
    expect(u.ultimo_login_em).toEqual(t0);
    expect(u.senha_hash).toMatch(/^\$argon2id\$/);
    expect(verificarJwtAcesso(r.access_token, t0, SEGREDO)?.sv).toBe(1);
    // a senha nova já vale no login; a antiga não
    await expect(login({ senha: NOVA })).resolves.toBeTruthy();
    expect((await falha(login())).status).toBe(401);
  });

  it('RN-CORE-34: a senha atual é obrigatória e conferida (401 igual ao login)', async () => {
    await comTemporaria(10);
    const erro = await falha(trocar({ senha_atual: 'errada' }));
    expect(erro.status).toBe(401);
    expect(erro.codigo).toBe(CODIGOS_AUTH.credenciais);
    expect(vend().trocar_senha).toBe(true);
    expect(vend().sessao_versao).toBe(0);
  });

  it('RN-CORE-32: senha nova fraca é 422 RN-CORE-32 com a lista do que falta', async () => {
    await comTemporaria(10);
    const erro = await falha(trocar({ senha_nova: 'curta' }));
    expect(erro.status).toBe(422);
    expect(erro.codigo).toBe('RN-CORE-32');
    expect(erro.detalhes).toMatchObject({ faltas: expect.arrayContaining(['caracteres']) });
    expect(vend().trocar_senha).toBe(true);
  });

  it('RN-CORE-34: repetir a senha usada para entrar é 422 RN-CORE-34', async () => {
    await comTemporaria(10);
    const erro = await falha(trocar({ senha_nova: SENHA }));
    expect(erro.status).toBe(422);
    expect(erro.codigo).toBe('RN-CORE-34');
    expect(erro.message).toBe('A senha nova não pode ser igual à senha temporária.');
  });

  it('RN-CORE-34: a troca com senha vencida é 410 e a de perfil fora do app é 403', async () => {
    await comTemporaria(1);
    avancarMin(61);
    expect((await falha(trocar())).status).toBe(410);
    await comTemporaria(10);
    expect((await falha(trocar({ app: 'web' }))).codigo).toBe('PERFIL_FORA_DO_APP');
  });

  it('RN-CORE-34: toda troca encerra o que estava aberto — refresh revogado e token com sv antigo cai na hora', async () => {
    const antes = await login(); // sessão aberta com a senha definitiva
    expect(await auth.autenticar({ authorization: `Bearer ${antes.access_token}` }, banco, t0)).not.toBeNull();
    const depois = await trocar({ senha_nova: NOVA }); // troca voluntária com a senha atual
    expect(await auth.autenticar({ authorization: `Bearer ${antes.access_token}` }, banco, t0)).toBeNull();
    expect(await auth.autenticar({ authorization: `Bearer ${depois.access_token}` }, banco, t0)).not.toBeNull();
    const antigas = e.sessoes.filter((s) => s.usuario_id === vend().id && s.revogado_em !== null);
    expect(antigas).toHaveLength(1);
    await expect(auth.refresh(contextoPublico({ refresh_token: antes.refresh_token }, banco, relogio))).rejects.toMatchObject({ status: 401 });
  });

  it('RN-CORE-34: nada de senha, e-mail ou token no log nem na auditoria da troca', async () => {
    await comTemporaria(10);
    const r = await trocar();
    const log = logSilencioso.linhas.join('\n');
    const aud = consultas.filter((c) => /plataforma.auditoria/.test(c.sql)).map((c) => JSON.stringify(c.valores)).join('|');
    expect(aud).toContain('usuario.senha_trocar');
    for (const proibido of [SENHA, NOVA, 'vendedor@exemplo.com.br', r.access_token, r.refresh_token]) {
      expect(log).not.toContain(proibido);
      expect(aud).not.toContain(proibido);
    }
  });

  it('RN-CORE-34: o contrato exige senha_atual e senha_nova e recusa campo desconhecido', () => {
    expect(() => TrocarSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'a@b.com', senha_nova: NOVA })).toThrow();
    expect(() => TrocarSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'a@b.com', senha_atual: 'x', senha_nova: NOVA, extra: 1 })).toThrow();
  });
});

describe('RN-CORE-34: Esqueci a senha (senha/esqueci)', () => {
  it('RN-CORE-34: gera a temporária paralela, enfileira "Sua nova senha" e audita sem senha nem e-mail', async () => {
    expect(await esqueci()).toEqual({});
    const u = vend();
    expect(u.senha_temporaria_hash).toMatch(/^\$argon2id\$/);
    expect(u.senha_temporaria_expira_em).toEqual(new Date(t0.getTime() + 72 * 3_600_000));
    expect(u.senha_temporaria_criada_em).toEqual(t0);
    expect(u.sessao_versao).toBe(0); // P6: não derruba nada
    expect(mail.enviados).toHaveLength(1);
    const m = mail.enviados[0]!;
    expect(m).toMatchObject({ modelo: 'nova_senha', usuario_id: u.id, para: 'vendedor@exemplo.com.br', dados: { motivo: 'esqueci', validade_horas: 72, apps: ['campo'] } });
    expect(m.dados.senha).toHaveLength(12);
    expect(m.chave_idempotencia).toBe(`${u.id}:esqueci:${t0.toISOString()}`);
    const aud = consultas.filter((c) => /plataforma.auditoria/.test(c.sql)).map((c) => JSON.stringify(c.valores)).join('|');
    expect(aud).toContain('usuario.senha_esqueci');
    for (const proibido of [m.dados.senha, 'vendedor@exemplo.com.br']) {
      expect(aud).not.toContain(proibido);
      expect(logSilencioso.linhas.join('\n')).not.toContain(proibido);
    }
  });

  it('RN-CORE-34: a resposta é idêntica para e-mail que existe, não existe, inativo, bloqueado, empresa errada e outra empresa', async () => {
    e.usuarios.get('u-prom')!.ativo = false;
    const casos: Array<Record<string, unknown>> = [
      {},
      { email: 'ninguem@exemplo.com.br' },
      { email: 'promotor@exemplo.com.br' }, // inativo
      { codigo_empresa: 'naoexiste' },
      { codigo_empresa: 'beta', email: 'promotor@exemplo.com.br' }, // existe só na outra empresa
    ];
    e.usuarios.get('u-beta')!.bloqueado_em = t0;
    casos.push({ codigo_empresa: 'beta', email: 'vendedor@exemplo.com.br' }); // bloqueado
    for (const [i, c] of casos.entries()) expect(await esqueci(c, `10.0.0.${i}`), JSON.stringify(c)).toEqual({});
    expect(mail.enviados).toHaveLength(1); // só o primeiro caso era elegível
    expect(e.usuarios.get('u-beta')!.senha_temporaria_hash).toBeNull(); // esqueci em A não toca B
    expect(e.usuarios.get('u-prom')!.senha_temporaria_hash).toBeNull();
  });

  it('RN-CORE-34: faz o mesmo trabalho caro (um hash) exista ou não o usuário', async () => {
    await esqueci();
    const comUsuario = senhas.contagem.hash;
    await esqueci({ email: 'ninguem@exemplo.com.br' }, '10.0.0.9');
    await esqueci({ codigo_empresa: 'naoexiste' }, '10.0.0.10');
    expect(senhas.contagem.hash).toBe(comUsuario * 3);
  });

  it('RN-CORE-34: em menos de 15 min não gera outra senha nem manda outro e-mail; depois de 15 min gera', async () => {
    await esqueci();
    const primeira = vend().senha_temporaria_hash;
    avancarMin(14);
    expect(await esqueci()).toEqual({});
    expect(mail.enviados).toHaveLength(1);
    expect(vend().senha_temporaria_hash).toBe(primeira);
    avancarMin(1);
    await esqueci();
    expect(mail.enviados).toHaveLength(2);
    expect(vend().senha_temporaria_hash).not.toBe(primeira);
  });

  it('RN-CORE-34: limites — 5 pedidos por IP em 15 min e 3 por empresa+e-mail em 1 h (429 igual para e-mail que não existe)', async () => {
    for (let i = 0; i < 5; i++) await esqueci({ email: `n${i}@exemplo.com.br` });
    const porIp = await falha(esqueci({ email: 'n9@exemplo.com.br' }));
    expect(porIp.status).toBe(429);
    expect(porIp.codigo).toBe(CODIGOS_AUTH.muitasTentativas);
    expect(porIp.detalhes).toHaveProperty('retry_after_s');
    avancarMin(15);
    await expect(esqueci({ email: 'n9@exemplo.com.br' })).resolves.toEqual({});
    // por chave: 3 pedidos do mesmo e-mail (IPs diferentes) e o 4º é recusado, exista ou não
    for (const [i, em] of ['vendedor@exemplo.com.br', 'ninguem@exemplo.com.br'].entries()) {
      for (let k = 0; k < 3; k++) await esqueci({ email: em }, `10.1.${i}.${k}`);
      expect((await falha(esqueci({ email: em }, `10.1.${i}.9`))).status).toBe(429);
    }
  });

  it('RN-CORE-34 (P6): a senha antiga continua valendo depois do esqueci e, ao usá-la, descarta a temporária', async () => {
    await esqueci();
    expect(vend().senha_temporaria_hash).not.toBeNull();
    await expect(login()).resolves.toBeTruthy();
    expect(vend().senha_temporaria_hash).toBeNull();
    expect(vend().senha_temporaria_criada_em).toBeNull();
  });

  it('RN-CORE-34: entrar com a temporária pede a troca; trocar com ela encerra tudo e a temporária some', async () => {
    const aberta = await login();
    await esqueci();
    const temporaria = mail.enviados[0]!.dados.senha;
    const erro = await falha(login({ senha: temporaria }));
    expect(erro.codigo).toBe(CODIGOS_AUTH.senhaATrocar);
    expect(erro.detalhes).toMatchObject({ motivo: 'senha_temporaria' });
    // repetir a temporária como senha nova é recusado
    expect((await falha(trocar({ senha_atual: temporaria, senha_nova: temporaria }))).codigo).toBe('RN-CORE-34');
    const r = await trocar({ senha_atual: temporaria, senha_nova: NOVA });
    expect(r.access_token).toBeTruthy();
    expect(vend().senha_temporaria_hash).toBeNull();
    expect(await auth.autenticar({ authorization: `Bearer ${aberta.access_token}` }, banco, t0)).toBeNull();
  });

  it('RN-CORE-34: a temporária vence em 72 h (410) e a senha antiga continua entrando', async () => {
    await esqueci();
    const temporaria = mail.enviados[0]!.dados.senha;
    avancarMin(72 * 60);
    expect((await falha(login({ senha: temporaria }))).codigo).toBe(CODIGOS_AUTH.senhaVencida);
    await expect(login()).resolves.toBeTruthy();
  });

  it('RN-CORE-34: sem e-mail configurado a resposta é a mesma e nada é gravado', async () => {
    mail.ativo = false;
    expect(await esqueci()).toEqual({});
    expect(vend().senha_temporaria_hash).toBeNull();
    expect(mail.enviados).toHaveLength(0);
  });

  it('RN-CORE-34: o contrato é estrito (só codigo_empresa e email)', () => {
    expect(() => EsqueciSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'a@b.com', senha: 'x' })).toThrow();
  });
});

describe('RN-CORE-34: sessao_versao no token', () => {
  const cab = (t: string) => ({ authorization: `Bearer ${t}` });
  it('RN-CORE-34: o token carrega sv e cai assim que a versão do usuário sobe (troca, redefinição ou desativação)', async () => {
    const s = await login();
    expect(verificarJwtAcesso(s.access_token, t0, SEGREDO)?.sv).toBe(0);
    expect(await auth.autenticar(cab(s.access_token), banco, t0)).not.toBeNull();
    vend().sessao_versao = 1;
    expect(await auth.autenticar(cab(s.access_token), banco, t0)).toBeNull();
  });
  it('RN-CORE-34: token antigo, sem sv, vale como versão 0 até a primeira troca (ninguém é deslogado no deploy)', async () => {
    const { assinarAcesso } = await import('./seguranca');
    const u = vend();
    const antigo = assinarAcesso({ sub: u.id, tid: TENANT_A, perfil: 'vendedor' }, t0, new Date(t0.getTime() + 900_000), SEGREDO);
    expect(await auth.autenticar(cab(antigo), banco, t0)).not.toBeNull();
    u.sessao_versao = 2;
    expect(await auth.autenticar(cab(antigo), banco, t0)).toBeNull();
  });
  it('RN-CORE-34: o refresh emite com a versão atual do usuário', async () => {
    const s = await login();
    const r = await auth.refresh(contextoPublico({ refresh_token: s.refresh_token }, banco, relogio));
    expect(verificarJwtAcesso(r.access_token, t0, SEGREDO)?.sv).toBe(0);
    expect(TENANT_B).not.toBe(TENANT_A);
  });
});

describe('RN-CORE-34: a troca só vale se o login der certo, e a falha de login vai para a auditoria', () => {
  const auditoria = () => consultas.filter((c) => /plataforma.auditoria/.test(c.sql)).map((c) => JSON.stringify(c.valores)).join('|');

  it('RN-CORE-34: se os dados da empresa não saem (401 no fim), a senha nova NÃO é gravada e a temporária continua valendo', async () => {
    await comTemporaria(10);
    const hashAntes = vend().senha_hash;
    e.exibicaoVazia = new Set(['alfa']);
    const erro = await falha(trocar());
    expect(erro.status).toBe(401);
    expect(vend().senha_hash).toBe(hashAntes);
    expect(vend().trocar_senha).toBe(true);
    expect(vend().sessao_versao).toBe(0);
    expect(e.sessoes).toHaveLength(0);
    expect(auditoria()).not.toContain('usuario.senha_trocar');
    e.exibicaoVazia = undefined;
    expect((await trocar()).usuario.email).toBe('vendedor@exemplo.com.br'); // a mesma temporária ainda entra
  });

  it('RN-CORE-34: senha errada audita usuario.login_falha com o motivo e o usuário, sem senha nem e-mail; a resposta segue 401 genérica', async () => {
    const erro = await falha(login({ senha: 'Errada#9999' }));
    expect(erro.status).toBe(401);
    const aud = auditoria();
    expect(aud).toContain('usuario.login_falha');
    expect(aud).toContain('senha_nao_confere');
    expect(aud).toContain(vend().id);
    for (const proibido of ['Errada#9999', SENHA, 'vendedor@exemplo.com.br']) expect(aud).not.toContain(proibido);
  });

  it('RN-CORE-34: e-mail desconhecido audita email_nao_encontrado (sem usuário e sem o e-mail digitado)', async () => {
    await falha(login({ email: 'ninguem@exemplo.com.br' }));
    const aud = auditoria();
    expect(aud).toContain('email_nao_encontrado');
    expect(aud).not.toContain('ninguem@exemplo.com.br');
  });

  it('RN-CORE-34: usuário bloqueado audita bloqueio, com senha certa ou errada', async () => {
    vend().bloqueado_em = t0;
    expect((await falha(login())).status).toBe(423);
    expect((await falha(login({ senha: 'Errada#9999' }))).status).toBe(401);
    expect(auditoria().match(/bloqueio_admin/g)).toHaveLength(2);
  });

  it('RN-CORE-34: empresa não encontrada ou inativa fica só no log (sem tenant não há auditoria), sem e-mail nem senha', async () => {
    await falha(login({ codigo_empresa: 'naoexiste' }));
    let log = logSilencioso.linhas.join('\n'); // cada contexto zera o log: lê entre as chamadas
    e.tenants.get('alfa')!.status = 'suspenso';
    await falha(login());
    log += logSilencioso.linhas.join('\n');
    expect(log).toContain('empresa_nao_encontrada');
    expect(log).toContain('empresa_inativa');
    for (const proibido of [SENHA, 'vendedor@exemplo.com.br']) expect(log).not.toContain(proibido);
    expect(auditoria()).not.toContain('usuario.login_falha');
  });
});
