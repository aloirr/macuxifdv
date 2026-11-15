/**
 * "Esqueci a senha" de ponta a ponta (pedido do dono do produto, R-20261114-204500-alexandre: "deixe como está, só garanta que
 * está funcionando"; T-0094, ADR 0032, RN-CORE-32/34). Matriz: docs/testes/esqueci-senha-r20261114.md.
 * Complementa o `ciclo-senha-t0094.test.ts` (CS-04/CS-05 já cobrem resposta neutra, limites, 15 min, paralela e multi-tenant)
 * com o que faltava provar pela API real + Postgres + porta REAL de e-mail (carga cifrada na outbox):
 *  - EJ-01 jornada inteira por app (Campo, Gestão, BKO): pedido com código e e-mail digitados em maiúsculas e com espaços →
 *          e-mail "Sua nova senha" com o código, o login e a MESMA senha que a outbox guarda → login com ela = 403 SENHA_A_TROCAR
 *          sem sessão → "Crie sua senha" → login NORMAL com a nova (200) → a temporária e a antiga não entram mais (401 neutro);
 *  - EJ-02 dados inválidos: 400 VALIDACAO igual para e-mail que existe e que não existe; nada gravado, nada enviado;
 *  - EJ-03 temporária vencida: 410 no login e na troca, sem sessão; pedir outra recupera o acesso (a vencida morre);
 *  - EJ-04 senha INICIAL vencida (primeiro acesso, o 410 manda usar o "Esqueci"): o "Esqueci" recupera o acesso;
 *  - EJ-05 quem se bloqueou errando a senha (5 falhas, 15 min): o e-mail sai, a temporária só entra quando o bloqueio passa;
 *  - EJ-06 toque duplo (pedidos simultâneos): um e-mail só, e a senha que ele leva entra.
 * Relógio real; vencimento e bloqueio são postos direto no banco (o JWT segue o relógio real). Roda só com banco (CI).
 */
import {
  CODIGOS_AUTH,
  DetalhesSenhaATrocarSchema,
  MENSAGEM_SENHA_VENCIDA,
  SessaoRespostaSchema,
  type SessaoResposta,
} from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { ASSUNTOS_EMAIL, renderizarEmail, type Perfil } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, comToken, erroDe, novoIp, SEGREDO_JWT, subirApi, type ApiDeTeste } from '../apoio/api';
import {
  cargaDaOutbox,
  criarEspiaoEmail,
  logEmMemoria,
  outboxDeEmail,
  portaRealDeTeste,
} from '../apoio/email';
import { criarUsuarioNoTenant } from '../apoio/portal';

/** E-mails fictícios (domínio de exemplo) e senhas na RN-CORE-32. */
const EM = (x: string) => `${x}.esqueci@exemplo.com.br`;
const SENHA_ATUAL = 'Atual#Esqueci-a1';
const SENHA_NOVA = 'Criada#Esqueci-b2';
const HORA = 3_600_000;

type App = 'campo' | 'gestao' | 'web';

