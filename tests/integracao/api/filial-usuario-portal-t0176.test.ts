/**
 * T-0176 (RN-CORE-39; ADR 0056) — F-08: o admin SEM filial de cadastro que entra pelo portal `config.` (e-mail e senha, ADR 0031)
 * recebe 403 `USUARIO_SEM_FILIAL` numa rota de dados do tenant, como no BKO. O Core leva `empresa.sem_filial` do `autenticarPortal`
 * (lido de `plataforma.sa_sessao_valida`) para o usuário da requisição (`apps/api/src/app.ts`).
 *
 * Dependência de banco: o #352 traz `sem_filial` na `plataforma.sa_sessao_valida` (D-T0176-7 fechado, docs/testes/T-0176.md).
 * O controle (admin com filial = 200) e o caso sem filial (403) são `it`. A rota de dados é a `'aceita'` do Core
 * (`apoio/rota-aceita.ts`; a Equipe por CSV saiu na v1.0.22).
 * Roda só com banco e o papel do portal (CI, `stack-isolado.yml`); sem eles, pula.
 */
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_TENANT_PLATAFORMA, CODIGO_USUARIO_SEM_FILIAL, MENSAGEM_USUARIO_SEM_FILIAL } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, comToken, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';
import { API_TEM_FILIAL_DE_USUARIO } from '../apoio/filial-usuario';
import { criarUsuarioNoTenant, escolherEmpresa, sessaoDoPortal } from '../apoio/portal';
import { CORPO_ROTA_ACEITA, PACOTES_DE_TESTE, ROTA_ACEITA_CORE } from '../apoio/rota-aceita';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0176-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;
const SEM = { email: 'admin.semfilial.t0176@exemplo.com.br', senha: 'SemFilial#T0176-ok' };
const COM = { email: 'admin.comfilial.t0176@exemplo.com.br', senha: 'ComFilial#T0176-ok' };

// Ligar quando o #361 entrar no main: sem o contrato novo do Core, o login não marca sem_filial e a rota responde 200.
describe.skipIf(semBanco() || !!SEM_PORTAL || !API_TEM_FILIAL_DE_USUARIO)('T-0176 F-08 portal: admin sem filial = 403 USUARIO_SEM_FILIAL (empresa.sem_filial)', () => {
  let api: ApiDeTeste;

  /** Token do portal já com a empresa A escolhida. */
  const tokenEmA = async (email: string, senha: string) => {
    const s = await sessaoDoPortal(api, email, senha);
    if (s.empresa?.id === A.tenantId) return s.token;
    const esc = await escolherEmpresa(api, s.token, A.tenantId);
    expect(esc.statusCode, esc.body).toBe(200);
    return (esc.json() as { token: string }).token;
  };
  const pedirEmA = (token: string) => api.app.inject({ method: 'POST', url: ROTA_ACEITA_CORE, payload: CORPO_ROTA_ACEITA, headers: { ...comToken(token), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } });

  beforeAll(async () => {
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA }, pacotes: PACOTES_DE_TESTE });
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: SEM.email, senha: SEM.senha, nome: 'Admin Sem Filial Fictício', semFilial: true });
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: COM.email, senha: COM.senha, nome: 'Admin Com Filial Fictício' });
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('controle: admin com filial de cadastro entra pelo portal e a rota de dados de A = 200', async () => {
    const r = await pedirEmA(await tokenEmA(COM.email, COM.senha));
    expect(r.statusCode, r.body).toBe(200);
  });

  it('admin sem filial de cadastro entra pelo portal: a rota de dados de A = 403 USUARIO_SEM_FILIAL com a mensagem do SDK', async () => {
    const r = await pedirEmA(await tokenEmA(SEM.email, SEM.senha));
    expect(r.statusCode, r.body).toBe(403);
    expect(erroDe(r)).toMatchObject({ codigo: CODIGO_USUARIO_SEM_FILIAL, mensagem: MENSAGEM_USUARIO_SEM_FILIAL });
  });
});
