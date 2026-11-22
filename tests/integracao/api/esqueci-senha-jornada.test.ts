/**
 * "Esqueci a senha" de ponta a ponta (R-20261114-204500-alexandre; T-0094, ADR 0032 com o adendo de 19/11/2026, RN-CORE-32/34).
 * Matriz: docs/testes/esqueci-senha-r20261114.md. API real + Postgres + porta REAL de e-mail (carga cifrada na outbox) e, no
 * EJ-01, o despachante REAL com a configuração lida de `MACUXI_EMAIL_URL_ATIVOS` e `MACUXI_EMAIL_URL_BKO` (o `.eml` que sai).
 *  - EJ-01 jornada por app (Campo, Gestão, BKO): pedido → e-mail "Crie a sua senha …" com código, e-mail, senha, validade, logo e
 *          (só no BKO) "Abrir o backoffice" → login com a temporária = 403 SENHA_A_TROCAR → troca → login normal;
 *  - EJ-02 dados inválidos: 400 VALIDACAO igual para e-mail que existe e que não existe; nada gravado nem enviado;
 *  - EJ-03 temporária vencida: 410 no login e na troca; outro pedido recupera o acesso;
 *  - EJ-04 senha inicial vencida: o 410 manda usar o "Esqueci", que recupera o acesso;
 *  - EJ-05 bloqueado por 5 senhas erradas: o e-mail sai; a temporária = 423 até o bloqueio passar;
 *  - EJ-06 três pedidos simultâneos: um e-mail só, e a senha dele entra.
 * Vencimento e bloqueio são postos direto no banco (o JWT segue o relógio real).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODIGOS_AUTH,
  DetalhesSenhaATrocarSchema,
  MENSAGEM_SENHA_VENCIDA,
  SessaoRespostaSchema,
  type SessaoResposta,
} from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { Perfil } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarCifraEmail, lerConfigEmail } from '../../../apps/api/src/email';
import { A, comToken, erroDe, novoIp, SEGREDO_JWT, subirApi, type ApiDeTeste } from '../apoio/api';
import {
  cargaDaOutbox,
  criarEspiaoEmail,
  despacharParaArquivo,
  lerArquivosEmail,
  logEmMemoria,
  outboxDeEmail,
  portaRealDeTeste,
} from '../apoio/email';
import { criarUsuarioNoTenant } from '../apoio/portal';

/** E-mails fictícios (domínio de exemplo) e senhas na RN-CORE-32. */
const EM = (x: string) => `${x}.esqueci@exemplo.com.br`;
const SENHA_ATUAL = 'Atual#Esqueci-a1';
const SENHA_NOVA = 'Criada#Esqueci-b2';
/** Endereços públicos fictícios das `MACUXI_EMAIL_URL_*` (adendo de 19/11 da ADR 0032). */
const URL_ATIVOS = 'https://ativos.exemplo.com.br/email/';
const URL_BKO = 'https://bko.exemplo.com.br/entrar';

type App = 'campo' | 'gestao' | 'web';

