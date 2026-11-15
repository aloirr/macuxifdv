/**
 * T-0176 — RN-CORE-39 revista (R-20261115-073000 e R-20261115-080000): filial do usuário pela API REAL (`createApp` com os 8 módulos,
 * JWT de verdade, Postgres como `macuxi_app` com RLS, despachante real da outbox e o Conector simulado em `/integracao/v1`), na fixture
 * dois-tenants num banco efêmero próprio do arquivo. Matriz: docs/testes/T-0176.md. Banco só no CI (sem Docker na sessão).
 *
 * Texto da regra (docs/produto/03, RN-CORE-39, "Filial do usuário"): vendedor com exatamente UMA filial, obrigatória; supervisor, promotor
 * e gerente com várias; quem informa é o admin no BKO (Usuários) ou a carga do ERP; vendedor sem filial fica BLOQUEADO no app até a
 * filial ser informada, inclusive quem já existe; não há filial padrão provisória.
 *
 * DEPENDE DE MERGE (sem pulo silencioso: o nome de cada bloco diz o que espera; tests/modulos/apoio/estado-prs.ts):
 *  - blocos A, E, C, M, P, B: `FILIAL_USUARIO` = `nuvem/filial-usuario-modulo-core` (API) + `nuvem/filial-usuario-banco-dados` (0077 e
 *    fixture: vendedor-1 e supervisor de A com filial, vendedor-2 SEM filial, vendedor-B na Campinas). A 0077 só entra depois da
 *    0070–0076 no main (o migrador recusa buraco na numeração);
 *  - bloco H: também `VENDEDOR_FILIAL_HUB` = `nuvem/marca-codigo-modulo-integracao` (`filial_external_id` do vendedor no Hub).
 *
 * Casos:
 *  A  (critério a, BKO/API) criar vendedor com 0 ou 2 filiais = 422 USUARIO_FILIAL_QUANTIDADE com frase clara e nada gravado; com 1 = 201;
 *     a mesma filial repetida conta uma; filial de outro tenant ou inexistente = 422 USUARIO_FILIAL_INVALIDA.
 *  E  (critério a, edição) vendedor com 2 ou 0 = 422 e nada muda; troca de 1 por 1 = 200; supervisor com 2 filiais que vira vendedor = 422
 *     sem escolher uma; com uma = 200.
 *  C  (critério c) supervisor, promotor e gerente com várias filiais = 201; com nenhuma = 422 (o Core exige 1 ou mais; a RN diz "várias");
 *     admin e analista sem filial = 201.
 *  M  (multi-tenant) o admin de B não usa filial de A; nada de B aparece em A.
 *  P  (perfis) só quem tem `usuario.editar` chega à rota (analista e gerente de fábrica = 403 PERFIL_SEM_ACESSO; supervisor, vendedor e
 *     promotor = 403 PERFIL_SEM_BKO); D-T0176-2 (`it.fails`): perfil com `usuario.criar` concedido pelo tenant não consegue criar vendedor.
 *  B  (critério b) login do vendedor sem filial devolve `sem_filial: true` (o app bloqueia); o pull `usuario` e a lista do BKO também
 *     marcam; quem tem filial e quem não é vendedor (promotor sem filial) não; informada a filial, o bloqueio sai.
 *     D-T0176-1 (`it.fails`): a API não nega a escrita do vendedor sem filial (APK antigo ignora `sem_filial`).
 *     D-T0176-3 (`it.fails`): a importação de equipe por CSV do BKO cria vendedor sem filial, sem erro.
 *  H  (critério a, carga do Hub) vendedor com filial grava a filial; sem filial (ausente ou null) ENTRA com o aviso `vendedor_sem_filial` e
 *     fica bloqueado (a RN manda bloquear, não recusar; o admin informa no BKO); filial que não existe = linha `referencia_ausente`
 *     (reprocessável) e nada gravado; 2 filiais na linha = linha inválida no campo `filial_external_id`; a recarga troca a filial (fica 1);
 *     filial só de outro tenant = `referencia_ausente`. D-T0176-4 (`it.fails`): o aviso "bloqueado" sai também para quem já tem filial.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { FILIAL_USUARIO, VENDEDOR_FILIAL_HUB } from '../../modulos/apoio/estado-prs';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const SENHA_T = 'Filial#Vend-2026';
const EM = (x: string) => `${x}.t0176@exemplo.com.br`;
const ESPERA_CORE_BANCO = 'aguarda merge: nuvem/filial-usuario-modulo-core + nuvem/filial-usuario-banco-dados (0077 depois da 0070–0076)';
const ESPERA_HUB = 'aguarda merge também de nuvem/marca-codigo-modulo-integracao';
const QUANTIDADE = 'USUARIO_FILIAL_QUANTIDADE';
const INVALIDA = 'USUARIO_FILIAL_INVALIDA';
const FRASE_VENDEDOR = 'Escolha a filial do vendedor.';
const FRASE_AO_MENOS_UMA = 'Escolha ao menos uma filial.';
/** CNPJ e endereço fictícios válidos (o mesmo do teste do Hub, modules/integracao/domain/filial.test.ts). */
const ENDERECO_FILIAL = { cnpj: '11.222.333/0001-81', logradouro: 'Av. Ville Roy', numero: '1500', bairro: 'Centro', cep: '69301-000', cidade: 'Boa Vista', uf: 'RR' };
const VERSAO_CONECTOR = '1.2.0';
const IP = { A: '198.51.100.76', B: '203.0.113.76' } as const;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface ItemUsuario {
  id: string;
  email: string;
  external_id: string | null;
  filial_ids?: string[];
  sem_filial?: boolean;
}
interface ErroLinha {
  indice: number;
  external_id: string | null;
  codigo: string;
  campo: string | null;
  mensagem: string;
  reprocessavel: boolean;
}
interface ResultadoLote {
  status: string;
  erros: ErroLinha[];
  avisos: { external_id: string; codigo: string; mensagem: string }[];
}