describe.skipIf(semBanco())('"Esqueci a senha" de ponta a ponta (R-20261114-204500; RN-CORE-34)', () => {
  let api: ApiDeTeste;
  const email = criarEspiaoEmail();
  const linhasLog: string[] = [];
  const real = portaRealDeTeste(email, { segredoJwt: SEGREDO_JWT, log: logEmMemoria(linhasLog) });

  const post = (url: string, payload: object, ip = novoIp()) =>
    api.app.inject({ method: 'POST', url, remoteAddress: ip, payload });
  const esqueci = (codigo: string, e: string, ip = novoIp()) =>
    post('/v1/auth/senha/esqueci', { codigo_empresa: codigo, email: e }, ip);
  const trocar = (e: string, atual: string, nova: string, app?: App) =>
    post('/v1/auth/senha/trocar', {
      codigo_empresa: A.codigo,
      email: e,
      senha_atual: atual,
      senha_nova: nova,
      ...(app ? { app } : {}),
    });
  const sessaoDe = (r: LightMyRequestResponse): SessaoResposta => {
    expect(r.statusCode, r.body).toBe(200);
    return SessaoRespostaSchema.parse(r.json());
  };
  const aTrocar = (r: LightMyRequestResponse) => {
    expect(`${r.statusCode} ${erroDe(r).codigo}`, r.body).toBe(`403 ${CODIGOS_AUTH.senhaATrocar}`);
    expect(r.body).not.toMatch(/access_token|refresh_token/);
    return DetalhesSenhaATrocarSchema.parse(erroDe(r).detalhes);
  };
  const usuario = async (id: string) =>
    (
      await api.admin.query<{
        trocar_senha: boolean;
        senha_expira_em: Date | null;
        senha_temporaria_hash: string | null;
        senha_temporaria_expira_em: Date | null;
        tentativas_falhas: number;
        bloqueio_ate: Date | null;
        ultimo_login_em: Date | null;
      }>(
        'select trocar_senha, senha_expira_em, senha_temporaria_hash, senha_temporaria_expira_em, tentativas_falhas, bloqueio_ate, ultimo_login_em from core.usuario where id = $1',
        [id],
      )
    ).rows[0]!;
  const sessoes = async (id: string) =>
    (
      await api.admin.query<{ n: number }>(
        'select count(*)::int as n from core.sessao where usuario_id = $1',
        [id],
      )
    ).rows[0]!.n;
  /** O que a outbox guarda para o usuário (carga decifrada com a chave da porta real): o conteúdo do e-mail que sai. */
  const emailsDaOutbox = async (id: string) => {
    const linhas = (await outboxDeEmail(api.admin)).filter(
      (l) => l.usuario_id === id && l.modelo === 'nova_senha',
    );
    return Promise.all(linhas.map((l) => cargaDaOutbox(api.admin, l.id, real.cifra)));
  };
  const novaPessoa = (chave: string, perfil: Perfil) =>
    criarUsuarioNoTenant(api.admin, {
      tenantId: A.tenantId,
      email: EM(chave),
      nome: `Pessoa ${chave} Fictícia`,
      senha: SENHA_ATUAL,
      perfil,
    });
  /** Pede pelo "Esqueci", confere o 202 neutro e devolve a senha temporária que a OUTBOX leva (a que chega à pessoa). */
  const pedirTemporaria = async (id: string, e: string): Promise<string> => {
    const antes = (await emailsDaOutbox(id)).length;
    const r = await esqueci(A.codigo, e);
    expect(`${r.statusCode} ${r.body}`).toBe('202 {}');
    const cargas = await emailsDaOutbox(id);
    expect(cargas, 'um e-mail novo na outbox').toHaveLength(antes + 1);
    return cargas.at(-1)!.dados.senha;
  };

  beforeAll(async () => {
    api = await subirApi({ email, emailReal: real.porta });
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-01
  describe('EJ-01 jornada inteira: pedido → e-mail → "Crie sua senha" → login normal', () => {
    const casos: [App, Perfil][] = [
      ['campo', 'vendedor'],
      ['gestao', 'supervisor'],
      ['web', 'analista'],
    ];
    it.each(casos)('app %s (perfil %s)', async (app, perfil) => {
      const chave = `jornada.${app}`;
      const E = EM(chave);
      const id = await novaPessoa(chave, perfil);

      // 1) pedido com o código e o e-mail como a pessoa digita (maiúsculas, espaços): 202 {} e um e-mail
      const r = await esqueci(` ${A.codigo.toUpperCase()} `, `  ${E.toUpperCase()}  `);
      expect(`${r.statusCode} ${r.body}`).toBe('202 {}');
      const cargas = await emailsDaOutbox(id);
      expect(cargas).toHaveLength(1);
      const carga = cargas[0]!;
      const anotado = await email.ultimoPara(api.admin, id);
      expect(anotado, 'a rota pediu o envio').toBeDefined();
      expect(carga).toMatchObject({ modelo: 'nova_senha', tenant_id: A.tenantId, para: E });
      // a outbox (o que sai) leva o código canônico da empresa, o login cadastrado e a mesma senha que a rota gerou
      expect(carga.dados).toMatchObject({
        motivo: 'esqueci',
        codigo_empresa: A.codigo,
        login: E,
        validade_horas: 72,
        senha: anotado!.dados.senha,
      });
      expect(carga.dados.apps).toContain(app);
      const temp = carga.dados.senha;
      expect(temp).toMatch(/^[A-Za-z2-9!@#$%&*?]{12}$/);

      // 2) o e-mail que a pessoa lê: assunto, código, e-mail, senha e o aviso de que a atual continua valendo
      const lido = renderizarEmail('nova_senha', { para: carga.para, dados: carga.dados });
      expect(lido.assunto).toBe(ASSUNTOS_EMAIL.nova_senha);
      expect(lido.texto).toContain(`Código da empresa: ${A.codigo}\n`);
      expect(lido.texto).toContain(`E-mail: ${E}\n`);
      expect(lido.texto).toContain(`Senha temporária: ${temp}\n`);
      expect(lido.texto).toContain('A senha temporária vale por 72 horas.');
      expect(lido.texto).toContain('a sua senha atual continua valendo');

      // 3) login com a temporária = 403 SENHA_A_TROCAR, sem sessão; expira_em é a validade gravada (72 h)
      const sessoesAntes = await sessoes(id);
      const d = aTrocar(await api.entrar(E, { senha: temp, app }));
      const b = await usuario(id);
      expect(d).toEqual({
        motivo: 'senha_temporaria',
        expira_em: b.senha_temporaria_expira_em!.toISOString(),
      });
      expect(b.senha_temporaria_expira_em!.getTime() - Date.now()).toBeGreaterThan(71 * HORA);
      expect(b.senha_temporaria_expira_em!.getTime() - Date.now()).toBeLessThanOrEqual(72 * HORA);
      expect(await sessoes(id)).toBe(sessoesAntes);
      expect(b.ultimo_login_em, 'o 403 não conta como login').toBeNull();

      // 4) "Crie sua senha" com a temporária: entra direto
      const criada = sessaoDe(await trocar(E, temp, SENHA_NOVA, app));
      expect(criada.usuario.email).toBe(E);

      // 5) depois: login NORMAL com a nova (sem troca), e o token funciona
      const depois = sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app }));
      expect(
        (
          await api.app.inject({
            method: 'GET',
            url: '/v1/me/modulos',
            headers: comToken(depois.access_token),
          })
        ).statusCode,
      ).toBe(200);

      // 6) a temporária e a antiga não entram mais, com o mesmo 401 de quem não existe (sem oráculo)
      const fantasma = await api.entrar(EM(`fantasma.${app}`), { senha: temp, app });
      expect(fantasma.statusCode).toBe(401);
      for (const [nome, senha] of [
        ['temporária', temp],
        ['antiga', SENHA_ATUAL],
      ] as const) {
        const x = await api.entrar(E, { senha, app });
        expect(x.statusCode, nome).toBe(401);
        expect(x.body, nome).toBe(fantasma.body);
      }
      expect(await usuario(id)).toMatchObject({
        trocar_senha: false,
        senha_expira_em: null,
        senha_temporaria_hash: null,
        senha_temporaria_expira_em: null,
      });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-02
  it('EJ-02 dados inválidos: 400 VALIDACAO igual para e-mail que existe e que não existe; nada gravado nem enviado', async () => {
    const id = await novaPessoa('invalido', 'vendedor');
    const invalidos: [string, (e: string) => object][] = [
      ['código com caractere proibido', (e) => ({ codigo_empresa: 'alfa!', email: e })],
      ['código vazio', (e) => ({ codigo_empresa: '', email: e })],
      ['sem e-mail', () => ({ codigo_empresa: A.codigo })],
      ['campo a mais', (e) => ({ codigo_empresa: A.codigo, email: e, senha: SENHA_ATUAL })],
    ];
    for (const [nome, corpo] of invalidos) {
      const existe = await post('/v1/auth/senha/esqueci', corpo(EM('invalido')));
      const naoExiste = await post('/v1/auth/senha/esqueci', corpo(EM('ninguem.invalido')));
      expect(`${existe.statusCode} ${erroDe(existe).codigo}`, nome).toBe('400 VALIDACAO');
      expect(existe.body, nome).toBe(naoExiste.body);
    }
    expect(await emailsDaOutbox(id)).toEqual([]);
    expect((await usuario(id)).senha_temporaria_hash).toBeNull();
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-03
  it('EJ-03 temporária vencida: 410 no login e na troca, sem sessão; pedir outra recupera o acesso e a vencida morre', async () => {
    const E = EM('vencida');
    const id = await novaPessoa('vencida', 'vendedor');
    const temp1 = await pedirTemporaria(id, E);
    // 72 h depois (posto no banco: o JWT segue o relógio real)
    await api.admin.query(
      "update core.usuario set senha_temporaria_criada_em = now() - interval '72 hours', senha_temporaria_expira_em = now() - interval '1 second' where id = $1",
      [id],
    );
    const sessoesAntes = await sessoes(id);
    for (const r of [
      await api.entrar(E, { senha: temp1, app: 'campo' }),
      await trocar(E, temp1, SENHA_NOVA, 'campo'),
    ]) {
      expect(`${r.statusCode} ${erroDe(r).codigo}`, r.body).toBe(`410 ${CODIGOS_AUTH.senhaVencida}`);
      expect(erroDe(r).mensagem).toBe(MENSAGEM_SENHA_VENCIDA);
      expect(r.body).not.toMatch(/access_token|refresh_token/);
    }
    expect(await sessoes(id)).toBe(sessoesAntes);
    expect((await usuario(id)).trocar_senha, 'a troca recusada não gravou nada').toBe(false);

    // o 410 manda pedir outra: o pedido gera outra senha, que entra; a vencida vira credencial errada
    const temp2 = await pedirTemporaria(id, E);
    expect(temp2).not.toBe(temp1);
    expect((await api.entrar(E, { senha: temp1, app: 'campo' })).statusCode).toBe(401);
    expect(aTrocar(await api.entrar(E, { senha: temp2, app: 'campo' })).motivo).toBe('senha_temporaria');
    sessaoDe(await trocar(E, temp2, SENHA_NOVA, 'campo'));
    sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-04
  it('EJ-04 senha inicial vencida (primeiro acesso): 410 manda usar o "Esqueci", que recupera o acesso', async () => {
    const E = EM('inicial');
    const id = await novaPessoa('inicial', 'promotor');
    await api.admin.query(
      "update core.usuario set trocar_senha = true, senha_expira_em = now() - interval '1 hour' where id = $1",
      [id],
    );
    const r = await api.entrar(E, { senha: SENHA_ATUAL, app: 'campo' });
    expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe(`410 ${CODIGOS_AUTH.senhaVencida}`);
    expect(erroDe(r).mensagem).toContain('Esqueci a senha');

    const temp = await pedirTemporaria(id, E);
    expect(aTrocar(await api.entrar(E, { senha: temp, app: 'campo' })).motivo).toBe('senha_temporaria');
    sessaoDe(await trocar(E, temp, SENHA_NOVA, 'campo'));
    sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
    expect(
      (await api.entrar(E, { senha: SENHA_ATUAL, app: 'campo' })).statusCode,
      'a inicial vencida não volta',
    ).toBe(401);
    expect(await usuario(id)).toMatchObject({
      trocar_senha: false,
      senha_expira_em: null,
      senha_temporaria_hash: null,
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-05
  it('EJ-05 bloqueado por 5 senhas erradas: o e-mail sai; a temporária dá 423 enquanto o bloqueio dura e entra depois dele', async () => {
    const E = EM('bloqueio');
    const id = await novaPessoa('bloqueio', 'vendedor');
    for (let i = 0; i < 5; i++)
      expect(
        (await api.entrar(E, { senha: `Errada#${i}-Esqueci`, app: 'campo' })).statusCode,
        `falha ${i + 1}`,
      ).toBe(401);
    expect((await usuario(id)).bloqueio_ate, 'a 5ª falha bloqueia por 15 min').not.toBeNull();

    const temp = await pedirTemporaria(id, E);
    const r = await api.entrar(E, { senha: temp, app: 'campo' });
    expect(`${r.statusCode} ${erroDe(r).codigo}`, r.body).toBe(`423 ${CODIGOS_AUTH.bloqueado}`);
    expect(r.body).not.toMatch(/access_token|refresh_token/);

    // passados os 15 min (posto no banco), a mesma temporária segue a jornada e a troca zera as falhas
    await api.admin.query(
      "update core.usuario set bloqueio_ate = now() - interval '1 second' where id = $1",
      [id],
    );
    aTrocar(await api.entrar(E, { senha: temp, app: 'campo' }));
    sessaoDe(await trocar(E, temp, SENHA_NOVA, 'campo'));
    expect(await usuario(id)).toMatchObject({ tentativas_falhas: 0, bloqueio_ate: null });
    sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-06
  it('EJ-06 toque duplo (3 pedidos simultâneos do mesmo usuário): um e-mail só, e a senha que ele leva entra', async () => {
    const E = EM('toque.duplo');
    const id = await novaPessoa('toque.duplo', 'vendedor');
    const rs = await Promise.all([0, 1, 2].map(() => esqueci(A.codigo, E)));
    for (const r of rs) expect(`${r.statusCode} ${r.body}`).toBe('202 {}');
    const cargas = await emailsDaOutbox(id);
    // toda senha que chegou por e-mail tem de entrar (senão a pessoa recebe uma senha que não funciona)
    const resultado = await Promise.all(
      cargas.map(async (c) => (await api.entrar(E, { senha: c.dados.senha, app: 'campo' })).statusCode),
    );
    expect(resultado, 'cada senha enviada por e-mail leva a "Crie sua senha" (403)').toEqual(
      cargas.map(() => 403),
    );
    expect(cargas, 'pedidos dentro de 15 min: um e-mail só').toHaveLength(1);
  });
});