describe.skipIf(semBanco())('"Esqueci a senha" de ponta a ponta (R-20261114-204500; RN-CORE-34)', () => {
  let api: ApiDeTeste;
  let pasta: string;
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
  /** O que a outbox guarda para o usuário (carga decifrada com a chave da porta real), com o id da linha. */
  const emailsDaOutbox = async (id: string) => {
    const linhas = (await outboxDeEmail(api.admin)).filter(
      (l) => l.usuario_id === id && l.modelo === 'nova_senha',
    );
    return Promise.all(
      linhas.map(async (l) => ({ id: l.id, ...(await cargaDaOutbox(api.admin, l.id, real.cifra)) })),
    );
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
    pasta = await mkdtemp(join(tmpdir(), 'macuxi-esqueci-'));
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
    if (pasta) await rm(pasta, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------------------------------------------------------ EJ-01
  describe('EJ-01 jornada inteira: pedido → e-mail "Crie a sua senha" → troca → login normal', () => {
    const casos: [App, Perfil, string][] = [
      ['campo', 'vendedor', 'no app Macuxi Campo'],
      ['gestao', 'supervisor', 'no app Macuxi Gestão'],
      ['web', 'analista', 'no backoffice'],
    ];
    it.each(casos)('app %s (perfil %s)', async (app, perfil, onde) => {
      const chave = `jornada.${app}`;
      const E = EM(chave);
      const id = await novaPessoa(chave, perfil);

      // 1) pedido com o código e o e-mail como a pessoa digita (maiúsculas, espaços): 202 {} e um e-mail na outbox
      const r = await esqueci(` ${A.codigo.toUpperCase()} `, `  ${E.toUpperCase()}  `);
      expect(`${r.statusCode} ${r.body}`).toBe('202 {}');
      const cargas = await emailsDaOutbox(id);
      expect(cargas).toHaveLength(1);
      const carga = cargas[0]!;
      const anotado = await email.ultimoPara(api.admin, id);
      expect(anotado, 'a rota pediu o envio').toBeDefined();
      expect(carga).toMatchObject({ modelo: 'nova_senha', tenant_id: A.tenantId, para: E });
      expect(carga.dados).toMatchObject({
        motivo: 'esqueci',
        codigo_empresa: A.codigo,
        login: E,
        validade_horas: 72,
        apps: [app],
        senha: anotado!.dados.senha,
      });
      const temp = carga.dados.senha;
      expect(temp).toMatch(/^[A-Za-z2-9!@#$%&*?]{12}$/);

      // 2) o e-mail que sai: despachante real com a configuração das MACUXI_EMAIL_URL_* (logo e botão do backoffice)
      const cfg = lerConfigEmail({
        NODE_ENV: 'test',
        MACUXI_EMAIL_TRANSPORTE: 'arquivo',
        MACUXI_EMAIL_ARQUIVO_DIR: pasta,
        MACUXI_EMAIL_URL_ATIVOS: URL_ATIVOS,
        MACUXI_EMAIL_URL_BKO: URL_BKO,
        MACUXI_JWT_SEGREDO: SEGREDO_JWT,
      });
      if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o EJ-01 precisa do despachante');
      await despacharParaArquivo({
        urlWorker: api.banco.urlWorker,
        cifra: criarCifraEmail(cfg.chave),
        pasta: cfg.pasta,
        log: logEmMemoria(linhasLog),
        apresentacao: cfg.apresentacao,
      });
      const eml = (await lerArquivosEmail(pasta)).filter((a) => a.id === carga.id);
      expect(eml, 'um .eml para a linha da outbox').toHaveLength(1);
      const { texto, html } = eml[0]!;
      expect(texto).toContain(`Crie a sua senha ${onde}\n`);
      expect(texto).toContain(`\nSenha temporária\n${temp}\n`);
      expect(html).toContain(`src="${URL_ATIVOS}macuxi-logo-positivo-email.png"`);
      if (app === 'web') expect(html).toContain(`href="${URL_BKO}"`);
      else expect(html).not.toContain('Abrir o backoffice');

      // 3) login com a temporária = 403 SENHA_A_TROCAR, sem sessão; expira_em é a validade gravada
      const sessoesAntes = await sessoes(id);
      const d = aTrocar(await api.entrar(E, { senha: temp, app }));
      const b = await usuario(id);
      expect(d).toEqual({
        motivo: 'senha_temporaria',
        expira_em: b.senha_temporaria_expira_em!.toISOString(),
      });
      expect(await sessoes(id)).toBe(sessoesAntes);
      expect(b.ultimo_login_em, 'o 403 não conta como login').toBeNull();

      // 4) "Crie sua senha" com a temporária: entra direto
      const criada = sessaoDe(await trocar(E, temp, SENHA_NOVA, app));
      expect(criada.usuario.email).toBe(E);

      // 5) depois: login NORMAL com a nova, e o token funciona
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
    const minutos = (erroDe(r).detalhes as { minutos_restantes?: number } | undefined)?.minutos_restantes;
    expect(minutos, 'o 423 do bloqueio por tentativas traz o tempo').toBeGreaterThanOrEqual(1);
    expect(minutos).toBeLessThanOrEqual(15);
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
    expect(cargas, 'pedidos dentro de 15 min: um e-mail só').toHaveLength(1);
    expect(aTrocar(await api.entrar(E, { senha: cargas[0]!.dados.senha, app: 'campo' })).motivo).toBe(
      'senha_temporaria',
    );
  });
});