describe.skipIf(semBanco())('T-0176 RN-CORE-39 filial do usuário pela API real (createApp × Postgres × Hub)', () => {
  describe.runIf(FILIAL_USUARIO)(`RN-CORE-39 [${ESPERA_CORE_BANCO}]`, () => {
    let api: ApiDeTeste;
    let worker: pg.Pool | null = null;
    const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
    const tk = { admin: '', adminB: '', analista: '', gerente: '', supervisor: '', vendedor1: '', promotor: '' };
    const F = { padrao: '', boaVista: '', padraoB: '', campinasB: '' };

    const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
    const fora = (r: LightMyRequestResponse) => {
      try {
        return `${r.statusCode} ${erroDe(r).codigo}`;
      } catch {
        return `${r.statusCode} -`;
      }
    };
    const criar = (token: string, corpo: Record<string, unknown>) =>
      api.chamar(token, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Pessoa Fictícia T0176', senha: SENHA_T, ...corpo } });
    const editar = (token: string, id: string, corpo: Record<string, unknown>) => api.chamar(token, { method: 'PUT', url: `/v1/core/usuarios/${id}`, payload: corpo });
    const filiaisNoBanco = async (usuarioId: string) =>
      (await q<{ filial_id: string }>('select filial_id::text from core.usuario_filial where usuario_id = $1 and deleted_at is null order by filial_id', [usuarioId])).map((l) => l.filial_id);
    const usuarioPorEmail = async (email: string) => (await q<{ id: string }>('select id::text from core.usuario where lower(email) = lower($1) and deleted_at is null', [email]))[0]?.id;
    const ordenadas = (...ids: string[]) => [...ids].sort();
    const listaDoBko = async (token: string): Promise<ItemUsuario[]> => {
      const r = await api.chamar(token, { method: 'GET', url: '/v1/core/usuarios' });
      expect(r.statusCode, r.body).toBe(200);
      return (r.json() as { itens: ItemUsuario[] }).itens;
    };
    const login = async (email: string, tenant: Tenant = A) => {
      const r = await api.entrar(email, { tenant });
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as { access_token: string; usuario: { id: string; sem_filial?: boolean } };
    };
    const linhaDoPull = async (token: string, usuarioId: string) => {
      const r = await api.chamar(token, { method: 'GET', url: '/v1/sync/pull?entidade=usuario' });
      expect(r.statusCode, r.body).toBe(200);
      return (r.json() as { itens: { id: string; filial_id?: string | null; sem_filial?: boolean }[] }).itens.find((l) => l.id === usuarioId);
    };

    beforeAll(async () => {
      process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
      api = await subirApi();
      tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
      tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
      tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
      tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
      tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
      tk.vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
      tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
      const filiais = await q<{ id: string; tenant_id: string; padrao: boolean; codigo: string }>('select id::text, tenant_id::text, padrao, codigo from core.filial where deleted_at is null');
      F.padrao = filiais.find((f) => f.tenant_id === A.tenantId && f.padrao)!.id;
      F.boaVista = filiais.find((f) => f.tenant_id === A.tenantId && f.codigo === '0002')!.id;
      F.padraoB = filiais.find((f) => f.tenant_id === B.tenantId && f.padrao)!.id;
      F.campinasB = filiais.find((f) => f.tenant_id === B.tenantId && !f.padrao)!.id;
    }, 300_000);

    afterAll(async () => {
      if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
      else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
      await worker?.end().catch(() => undefined);
      await api?.fechar();
    });

    it('fixture da 0077 (premissa dos casos): vendedor-1 na padrão, supervisor na padrão e na Boa Vista, vendedor-2 e promotor sem filial, vendedor-B na Campinas', async () => {
      expect(await filiaisNoBanco(A.usuarios.vendedor1)).toEqual([F.padrao]);
      expect(await filiaisNoBanco(A.usuarios.supervisor)).toEqual(ordenadas(F.padrao, F.boaVista));
      expect(await filiaisNoBanco(A.usuarios.vendedor2)).toEqual([]);
      expect(await filiaisNoBanco(A.usuarios.promotor)).toEqual([]);
      expect(await filiaisNoBanco(B.usuarios.vendedor)).toEqual([F.campinasB]);
    });

    // ------------------------------------------------------------------------------------------- A. criação pelo BKO
    describe('A. criação pelo BKO/API (critério a): o vendedor nasce com exatamente uma filial', () => {
      it.each([
        ['sem filial_ids', {}],
        ['filial_ids vazio', { filial_ids: [] as string[] }],
      ] as const)('RN-CORE-39: vendedor %s = 422 USUARIO_FILIAL_QUANTIDADE "Escolha a filial do vendedor."; ninguém gravado', async (rotulo, extra) => {
        const email = EM(`a-zero-${rotulo.length}`);
        const r = await criar(tk.admin, { email, perfil: 'vendedor', ...extra });
        expect(fora(r), r.body).toBe(`422 ${QUANTIDADE}`);
        expect(erroDe(r).mensagem).toBe(FRASE_VENDEDOR);
        expect(await usuarioPorEmail(email)).toBeUndefined();
      });

      it('RN-CORE-39: vendedor com 2 filiais = 422 USUARIO_FILIAL_QUANTIDADE com a mesma frase; ninguém gravado', async () => {
        const email = EM('a-duas');
        const r = await criar(tk.admin, { email, perfil: 'vendedor', filial_ids: [F.padrao, F.boaVista] });
        expect(fora(r), r.body).toBe(`422 ${QUANTIDADE}`);
        expect(erroDe(r).mensagem).toBe(FRASE_VENDEDOR);
        expect(await usuarioPorEmail(email)).toBeUndefined();
      });

      it('RN-CORE-39: vendedor com 1 filial = 201; a resposta, a lista do BKO e o banco têm só ela; sem_filial falso', async () => {
        const email = EM('a-uma');
        const r = await criar(tk.admin, { email, perfil: 'vendedor', filial_ids: [F.boaVista] });
        expect(r.statusCode, r.body).toBe(201);
        const criado = r.json() as ItemUsuario;
        expect(criado).toMatchObject({ filial_ids: [F.boaVista], sem_filial: false });
        expect(await filiaisNoBanco(criado.id)).toEqual([F.boaVista]);
        expect((await listaDoBko(tk.admin)).find((u) => u.id === criado.id)).toMatchObject({ filial_ids: [F.boaVista], sem_filial: false });
      });

      it('RN-CORE-39: a mesma filial repetida conta uma vez (201 com 1 vínculo)', async () => {
        const r = await criar(tk.admin, { email: EM('a-repetida'), perfil: 'vendedor', filial_ids: [F.padrao, F.padrao] });
        expect(r.statusCode, r.body).toBe(201);
        expect(await filiaisNoBanco((r.json() as ItemUsuario).id)).toEqual([F.padrao]);
      });

      it.each([
        ['de outro tenant (padrão de B)', () => F.padraoB],
        ['que não existe', () => randomUUID()],
      ])('RN-CORE-39 (multi-tenant): filial %s = 422 USUARIO_FILIAL_INVALIDA; ninguém gravado', async (_rotulo, filial) => {
        const email = EM(`a-invalida-${randomUUID().slice(0, 6)}`);
        const r = await criar(tk.admin, { email, perfil: 'vendedor', filial_ids: [filial()] });
        expect(fora(r), r.body).toBe(`422 ${INVALIDA}`);
        expect(erroDe(r).mensagem.length, 'frase para a pessoa').toBeGreaterThan(0);
        expect(await usuarioPorEmail(email)).toBeUndefined();
      });
    });

    // ------------------------------------------------------------------------------------------- E. edição pelo BKO
    describe('E. edição pelo BKO/API (critério a)', () => {
      let vendedor = '';
      beforeAll(async () => {
        const r = await criar(tk.admin, { email: EM('e-vendedor'), perfil: 'vendedor', filial_ids: [F.padrao] });
        expect(r.statusCode, r.body).toBe(201);
        vendedor = (r.json() as ItemUsuario).id;
      });

      it.each([
        ['2 filiais', () => [F.padrao, F.boaVista]],
        ['nenhuma filial', () => [] as string[]],
      ])('RN-CORE-39: vendedor editado para %s = 422 USUARIO_FILIAL_QUANTIDADE; a filial gravada não muda', async (_rotulo, filiais) => {
        const r = await editar(tk.admin, vendedor, { filial_ids: filiais() });
        expect(fora(r), r.body).toBe(`422 ${QUANTIDADE}`);
        expect(erroDe(r).mensagem).toBe(FRASE_VENDEDOR);
        expect(await filiaisNoBanco(vendedor)).toEqual([F.padrao]);
      });

      it('RN-CORE-39: troca de uma filial por outra = 200; fica só a nova (a antiga vira soft delete)', async () => {
        const r = await editar(tk.admin, vendedor, { filial_ids: [F.boaVista] });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toMatchObject({ filial_ids: [F.boaVista], sem_filial: false });
        expect(await filiaisNoBanco(vendedor)).toEqual([F.boaVista]);
        const apagada = await q('select 1 from core.usuario_filial where usuario_id = $1 and filial_id = $2 and deleted_at is not null', [vendedor, F.padrao]);
        expect(apagada).toHaveLength(1);
      });

      it('RN-CORE-39: supervisor com 2 filiais que vira vendedor sem escolher uma = 422; escolhendo uma = 200 com 1 filial', async () => {
        const c = await criar(tk.admin, { email: EM('e-sup-vira-vend'), perfil: 'supervisor', filial_ids: [F.padrao, F.boaVista] });
        expect(c.statusCode, c.body).toBe(201);
        const id = (c.json() as ItemUsuario).id;
        const sem = await editar(tk.admin, id, { perfil: 'vendedor' });
        expect(fora(sem), sem.body).toBe(`422 ${QUANTIDADE}`);
        expect(await filiaisNoBanco(id)).toEqual(ordenadas(F.padrao, F.boaVista));
        const com = await editar(tk.admin, id, { perfil: 'vendedor', filial_ids: [F.boaVista] });
        expect(com.statusCode, com.body).toBe(200);
        expect(await filiaisNoBanco(id)).toEqual([F.boaVista]);
      });
    });

    // ------------------------------------------------------------------------------------------- C. várias filiais
    describe('C. supervisor, promotor e gerente têm várias filiais (critério c)', () => {
      it.each(['supervisor', 'promotor', 'gerente'] as const)('RN-CORE-39: %s com 2 filiais = 201 e as 2 no banco e na lista do BKO', async (perfil) => {
        const r = await criar(tk.admin, { email: EM(`c-${perfil}-duas`), perfil, filial_ids: [F.padrao, F.boaVista] });
        expect(r.statusCode, r.body).toBe(201);
        const id = (r.json() as ItemUsuario).id;
        expect(await filiaisNoBanco(id)).toEqual(ordenadas(F.padrao, F.boaVista));
        const item = (await listaDoBko(tk.admin)).find((u) => u.id === id);
        expect(ordenadas(...(item?.filial_ids ?? []))).toEqual(ordenadas(F.padrao, F.boaVista));
        expect(item?.sem_filial).toBe(false);
      });

      it.each(['supervisor', 'promotor', 'gerente'] as const)('RN-CORE-39: %s com 1 filial = 201; editado para 2 = 200', async (perfil) => {
        const r = await criar(tk.admin, { email: EM(`c-${perfil}-uma`), perfil, filial_ids: [F.padrao] });
        expect(r.statusCode, r.body).toBe(201);
        const id = (r.json() as ItemUsuario).id;
        const e = await editar(tk.admin, id, { filial_ids: [F.padrao, F.boaVista] });
        expect(e.statusCode, e.body).toBe(200);
        expect(await filiaisNoBanco(id)).toEqual(ordenadas(F.padrao, F.boaVista));
      });

      it.each(['supervisor', 'promotor', 'gerente'] as const)('RN-CORE-39 (Core: 1 ou mais): %s sem filial = 422 "Escolha ao menos uma filial."', async (perfil) => {
        const email = EM(`c-${perfil}-zero`);
        const r = await criar(tk.admin, { email, perfil });
        expect(fora(r), r.body).toBe(`422 ${QUANTIDADE}`);
        expect(erroDe(r).mensagem).toBe(FRASE_AO_MENOS_UMA);
        expect(await usuarioPorEmail(email)).toBeUndefined();
      });

      it.each(['admin', 'analista'] as const)('RN-CORE-39: %s (administrativo) sem filial = 201', async (perfil) => {
        const r = await criar(tk.admin, { email: EM(`c-${perfil}-zero`), perfil });
        expect(r.statusCode, r.body).toBe(201);
        expect(await filiaisNoBanco((r.json() as ItemUsuario).id)).toEqual([]);
      });
    });

    // ------------------------------------------------------------------------------------------- M. multi-tenant
    describe('M. isolamento multi-tenant', () => {
      it('RN-CORE-39: o admin de B não põe a filial de A no vendedor de B (422 USUARIO_FILIAL_INVALIDA); a Campinas segue', async () => {
        const r = await editar(tk.adminB, B.usuarios.vendedor, { filial_ids: [F.padrao] });
        expect(fora(r), r.body).toBe(`422 ${INVALIDA}`);
        expect(await filiaisNoBanco(B.usuarios.vendedor)).toEqual([F.campinasB]);
      });

      it('RN-CORE-39: a lista do BKO de B mostra a filial do vendedor de B e nenhuma filial de A; a de A não mostra as de B', async () => {
        const deB = await listaDoBko(tk.adminB);
        expect(deB.find((u) => u.id === B.usuarios.vendedor)?.filial_ids).toEqual([F.campinasB]);
        const filiaisVistasB = new Set(deB.flatMap((u) => u.filial_ids ?? []));
        expect(filiaisVistasB.has(F.padrao) || filiaisVistasB.has(F.boaVista)).toBe(false);
        const filiaisVistasA = new Set((await listaDoBko(tk.admin)).flatMap((u) => u.filial_ids ?? []));
        expect(filiaisVistasA.has(F.padraoB) || filiaisVistasA.has(F.campinasB)).toBe(false);
      });
    });

    // ------------------------------------------------------------------------------------------- P. perfis
    describe('P. quem informa a filial: o admin no BKO (perfis)', () => {
      it.each([
        ['analista', () => tk.analista, 'PERFIL_SEM_ACESSO'],
        ['gerente', () => tk.gerente, 'PERFIL_SEM_ACESSO'],
        ['supervisor', () => tk.supervisor, 'PERFIL_SEM_BKO'],
        ['vendedor', () => tk.vendedor1, 'PERFIL_SEM_BKO'],
        ['promotor', () => tk.promotor, 'PERFIL_SEM_BKO'],
      ])('RN-CORE-39: %s não troca a filial do vendedor (403 %s); nada muda', async (_quem, token, codigo) => {
        const r = await editar(token(), A.usuarios.vendedor1, { filial_ids: [F.boaVista] });
        expect(fora(r), r.body).toBe(`403 ${codigo}`);
        expect(await filiaisNoBanco(A.usuarios.vendedor1)).toEqual([F.padrao]);
      });

      describe('perfil com `usuario.criar` concedido pelo tenant (ADR 0033: decide a permissão, não o nome do perfil)', () => {
        beforeAll(async () => {
          const gerentePerfil = (await q<{ id: string }>("select id::text from plataforma.perfil where tenant_id = $1 and codigo = 'gerente' and deleted_at is null", [A.tenantId]))[0]!.id;
          await api.admin.query('insert into plataforma.perfil_permissao (id, tenant_id, perfil_id, chave, concedida, nivel, alvos, external_id) values ($1, $2, $3, $4, true, null, null, null)', [
            randomUUID(),
            A.tenantId,
            gerentePerfil,
            'usuario.criar',
          ]);
        });

        it('controle: o gerente com `usuario.criar` concedido cria um analista (sem filial) = 201', async () => {
          const r = await criar(tk.gerente, { email: EM('p-gerente-cria-analista'), perfil: 'analista' });
          expect(r.statusCode, r.body).toBe(201);
        });

        // D-T0176-2: modules/core/api/filiais-usuario.ts `exigirQuemEditaFilial(ctx.usuario.perfil)` compara o NOME do perfil com
        // ['admin', 'analista'] (PERFIS_QUE_EDITAM_FILIAL); sem `filial_ids` o vendedor dá 422, com ela 403: o vendedor nunca nasce.
        it.fails('D-T0176-2 RN-CORE-39 × ADR 0033: o gerente com `usuario.criar` concedido cria vendedor com a filial = 201 (hoje 403 USUARIO_FILIAL_SEM_PERMISSAO)', async () => {
          const r = await criar(tk.gerente, { email: EM('p-gerente-cria-vendedor'), perfil: 'vendedor', filial_ids: [F.padrao] });
          expect(r.statusCode, r.body).toBe(201);
        });
      });
    });

    // ------------------------------------------------------------------------------------------- B. bloqueio
    describe('B. vendedor sem filial fica bloqueado (critério b)', () => {
      it('RN-CORE-39: o login do vendedor sem filial (vendedor-2, já existente) devolve sem_filial: true; o de quem tem filial, não', async () => {
        expect((await login('vendedor2@exemplo.com.br')).usuario.sem_filial).toBe(true);
        expect((await login('vendedor@exemplo.com.br')).usuario.sem_filial ?? false).toBe(false);
      });

      it('RN-CORE-39: só o vendedor bloqueia — promotor sem filial e supervisor não recebem sem_filial', async () => {
        expect(await filiaisNoBanco(A.usuarios.promotor)).toEqual([]);
        expect((await login('promotor@exemplo.com.br')).usuario.sem_filial ?? false).toBe(false);
        expect((await login('supervisor@exemplo.com.br')).usuario.sem_filial ?? false).toBe(false);
      });

      it('RN-CORE-39: o pull `usuario` do aparelho (quem já está logado) marca sem_filial e filial_id nulo; o vendedor-1 recebe a filial dele', async () => {
        const v2 = await login('vendedor2@exemplo.com.br');
        expect(await linhaDoPull(v2.access_token, A.usuarios.vendedor2)).toMatchObject({ filial_id: null, sem_filial: true });
        expect(await linhaDoPull(tk.vendedor1, A.usuarios.vendedor1)).toMatchObject({ filial_id: F.padrao, sem_filial: false });
      });

      it('RN-CORE-39: a lista do BKO marca o vendedor sem filial (sem_filial: true, filial_ids vazio)', async () => {
        const itens = await listaDoBko(tk.admin);
        expect(itens.find((u) => u.id === A.usuarios.vendedor2)).toMatchObject({ filial_ids: [], sem_filial: true });
        expect(itens.find((u) => u.id === A.usuarios.vendedor1)).toMatchObject({ filial_ids: [F.padrao], sem_filial: false });
      });

      // D-T0176-1: nenhuma rota confere a filial (vendedorSemFilial só é chamado no login, modules/core/api/autenticacao.ts). O APK
      // antigo não conhece `sem_filial` e segue gravando; regra 2 do CLAUDE.md: "a API sempre revalida".
      it.fails('D-T0176-1 RN-CORE-39: a API nega a escrita do vendedor sem filial (pedido pelo sync) com código de filial', async () => {
        const v2 = await login('vendedor2@exemplo.com.br');
        const id = randomUUID();
        const r = await api.chamar(v2.access_token, {
          method: 'POST',
          url: '/v1/sync/push',
          payload: { itens: [{ entidade: 'pedido', id, operacao: 'upsert', payload: { id, customer_id: A.clientes.c2, discount_pct: 0, items: [{ product_id: A.produtos.p1, quantity: 1 }] } }] },
        });
        const recusado = r.statusCode === 403 ? erroDe(r).codigo : (r.json() as { resultados?: { status: string; codigo?: string }[] }).resultados?.[0];
        expect(JSON.stringify(recusado)).toMatch(/FILIAL/);
      });

      // D-T0176-3: a importação de equipe (modules/core/api/equipe-csv.ts, COLUNAS_EQUIPE_CSV) não tem filial: cria vendedor sem filial
      // pelo BKO, sem erro, e supervisor/promotor/gerente sem a "1 ou mais" que a rota de Usuários exige.
      it.fails('D-T0176-3 RN-CORE-39: a conferência do CSV de equipe recusa vendedor sem filial com erro de filial na linha', async () => {
        const csv = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos\nVendedor CSV T0176,' + EM('csv-vendedor') + ',,vendedor,supervisor@exemplo.com.br,,\n';
        const r = await api.chamar(tk.admin, { method: 'POST', url: '/v1/core/equipe/importacoes', payload: { csv, modo: 'conferir' } });
        const corpo = r.json() as { erros?: { coluna: string; mensagem: string }[] };
        expect((corpo.erros ?? []).some((e) => /filial/i.test(`${e.coluna} ${e.mensagem}`)), r.body).toBe(true);
      });

      it('RN-CORE-39: informada a filial pelo admin, o bloqueio sai (login, pull e lista)', async () => {
        const r = await editar(tk.admin, A.usuarios.vendedor2, { filial_ids: [F.boaVista] });
        expect(r.statusCode, r.body).toBe(200);
        const v2 = await login('vendedor2@exemplo.com.br');
        expect(v2.usuario.sem_filial ?? false).toBe(false);
        expect(await linhaDoPull(v2.access_token, A.usuarios.vendedor2)).toMatchObject({ filial_id: F.boaVista, sem_filial: false });
        expect((await listaDoBko(tk.admin)).find((u) => u.id === A.usuarios.vendedor2)).toMatchObject({ filial_ids: [F.boaVista], sem_filial: false });
      });
    });

    // ------------------------------------------------------------------------------------------- H. carga do Hub
    describe.runIf(VENDEDOR_FILIAL_HUB)(`H. carga do ERP pelo Hub (critério a) [${ESPERA_HUB}]`, () => {
      const P = `T176${randomUUID().slice(0, 4).toUpperCase()}`;
      const V = { com: `${P}-COM`, sem: `${P}-SEM`, nulo: `${P}-NULO`, inexistente: `${P}-INEX`, duas: `${P}-DUAS`, deOutro: `${P}-OUTRO` } as const;
      const FIL = { bv: 'FIL-BV', nova: `${P}-FNOVA`, soDeB: `${P}-FB` } as const;
      let relogioErp = Date.now() - 10 * 60_000;
      const alterado = () => new Date((relogioErp += 1_000)).toISOString();
      let resultadoVendedores: ResultadoLote;

      const despachar = async () => {
        const d = criarDespachante({ worker: worker!, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
        for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
        throw new Error('a outbox não esvaziou em 60 ciclos');
      };
      const eventosComFalha = () => q<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where publicado_em is null and tentativas > 0');
      const hub = (t: Tenant, method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}) =>
        api.app.inject({
          method,
          url: `/integracao/v1${url}`,
          remoteAddress: t === A ? IP.A : IP.B,
          headers: {
            authorization: `Bearer ${t.integracao.chave.chave}`,
            'x-macuxi-conector-id': t.integracao.identificador,
            'x-macuxi-conector-versao': VERSAO_CONECTOR,
            'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
            ...extra,
          },
          ...(payload ? { payload } : {}),
        });
      const enviar = async (t: Tenant, entidade: 'filial' | 'vendedor', registros: object[]): Promise<ResultadoLote> => {
        const corpo = { versao_contrato: VERSAO_CONTRATO, entidade, modo: 'delta', conector_id: t.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: new Date().toISOString(), registros };
        const r = await hub(t, 'POST', '/lotes', corpo, { 'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })) });
        expect(r.statusCode, r.body).toBe(202);
        const loteId = (r.json() as { lote_id: string }).lote_id;
        await despachar();
        const c = await hub(t, 'GET', `/lotes/${loteId}`);
        expect(c.statusCode, c.body).toBe(200);
        return c.json() as ResultadoLote;
      };
      const usuarioDoErp = async (t: Tenant, ext: string) =>
        (await q<{ id: string }>('select id::text from core.usuario where tenant_id = $1 and external_id = $2 and deleted_at is null', [t.tenantId, ext]))[0]?.id;
      const filialPorExternal = async (t: Tenant, ext: string) =>
        (await q<{ id: string }>('select id::text from core.filial where tenant_id = $1 and external_id = $2 and deleted_at is null', [t.tenantId, ext]))[0]?.id;
      const vendedorErp = (ext: string, extra: Record<string, unknown> = {}) => ({ external_id: ext, alterado_em: alterado(), nome: `Vendedor ${ext}`, email: null, telefone: null, ...extra });

      beforeAll(async () => {
        if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante');
        worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
        expect((await licenca(api, tk.admin, 'tenant', 'integracao', true)).statusCode).toBe(200);
        expect((await licenca(api, tk.adminB, 'tenant', 'integracao', true)).statusCode).toBe(200);
        // eventos antigos da fixture e lotes `recebido` sem staging não seguram a fila (mesma premissa do ciclo-erp e do T-0084)
        await despachar();
        await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
        // os Conectores da fixture não enviam `filial`: A e B passam a enviar (o CHECK da 0056 aceita)
        await api.admin.query("update integracao.conector set entidades = array_append(entidades, 'filial') where id = any($1::uuid[]) and not ('filial' = any(entidades))", [[A.integracao.conector, B.integracao.conector]]);
        const filiaisA = await enviar(A, 'filial', [
          { external_id: FIL.bv, alterado_em: alterado(), codigo: '0002', nome: 'Filial Boa Vista', ...ENDERECO_FILIAL },
          { external_id: FIL.nova, alterado_em: alterado(), codigo: '0176', nome: 'Filial T0176', ...ENDERECO_FILIAL },
        ]);
        expect(filiaisA.erros, JSON.stringify(filiaisA.erros)).toEqual([]);
        const filiaisB = await enviar(B, 'filial', [{ external_id: FIL.soDeB, alterado_em: alterado(), codigo: '0176', nome: 'Filial só de B', ...ENDERECO_FILIAL }]);
        expect(filiaisB.erros, JSON.stringify(filiaisB.erros)).toEqual([]);
        resultadoVendedores = await enviar(A, 'vendedor', [
          vendedorErp(V.com, { filial_external_id: FIL.bv }),
          vendedorErp(V.sem),
          vendedorErp(V.nulo, { filial_external_id: null }),
          vendedorErp(V.inexistente, { filial_external_id: `${P}-NAO-EXISTE` }),
          vendedorErp(V.duas, { filial_external_id: [FIL.bv, FIL.nova] }),
          vendedorErp(V.deOutro, { filial_external_id: FIL.soDeB }),
        ]);
      }, 300_000);

      it('premissa: as filiais do ERP chegaram ao Core (a Boa Vista adotada pelo external_id, a nova criada) e nenhum consumidor parou', async () => {
        expect(await eventosComFalha()).toEqual([]);
        expect(await filialPorExternal(A, FIL.bv)).toBe(F.boaVista);
        expect(await filialPorExternal(A, FIL.nova)).toBeTruthy();
        expect(await filialPorExternal(B, FIL.soDeB)).toBeTruthy();
        expect(await filialPorExternal(A, FIL.soDeB), 'filial de B não aparece em A').toBeUndefined();
      });

      it('RN-CORE-39: vendedor com filial_external_id grava exatamente essa filial; sem aviso nem erro na linha', async () => {
        const id = await usuarioDoErp(A, V.com);
        expect(id).toBeTruthy();
        expect(await filiaisNoBanco(id!)).toEqual([F.boaVista]);
        expect(resultadoVendedores.erros.filter((e) => e.external_id === V.com)).toEqual([]);
        expect(resultadoVendedores.avisos.filter((a) => a.external_id === V.com)).toEqual([]);
      });

      it.each([
        ['ausente', () => V.sem],
        ['null', () => V.nulo],
      ])('RN-CORE-39: vendedor com filial %s entra com o aviso vendedor_sem_filial (frase clara) e fica bloqueado (sem_filial na lista do BKO)', async (_rotulo, ext) => {
        const aviso = resultadoVendedores.avisos.find((a) => a.external_id === ext());
        expect(aviso, JSON.stringify(resultadoVendedores.avisos)).toMatchObject({ codigo: 'vendedor_sem_filial' });
        expect(aviso!.mensagem).toMatch(/filial/i);
        const id = await usuarioDoErp(A, ext());
        expect(id).toBeTruthy();
        expect(await filiaisNoBanco(id!)).toEqual([]);
        expect((await listaDoBko(tk.admin)).find((u) => u.id === id)).toMatchObject({ filial_ids: [], sem_filial: true });
      });

      it('RN-CORE-39 × RN-INT-04: filial que não existe = linha referencia_ausente no campo filial_external_id (reprocessável); o vendedor não é gravado', async () => {
        const erro = resultadoVendedores.erros.find((e) => e.external_id === V.inexistente);
        expect(erro, JSON.stringify(resultadoVendedores.erros)).toMatchObject({ codigo: 'referencia_ausente', campo: 'filial_external_id', reprocessavel: true });
        expect(erro!.mensagem).toMatch(/filial/);
        expect(await usuarioDoErp(A, V.inexistente)).toBeUndefined();
      });

      it('RN-CORE-39: 2 filiais na linha do vendedor = linha inválida no campo filial_external_id (não reprocessável); o vendedor não é gravado', async () => {
        const erro = resultadoVendedores.erros.find((e) => e.external_id === V.duas);
        expect(erro, JSON.stringify(resultadoVendedores.erros)).toMatchObject({ campo: 'filial_external_id', reprocessavel: false });
        expect(await usuarioDoErp(A, V.duas)).toBeUndefined();
      });

      it('RN-CORE-39 (multi-tenant): a filial que só existe em B = referencia_ausente para a carga de A; nada gravado', async () => {
        expect(resultadoVendedores.erros.find((e) => e.external_id === V.deOutro)).toMatchObject({ codigo: 'referencia_ausente', campo: 'filial_external_id' });
        expect(await usuarioDoErp(A, V.deOutro)).toBeUndefined();
        expect(await q('select 1 from core.usuario_filial where tenant_id = $1 and filial_id = $2', [A.tenantId, await filialPorExternal(B, FIL.soDeB)])).toEqual([]);
      });

      it('RN-CORE-39: a recarga do vendedor com outra filial troca a anterior (continua com exatamente uma); sem o campo, não altera', async () => {
        const id = (await usuarioDoErp(A, V.com))!;
        const nova = (await filialPorExternal(A, FIL.nova))!;
        const troca = await enviar(A, 'vendedor', [vendedorErp(V.com, { filial_external_id: FIL.nova })]);
        expect(troca.erros, JSON.stringify(troca.erros)).toEqual([]);
        expect(await filiaisNoBanco(id)).toEqual([nova]);
        await enviar(A, 'vendedor', [vendedorErp(V.com, { nome: 'Vendedor renomeado' })]);
        expect(await filiaisNoBanco(id)).toEqual([nova]);
        expect(await eventosComFalha()).toEqual([]);
      });

      // D-T0176-4: o Hub (modules/integracao/domain/vendedor-filial.ts) avisa "Vendedor sem filial: bloqueado até informar a filial" em
      // TODA linha sem o campo, mas o Core trata ausente como "não altera" e o vendedor segue com a filial: o aviso diz o que não é.
      it.fails('D-T0176-4 RN-CORE-39 (rótulo × valor): o delta sem filial_external_id de quem já tem filial não avisa "bloqueado"', async () => {
        const id = (await usuarioDoErp(A, V.com))!;
        const r = await enviar(A, 'vendedor', [vendedorErp(V.com, { nome: 'Vendedor renomeado de novo' })]);
        expect(await filiaisNoBanco(id)).toHaveLength(1);
        expect(r.avisos.filter((a) => a.codigo === 'vendedor_sem_filial')).toEqual([]);
      });
    });
  });
});
