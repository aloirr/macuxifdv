/**
 * T-0182 — logo do cliente e nome fantasia de ponta a ponta (desenho docs/desenho/T-0182-logo-cliente.md §1.2, §2, §3.1 e §3.2;
 * spec docs/design/telas/logo-cliente.md §2 e §5; RN-CORE-33). Matriz: docs/testes/T-0182.md.
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo (dois-tenants + 0081), pool do `macuxi_app` e do
 * `macuxi_portal`, armazenamento de arquivos em memória (a mesma porta `ArmazenamentoArquivos` da API). Nada das `sa_*` é simulado.
 *  - LC-01  RN-CORE-33: o admin do cliente lê a marca da própria empresa e NÃO grava (PUT/DELETE da logo e PUT da marca = 403,
 *           nada muda no banco nem no armazenamento); outra empresa = 403 também na leitura, com frase de acesso (nunca de
 *           alteração), e a `sa_marca_da_empresa` recusa com 42501 mesmo chamada direto pelo `macuxi_portal`;
 *  - LC-02  um caso de cada código pela pilha real (`createApp` + banco): SVG (415), 1 MiB + 1 byte (413), altura e lado
 *           (422) com a frase da spec; nada gravado. As variações de cada código são do unitário (`apps/api/test/empresa-logo.test.ts`);
 *  - LC-03  multi-tenant (critério 5): a logo de A nunca chega a B (`/v1/me/modulos` de B sem `empresa_logo` de A;
 *           `/v1/me/empresa/logo/:sha` de A pela sessão de B = 404, e o de B pela sessão de A = 404); a chave do objeto fica
 *           sob o prefixo do próprio tenant;
 *  - LC-04  valor × regra: `empresa_nome` = nome fantasia; vazio = razão social (`plataforma.tenant.nome`), lido do banco e
 *           comparado com a regra; `empresa_logo` = o sha256 dos bytes enviados; trocar logo/nome muda o `versao_licencas`;
 *  - LC-05  idempotência (mesma imagem = mesmo sha, um objeto só, uma auditoria só), troca (o objeto anterior sai) e remoção
 *           (o aparelho perde a logo: parâmetro null e o sha antigo = 404); auditoria sem bytes nem chave.
 * Roda só com banco e o papel do portal (CI, `stack-isolado.yml`); sem eles, pula.
 */
import { createHash } from 'node:crypto';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import type { MeusModulosResposta } from '@macuxi/core/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarArmazenamentoEmMemoria } from '../../../apps/api/src/arquivos';
import { A, B, comToken, subirApi, type ApiDeTeste } from '../apoio/api';
import { auditoriaDoPortal, claimsDe, criarSuperAdmin, criarUsuarioNoTenant, sessaoDoPortal } from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0182-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

// contas fictícias (senhas na RN-CORE-32)
const SUPER = { email: 'chefe.t0182@exemplo.com.br', nome: 'Chefe Macuxi Fictício', senha: 'Chefe#Logo-2026' };
const ADMIN_A = { email: 'admin.logo.t0182@exemplo.com.br', nome: 'Admin Fictício T0182', senha: 'Admin#Logo-2026' };

/** PNG mínimo: assinatura + IHDR (a API só lê o cabeçalho). `semente` muda os bytes (e o sha256). */
function png(largura: number, altura: number, extra = 0, semente = 0): Buffer {
  const b = Buffer.alloc(33 + extra, semente);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}
/**
 * As frases e os limites saem da SPEC (§2) e do desenho (§2.2-§2.3), escritos aqui, e não das constantes do SDK: o teste prova que o
 * código diz o que a spec manda (e o arquivo compila também sem o lote no `main`).
 */
const LIMITE_BYTES = 1_048_576;
const FRASES = {
  LOGO_FORMATO: 'Use um arquivo PNG ou JPG.',
  LOGO_GRANDE_DEMAIS: 'O arquivo passa de 1 MB. Envie um menor.',
  LOGO_ALTURA_MINIMA: 'A imagem tem menos de 200 px de altura. Envie uma maior.',
  LOGO_LADO_MAXIMO: 'A imagem passa de 4096 px de largura ou altura. Envie uma menor.',
} as const;
type CodigoFrase = keyof typeof FRASES;
/** Spec §5: "Licenciado para <nome fantasia>"; vazio = razão social. */
const nomeEsperado = (fantasia: string | null, razao: string) => (fantasia?.trim() ? fantasia.trim() : razao);
const CHAVES_MARCA = ['logo', 'nome_fantasia', 'razao_social', 'tenant_id'];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const core = (r: MeusModulosResposta) => r.modulos.find((m) => m.id === 'core')?.parametros ?? {};

describe.skipIf(semBanco() || !!SEM_PORTAL)('T-0182 logo do cliente e nome fantasia: permissão, validação, multi-tenant e valor × regra', () => {
  let api: ApiDeTeste;
  const arquivos = criarArmazenamentoEmMemoria();
  let tokenSuper = '';
  let tokenAdminA = '';
  let vendedorA = '';
  let vendedorB = '';

  const portal = (token: string, metodo: 'GET' | 'PUT' | 'DELETE', url: string, corpo?: { tipo: string; bytes: Buffer } | { json: object }) =>
    api.app.inject({
      method: metodo,
      url,
      headers: { ...comToken(token), ...(corpo && 'tipo' in corpo ? { 'content-type': corpo.tipo } : {}) },
      ...(corpo ? { payload: 'tipo' in corpo ? corpo.bytes : corpo.json } : {}),
    });
  const enviarLogo = (token: string, tenant: string, bytes: Buffer, tipo = 'image/png') => portal(token, 'PUT', `/v1/plataforma/empresas/${tenant}/logo`, { tipo, bytes });
  const logoDoAparelho = (token: string, s: string) => api.chamar(token, { method: 'GET', url: `/v1/me/empresa/logo/${s}` });
  const linhaTenant = async (id: string) =>
    (
      await api.admin.query<{ nome: string; nome_fantasia: string | null; logo_sha256: string | null; logo_chave: string | null }>(
        'select nome, nome_fantasia, logo_sha256, logo_chave from plataforma.tenant where id = $1',
        [id],
      )
    ).rows[0]!;
  const codigo = (r: LightMyRequestResponse) => (r.json() as { codigo?: string }).codigo;

  beforeAll(async () => {
    api = await subirApi({ arquivos, plataforma: { segredo: () => SEGREDO_PLATAFORMA } });
    await criarSuperAdmin(api.admin, SUPER);
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADMIN_A });
    tokenSuper = (await sessaoDoPortal(api, SUPER.email, SUPER.senha)).token;
    // admin de uma empresa só: entra direto nela (T-0093)
    tokenAdminA = (await sessaoDoPortal(api, ADMIN_A.email, ADMIN_A.senha)).token;
    vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
  });

  afterAll(async () => {
    await api?.fechar();
  });

  it('LC-01 RN-CORE-33: admin do cliente lê a marca da própria empresa e não grava nada (403); outra empresa = 403', async () => {
    const lida = await portal(tokenAdminA, 'GET', `/v1/plataforma/empresas/${A.tenantId}/marca`);
    expect(lida.statusCode, lida.body).toBe(200);
    expect(Object.keys(lida.json()).sort()).toEqual(CHAVES_MARCA);
    expect(lida.json()).toEqual({ tenant_id: A.tenantId, razao_social: (await linhaTenant(A.tenantId)).nome, nome_fantasia: null, logo: null });

    const tentativas = [
      await enviarLogo(tokenAdminA, A.tenantId, png(600, 200)),
      // nem o corpo acima do limite muda a resposta: a autorização vem antes (onRequest)
      await enviarLogo(tokenAdminA, A.tenantId, png(600, 200, LIMITE_BYTES)),
      await portal(tokenAdminA, 'DELETE', `/v1/plataforma/empresas/${A.tenantId}/logo`),
      await portal(tokenAdminA, 'PUT', `/v1/plataforma/empresas/${A.tenantId}/marca`, { json: { nome_fantasia: 'Fantasia Indevida' } }),
    ];
    expect(tentativas.map((r) => [r.statusCode, codigo(r)])).toEqual(Array(4).fill([403, 'PERFIL_SEM_ACESSO']));
    expect((await portal(tokenAdminA, 'PUT', `/v1/plataforma/empresas/${B.tenantId}/marca`, { json: { nome_fantasia: 'X' } })).statusCode).toBe(403);
    // LER a marca de outra empresa: 403 com frase de ACESSO (é leitura: nunca "altera"; revisão do gerente-projetos)
    for (const rota of ['marca', 'logo']) {
      const r = await portal(tokenAdminA, 'GET', `/v1/plataforma/empresas/${B.tenantId}/${rota}`);
      expect(r.statusCode, `GET ${rota} de B`).toBe(403);
      const { codigo: c, mensagem } = r.json() as { codigo?: string; mensagem?: string };
      expect(c).toBe('PERFIL_SEM_ACESSO');
      expect(mensagem, `GET ${rota} de B`).toMatch(/^Você só vê .+ da sua empresa\.$/);
      expect(mensagem).not.toMatch(/alter/i);
    }
    // a função do banco também recusa (defesa em profundidade): admin do cliente lendo B direto pelo macuxi_portal = 42501
    const sid = String(claimsDe(tokenAdminA).sid);
    await expect(api.poolPortal!.query('select plataforma.sa_marca_da_empresa($1, $2)', [sid, B.tenantId])).rejects.toMatchObject({ code: '42501' });
    const a = await linhaTenant(A.tenantId);
    expect([a.nome_fantasia, a.logo_sha256]).toEqual([null, null]);
    expect(arquivos.chaves()).toEqual([]);
    // sem sessão do portal = 401; o token do app (vendedor) não abre o portal
    expect((await portal('', 'GET', `/v1/plataforma/empresas/${A.tenantId}/marca`)).statusCode).toBe(401);
    expect((await enviarLogo(vendedorA, A.tenantId, png(600, 200))).statusCode).toBe(401);
  });

  it.each([
    // RD-0706: um caso de cada código; webp, JSON, assinatura trocada e corpo vazio ficam no unitário
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 415, 'LOGO_FORMATO'],
    ['acima de 1 MiB (1 byte a mais)', png(600, 200, LIMITE_BYTES - 32), 'image/png', 413, 'LOGO_GRANDE_DEMAIS'],
    ['199 px de altura', png(800, 199), 'image/png', 422, 'LOGO_ALTURA_MINIMA'],
    ['4097 px de largura', png(4097, 300), 'image/png', 422, 'LOGO_LADO_MAXIMO'],
  ])('LC-02 %s → %i %s com a frase da spec; nada gravado no banco nem no armazenamento', async (_n, bytes, tipo, status, cod) => {
    const r = await enviarLogo(tokenSuper, A.tenantId, bytes, tipo);
    expect(r.statusCode, r.body).toBe(status);
    expect(r.json()).toMatchObject({ codigo: cod, mensagem: FRASES[cod as CodigoFrase] });
    expect((await linhaTenant(A.tenantId)).logo_sha256).toBeNull();
    expect(arquivos.chaves()).toEqual([]);
  });

  it('LC-03/LC-04 super-admin grava a logo de A: chega ao aparelho de A (sha certo, bytes iguais) e nunca ao de B', async () => {
    const versaoAntes = (await api.meusModulos(vendedorA)).versao_licencas;
    const logoA = png(600, 200);
    // o limite exato (1 MiB) passa
    const grande = png(600, 200, LIMITE_BYTES - 33, 1);
    expect(grande.length).toBe(LIMITE_BYTES);
    expect((await enviarLogo(tokenSuper, A.tenantId, grande)).statusCode).toBe(200);
    const r = await enviarLogo(tokenSuper, A.tenantId, logoA);
    expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(r.json()).sort()).toEqual(CHAVES_MARCA);
    expect(r.json().logo).toMatchObject({ sha256: sha(logoA), tipo: 'image/png', tamanho_bytes: logoA.length, largura_px: 600, altura_px: 200 });
    expect(JSON.stringify(r.json())).not.toContain('chave');

    // banco e armazenamento: um objeto só (o de 1 MiB saiu na troca), sob o prefixo de A
    const a = await linhaTenant(A.tenantId);
    expect(a.logo_sha256).toBe(sha(logoA));
    expect(arquivos.chaves()).toEqual([a.logo_chave]);
    expect(a.logo_chave!.startsWith(`${A.tenantId}/plataforma/`)).toBe(true);

    // aparelho de A: parâmetros do Core (valor × regra) e os bytes
    const mA = await api.meusModulos(vendedorA);
    expect(core(mA).empresa_logo).toEqual({ sha256: sha(logoA), tipo: 'image/png', largura_px: 600, altura_px: 200 });
    expect(core(mA).empresa_nome).toBe(nomeEsperado(a.nome_fantasia, a.nome));
    expect(core(mA).empresa_nome).toBe(a.nome);
    expect(mA.versao_licencas).not.toBe(versaoAntes);
    const bytesA = await logoDoAparelho(vendedorA, sha(logoA));
    expect(bytesA.statusCode, bytesA.body).toBe(200);
    expect(bytesA.headers['content-type']).toBe('image/png');
    expect(bytesA.rawPayload.equals(logoA)).toBe(true);

    // aparelho de B: nada de A (parâmetro nulo, nome de B, e o sha de A = 404)
    const mB = await api.meusModulos(vendedorB);
    const b = await linhaTenant(B.tenantId);
    expect(core(mB).empresa_logo).toBeNull();
    expect(core(mB).empresa_nome).toBe(nomeEsperado(b.nome_fantasia, b.nome));
    const deAporB = await logoDoAparelho(vendedorB, sha(logoA));
    expect(deAporB.statusCode).toBe(404);
    expect(codigo(deAporB)).toBe('LOGO_NAO_ENCONTRADA');
    expect(deAporB.rawPayload.equals(logoA)).toBe(false);
  });

  it('LC-03 com as duas empresas com logo: cada sessão só baixa a própria; o sha da outra = 404', async () => {
    const logoB = png(700, 300, 10, 9);
    expect((await enviarLogo(tokenSuper, B.tenantId, logoB)).statusCode).toBe(200);
    const shaA = (await linhaTenant(A.tenantId)).logo_sha256!;
    const b = await linhaTenant(B.tenantId);
    expect(b.logo_chave!.startsWith(`${B.tenantId}/plataforma/`)).toBe(true);
    expect(core(await api.meusModulos(vendedorB)).empresa_logo).toMatchObject({ sha256: sha(logoB) });
    expect(core(await api.meusModulos(vendedorA)).empresa_logo).toMatchObject({ sha256: shaA });
    expect((await logoDoAparelho(vendedorB, sha(logoB))).rawPayload.equals(logoB)).toBe(true);
    expect((await logoDoAparelho(vendedorA, sha(logoB))).statusCode).toBe(404);
    expect((await logoDoAparelho(vendedorB, shaA)).statusCode).toBe(404);
    // o admin do cliente de A lê os bytes da própria empresa pelo portal, não os de B
    expect((await portal(tokenAdminA, 'GET', `/v1/plataforma/empresas/${A.tenantId}/logo`)).statusCode).toBe(200);
    expect((await portal(tokenAdminA, 'GET', `/v1/plataforma/empresas/${B.tenantId}/logo`)).statusCode).toBe(403);
  });

  it('LC-04 valor × regra do nome: "Licenciado para" usa o nome fantasia; apagado = razão social; troca muda o versao_licencas', async () => {
    const url = `/v1/plataforma/empresas/${A.tenantId}/marca`;
    const v0 = (await api.meusModulos(vendedorA)).versao_licencas;
    const r = await portal(tokenSuper, 'PUT', url, { json: { nome_fantasia: '  Exemplo Norte  ' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().nome_fantasia).toBe('Exemplo Norte');
    let a = await linhaTenant(A.tenantId);
    expect(a.nome_fantasia).toBe('Exemplo Norte');
    const m1 = await api.meusModulos(vendedorA);
    expect(core(m1).empresa_nome).toBe(nomeEsperado(a.nome_fantasia, a.nome));
    expect(core(m1).empresa_nome).toBe('Exemplo Norte');
    expect(m1.versao_licencas).not.toBe(v0);
    // B não muda
    const b = await linhaTenant(B.tenantId);
    expect(b.nome_fantasia).toBeNull();
    expect(core(await api.meusModulos(vendedorB)).empresa_nome).toBe(b.nome);
    // o admin do cliente vê o nome gravado
    expect((await portal(tokenAdminA, 'GET', url)).json().nome_fantasia).toBe('Exemplo Norte');
    // só espaços = apaga; o aparelho volta à razão social
    expect((await portal(tokenSuper, 'PUT', url, { json: { nome_fantasia: '   ' } })).json().nome_fantasia).toBeNull();
    a = await linhaTenant(A.tenantId);
    expect(a.nome_fantasia).toBeNull();
    expect(core(await api.meusModulos(vendedorA)).empresa_nome).toBe(a.nome);
    // acima de 80 = 400, nada muda
    expect((await portal(tokenSuper, 'PUT', url, { json: { nome_fantasia: 'x'.repeat(81) } })).statusCode).toBe(400);
    expect((await linhaTenant(A.tenantId)).nome_fantasia).toBeNull();
  });

  it('LC-05 idempotência, remoção e auditoria: mesma imagem = nada muda; DELETE tira do aparelho; auditoria sem bytes nem chave', async () => {
    const a0 = await linhaTenant(A.tenantId);
    const auditAntes = (await auditoriaDoPortal(api.admin)).filter((l) => l.acao === 'sa.empresa.logo.gravar').length;
    const mesma = png(600, 200);
    expect(sha(mesma)).toBe(a0.logo_sha256);
    const r = await enviarLogo(tokenSuper, A.tenantId, mesma);
    expect(r.statusCode).toBe(200);
    expect((await linhaTenant(A.tenantId)).logo_chave).toBe(a0.logo_chave);
    expect((await auditoriaDoPortal(api.admin)).filter((l) => l.acao === 'sa.empresa.logo.gravar').length).toBe(auditAntes);

    const del = await portal(tokenSuper, 'DELETE', `/v1/plataforma/empresas/${A.tenantId}/logo`);
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json().logo).toBeNull();
    expect((await linhaTenant(A.tenantId)).logo_sha256).toBeNull();
    expect(arquivos.chaves()).not.toContain(a0.logo_chave);
    expect(core(await api.meusModulos(vendedorA)).empresa_logo).toBeNull();
    expect((await logoDoAparelho(vendedorA, a0.logo_sha256!)).statusCode).toBe(404);
    expect((await portal(tokenSuper, 'DELETE', `/v1/plataforma/empresas/${A.tenantId}/logo`)).statusCode).toBe(200);
    // a logo de B continua
    expect(core(await api.meusModulos(vendedorB)).empresa_logo).not.toBeNull();

    const linhas = (await auditoriaDoPortal(api.admin)).filter((l) => l.acao.startsWith('sa.empresa.'));
    expect(linhas.map((l) => l.acao)).toEqual(expect.arrayContaining(['sa.empresa.logo.gravar', 'sa.empresa.logo.remover', 'sa.empresa.nome_fantasia']));
    expect(linhas.filter((l) => l.acao === 'sa.empresa.logo.remover')).toHaveLength(1);
    for (const l of linhas) {
      expect(l.ator_tipo).toBe('super_admin');
      expect(l.bruto).not.toMatch(/plataforma\/\d{4}-\d{2}\//);
      expect(l.bruto).not.toContain('iVBOR');
    }
  });
});
