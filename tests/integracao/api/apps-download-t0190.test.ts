/**
 * T-0190 (RN-CORE-67, ADR 0065; desenho docs/desenho/T-0190.md) — APKs do Macuxi Campo e do Macuxi Gestão só por link temporário
 * gerado no portal. API REAL (`createApp` + 8 módulos + Postgres como macuxi_app, fixture dois-tenants, portal no 2º pool) com a
 * porta dos pacotes REAL (`criarPacotesS3`) sobre o S3 FALSO local (`apps/api/test/s3-falso.ts`, que confere a assinatura da
 * query e a validade da URL). Nunca contra o bucket real. Matriz: docs/testes/T-0190.md.
 *  - AD-01 critério 1: admin (token do BKO e sessão do portal) e super-admin geram o link do APK vigente; o link baixa o APK;
 *  - AD-02 critério 2: link vencido ou adulterado (outro arquivo, outra variante, validade maior) = 403 do bucket, sem o arquivo;
 *  - AD-03 critério 3: perfil sem `app.baixar` = 403 sem auditoria; licença: Campo exige Vendedor ou Promotor, Gestão exige
 *          Gestor (403 APP_SEM_LICENCA); sem pacote = 404 APP_SEM_PACOTE; sem S3 = 503 ARMAZENAMENTO_INDISPONIVEL (critério 7);
 *  - AD-04 critério 4: multi-tenant (link igual para todos, sem dado do tenant; auditoria de um tenant não aparece no outro);
 *  - AD-05 critério 5: auditoria `core.app_download_link` sem URL e sem dado pessoal; log sem URL;
 *  - AD-06 critério 6: `/v1/app/versao` (contrato antigo dos apps v1.0.17/18 e contrato 2) e `/v1/app/atualizar` não servem
 *          nem apontam o APK; nenhuma rota pública serve APK.
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (o caso diz o que falta; quando corrigir, fica vermelho e vira `it`).
 */
import crypto from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import { LinkDownloadAppSchema } from '@macuxi/core/contracts';
import { CABECALHO_TENANT_PLATAFORMA, SERVICO_PACOTES_DESLIGADO, VALIDADE_LINK_PACOTE_S, type ServicoPacotes } from '@macuxi/platform-sdk';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { opcoesLogger } from '../../../apps/api/src/config';
import { criarClienteS3 } from '../../../apps/api/src/armazenamento-s3';
import { publicarPacote } from '../../../apps/api/src/cli/publicar-pacote';
import { criarPacotesS3 } from '../../../apps/api/src/pacotes';
import { CRED_TESTE, subirS3Falso, type S3Falso } from '../../../apps/api/test/s3-falso';
import { A, B, comToken, erroDe, SENHA, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { criarSuperAdmin, sessaoDoPortal } from '../apoio/portal';

const ROTA = '/v1/core/apps/download';
const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0190-com-folga';
const SA = { email: 'operador.t0190@exemplo.com.br', nome: 'Operador Fictício T0190', senha: 'Senha-Forte-T0190-2026' };
const URL_PUBLICA = 'https://api.teste.macuxi.invalid';
const APK_CAMPO = { arquivo: 'Campo-Oficial-v1.0.19.apk', versao: '1.0.19', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x63, 0x61, 0x6d, 0x70, 0x6f]) };
const APK_GESTAO = { arquivo: 'Gestao-Oficial-v1.0.19.apk', versao: '1.0.19', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x67, 0x65, 0x73, 0x74, 0x61, 0x6f]) };
/** IPv4 em qualquer lugar do texto (127.0.0.1 do inject, 10.x da rede privada etc.). */
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/;
/** Dados pessoais e segredos da fixture que nunca vão à auditoria nem ao log. */
const PESSOAIS = ['admin@exemplo.com.br', 'admin.b@exemplo.com.br', 'Admin Alfa', 'Admin Beta', SA.email, SA.nome, SA.senha, SENHA];

/**
 * O contrato que os apps v1.0.17 e v1.0.18 JÁ INSTALADOS validam (cópia literal do `AppVersaoPublicadaSchema` do `main` antes da
 * T-0190): `apk_url` obrigatório e https, objeto estrito. Fica aqui, e não importado do SDK, para o teste não acompanhar uma
 * mudança do SDK que quebraria o app antigo.
 */
const ContratoAppV1018 = z
  .object({
    variante: z.enum(['campo', 'gestao']),
    versao: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    apk_url: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://')),
    publicada_em: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

describe.skipIf(semBanco())('T-0190 — APKs por link temporário (createApp real × Postgres × S3 falso)', () => {
  let api: ApiDeTeste;
  let s3: S3Falso;
  /** `s3` = porta real sobre o S3 falso; `desligado` = servidor sem S3 (critério 7). */
  let modo: 's3' | 'desligado' = 's3';
  const linhasLog: string[] = [];
  const urlsGeradas: string[] = [];
  const tk = { adminA: '', adminB: '', vendedorA: '', promotorA: '', supervisorA: '', gerenteA: '', analistaA: '', assistenteA: '', vendedorB: '', sa: '', portalB: '' };

  const cliente = () => criarClienteS3({ endpoint: s3.endpoint, regiao: CRED_TESTE.regiao, bucket: s3.bucket, chaveId: CRED_TESTE.chaveId, segredo: CRED_TESTE.segredo });

  const pedir = (token: string, variante: unknown, extra: Partial<InjectOptions> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method: 'POST', url: ROTA, payload: { variante }, ...extra, headers: { ...comToken(token), ...((extra.headers as Record<string, string>) ?? {}) } });
  const comoSA = (variante: unknown, tenant: string) => pedir(tk.sa, variante, { headers: { [CABECALHO_TENANT_PLATAFORMA]: tenant } });

  /** 200 que precisa sair: valida pelo contrato do Core e guarda a URL (segredo) para a varredura do log e da auditoria. */
  function linkDe(r: LightMyRequestResponse) {
    expect(r.statusCode, r.body).toBe(200);
    const l = LinkDownloadAppSchema.parse(r.json());
    urlsGeradas.push(l.url);
    return l;
  }

  const auditorias = (tenant: string) =>
    api.admin
      .query<{ tenant_id: string; usuario_id: string | null; modulo: string; acao: string; entidade: string; entidade_id: string | null; antes: unknown; depois: Record<string, unknown>; bruto: string }>(
        "select tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, row_to_json(a)::text as bruto from plataforma.auditoria a where acao = 'core.app_download_link' and tenant_id = $1 order by ocorrido_em, id",
        [tenant],
      )
      .then((x) => x.rows);

  beforeAll(async () => {
    s3 = await subirS3Falso();
    const real = criarPacotesS3(cliente(), { prefixo: 'pacotes/', validadeS: VALIDADE_LINK_PACOTE_S.max, log: { warn: () => undefined } });
    const pacotes: ServicoPacotes = {
      disponivel: () => modo === 's3',
      linkDoUltimo: (p) => (modo === 's3' ? real : SERVICO_PACOTES_DESLIGADO).linkDoUltimo(p),
    };
    // só o Campo publicado no começo (o Gestão entra no caso do 404 → 200)
    // hora-fixa-ok: o JWT e a assinatura do link seguem o relógio real; o instante fixo é só o `publicada_em` da versão
    await publicarPacote(cliente(), 'pacotes/', { produto: 'campo', ...APK_CAMPO, agora: new Date() });
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA },
      pacotes,
      versoesApp: { campo: { variante: 'campo', versao: '1.0.19', publicada_em: '2026-11-21T12:00:00.000Z' }, gestao: { variante: 'gestao', versao: '1.0.19', publicada_em: null } },
      urlApiPublica: URL_PUBLICA,
    });
    const s = (email: string, t: Tenant = A) => api.sessao(email, t).then((x) => x.access_token);
    tk.adminA = await s('admin@exemplo.com.br');
    tk.adminB = await s('admin.b@exemplo.com.br', B);
    tk.vendedorA = await s('vendedor@exemplo.com.br');
    tk.promotorA = await s('promotor@exemplo.com.br');
    tk.supervisorA = await s('supervisor@exemplo.com.br');
    tk.gerenteA = await s('gerente@exemplo.com.br');
    tk.analistaA = await s('analista@exemplo.com.br');
    tk.assistenteA = await s('assistente@exemplo.com.br');
    tk.vendedorB = await s('vendedor@exemplo.com.br', B);
    await criarSuperAdmin(api.admin, SA);
    tk.sa = (await sessaoDoPortal(api, SA.email, SA.senha)).token;
    tk.portalB = (await sessaoDoPortal(api, 'admin.b@exemplo.com.br', SENHA)).token;
    PESSOAIS.push(...Object.values(tk));
  }, 180_000);

  afterAll(async () => {
    await api?.fechar();
    await s3?.fechar();
  });

  describe('AD-01 critério 1: quem administra gera o link do APK vigente, e o link baixa', () => {
    it('admin B de fábrica (token do BKO; empresa com Vendedor, exceção do usuário sem o Vendedor): 200 com o Campo 1.0.19, validade de no máximo 15 min, e o link baixa o APK', async () => {
      const antes = Date.now(); // hora-fixa-ok: a validade do link conta do relógio real da API
      const l = linkDe(await pedir(tk.adminB, 'campo'));
      expect(l).toMatchObject({ variante: 'campo', versao: '1.0.19', arquivo: APK_CAMPO.arquivo, tamanho_bytes: APK_CAMPO.bytes.byteLength, sha256: crypto.createHash('sha256').update(APK_CAMPO.bytes).digest('hex') });
      const validadeMs = Date.parse(l.expira_em) - antes;
      expect(validadeMs).toBeGreaterThan(0);
      expect(validadeMs).toBeLessThanOrEqual(15 * 60_000 + 2_000); // RN-CORE-67: no máximo 15 minutos
      expect(new URL(l.url).searchParams.get('X-Amz-Expires')).toBe(String(VALIDADE_LINK_PACOTE_S.max));
      const r = await fetch(l.url);
      expect(r.status).toBe(200);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(APK_CAMPO.bytes);
      expect(r.headers.get('content-disposition')).toBe(`attachment; filename="${APK_CAMPO.arquivo}"`);
      expect(s3.tipos.get(`/${s3.bucket}/pacotes/campo/${APK_CAMPO.arquivo}`)).toBe('application/vnd.android.package-archive');
    });

    it('admin B pela sessão do portal (admin_cliente, cabeçalho da empresa) também gera o link do Campo', async () => {
      const l = linkDe(await pedir(tk.portalB, 'campo', { headers: { [CABECALHO_TENANT_PLATAFORMA]: B.tenantId } }));
      expect(l.arquivo).toBe(APK_CAMPO.arquivo);
      // a sessão do portal de B não serve para a empresa A
      const outra = await pedir(tk.portalB, 'campo', { headers: { [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } });
      expect(outra.statusCode, outra.body).toBe(403);
      expect(erroDe(outra).codigo).toBe('EMPRESA_NAO_PERMITIDA');
    });

    it('super-admin escolhendo a empresa (x-macuxi-tenant): gera o link do Campo em A e em B', async () => {
      for (const t of [A.tenantId, B.tenantId]) expect(linkDe(await comoSA('campo', t)).arquivo).toBe(APK_CAMPO.arquivo);
      const semEmpresa = await pedir(tk.sa, 'campo');
      expect(semEmpresa.statusCode, semEmpresa.body).toBe(400);
      expect(erroDe(semEmpresa).codigo).toBe('TENANT_OBRIGATORIO');
    });

    // D1 corrigido (9d2bb03b): a licença vem dos módulos ativos da empresa (`plataforma.tenant_modulo`), não do perfil do admin.
    it('D1: admin A (empresa com Vendedor e Promotor; perfil admin só com o Core) gera o link do Campo', async () => {
      expect((await api.meusModulos(tk.adminA)).modulos.map((m) => m.id)).toEqual(['core']);
      linkDe(await pedir(tk.adminA, 'campo'));
    });
  });

  describe('AD-02 critério 2: link vencido ou adulterado não baixa e não revela o arquivo', () => {
    it('vencido (relógio do bucket depois do expira_em) = 403; adulterado (validade, arquivo, variante, assinatura) = 403; o original segue 200', async () => {
      const l = linkDe(await pedir(tk.adminB, 'campo'));
      const u = new URL(l.url);
      const adulterados = [
        l.url.replace(`X-Amz-Expires=${VALIDADE_LINK_PACOTE_S.max}`, 'X-Amz-Expires=86400'),
        l.url.replace(APK_CAMPO.arquivo, 'Campo-Oficial-v1.0.18.apk'),
        l.url.replace('/pacotes/campo/', '/pacotes/gestao/').replace(APK_CAMPO.arquivo, APK_GESTAO.arquivo),
        l.url.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'0'.repeat(64)}`),
        `${u.origin}${u.pathname}`,
      ];
      for (const [i, x] of adulterados.entries()) {
        const r = await fetch(x);
        const corpo = new Uint8Array(await r.arrayBuffer());
        expect(r.status, `adulterado ${i}`).toBe(403);
        expect(Buffer.from(corpo).includes(Buffer.from(APK_CAMPO.bytes)), `adulterado ${i} devolveu o APK`).toBe(false);
      }
      const original = s3.agora;
      try {
        s3.agora = () => new Date(Date.parse(l.expira_em) + 1_000);
        const vencido = await fetch(l.url);
        expect(vencido.status).toBe(403);
        expect(Buffer.from(await vencido.arrayBuffer()).includes(Buffer.from(APK_CAMPO.bytes))).toBe(false);
      } finally {
        s3.agora = original;
      }
      expect((await fetch(l.url)).status).toBe(200);
    });
  });

  describe('AD-03 critério 3 e 7: perfil, licença, sem pacote e sem S3', () => {
    it('perfis sem `app.baixar` (vendedor, promotor, supervisor, gerente, analista, assistente de A; vendedor de B) = 403 e nada auditado', async () => {
      const antesA = (await auditorias(A.tenantId)).length;
      const antesB = (await auditorias(B.tenantId)).length;
      for (const [nome, t] of Object.entries({ vendedorA: tk.vendedorA, promotorA: tk.promotorA, supervisorA: tk.supervisorA, gerenteA: tk.gerenteA, analistaA: tk.analistaA, assistenteA: tk.assistenteA, vendedorB: tk.vendedorB })) {
        for (const v of ['campo', 'gestao']) {
          const r = await pedir(t, v);
          expect(r.statusCode, `${nome} ${v}: ${r.body}`).toBe(403);
          expect(erroDe(r).codigo, nome).not.toBe('APP_SEM_LICENCA');
          expect(r.body).not.toContain('https://');
        }
      }
      expect(await auditorias(A.tenantId)).toHaveLength(antesA);
      expect(await auditorias(B.tenantId)).toHaveLength(antesB);
    });

    it('sem login = 401; variante fora da lista ou campo a mais = 400', async () => {
      const r = await api.app.inject({ method: 'POST', url: ROTA, payload: { variante: 'campo' } });
      expect(r.statusCode).toBe(401);
      for (const corpo of [{ variante: 'conector' }, { variante: '../campo' }, { variante: 'campo', tenant_id: A.tenantId }, {}]) {
        const x = await api.app.inject({ method: 'POST', url: ROTA, payload: corpo, headers: comToken(tk.adminB) });
        expect(x.statusCode, `${JSON.stringify(corpo)}: ${x.body}`).toBe(400);
      }
    });

    it('licença: Gestão sem o Gestor no tenant = 403 APP_SEM_LICENCA (admin B e super-admin em A e B), sem auditoria e sem link', async () => {
      const antes = (await auditorias(B.tenantId)).length;
      for (const r of [await pedir(tk.adminB, 'gestao'), await comoSA('gestao', B.tenantId), await comoSA('gestao', A.tenantId)]) {
        expect(r.statusCode, r.body).toBe(403);
        expect(erroDe(r).codigo).toBe('APP_SEM_LICENCA');
        expect(r.body).not.toContain('https://');
      }
      expect(await auditorias(B.tenantId)).toHaveLength(antes);
    });

    it('licença: Campo com só o Promotor (Vendedor desligado no tenant A) sai; sem Vendedor e sem Promotor = 403 APP_SEM_LICENCA', async () => {
      const tm = (modulo: string, ativo: boolean) => api.admin.query('update plataforma.tenant_modulo set ativo = $3 where tenant_id = $1 and modulo = $2', [A.tenantId, modulo, ativo]);
      try {
        await tm('vendedor', false);
        expect(linkDe(await comoSA('campo', A.tenantId)).variante).toBe('campo');
        await tm('promotor', false);
        const r = await comoSA('campo', A.tenantId);
        expect(r.statusCode, r.body).toBe(403);
        expect(erroDe(r).codigo).toBe('APP_SEM_LICENCA');
      } finally {
        await tm('vendedor', true);
        await tm('promotor', true);
      }
      expect(linkDe(await comoSA('campo', A.tenantId)).variante).toBe('campo');
    });

    it('sem pacote publicado = 404 APP_SEM_PACOTE sem auditoria; publicado o Gestão, o link sai (Gestor ligado no tenant B)', async () => {
      await api.admin.query(
        "insert into plataforma.tenant_modulo (tenant_id, modulo, ativo, plano) values ($1, 'gestor', true, 'piloto') on conflict (tenant_id, modulo) where deleted_at is null do update set ativo = true",
        [B.tenantId],
      );
      try {
        const antes = (await auditorias(B.tenantId)).length;
        const r = await comoSA('gestao', B.tenantId);
        expect(r.statusCode, r.body).toBe(404);
        expect(erroDe(r).codigo).toBe('APP_SEM_PACOTE');
        expect(await auditorias(B.tenantId)).toHaveLength(antes);
        // hora-fixa-ok: data de publicação do manifesto, nunca comparada
        await publicarPacote(cliente(), 'pacotes/', { produto: 'gestao', ...APK_GESTAO, agora: new Date() });
        const l = linkDe(await comoSA('gestao', B.tenantId));
        expect(l).toMatchObject({ variante: 'gestao', arquivo: APK_GESTAO.arquivo, versao: '1.0.19' });
        expect(new Uint8Array(await (await fetch(l.url)).arrayBuffer())).toEqual(APK_GESTAO.bytes);
      } finally {
        await api.admin.query("update plataforma.tenant_modulo set ativo = false where tenant_id = $1 and modulo = 'gestor'", [B.tenantId]);
      }
    });

    it('critério 7: sem S3 = 503 ARMAZENAMENTO_INDISPONIVEL, sem auditoria e sem link', async () => {
      const antes = (await auditorias(B.tenantId)).length;
      modo = 'desligado';
      try {
        for (const r of [await pedir(tk.adminB, 'campo'), await comoSA('campo', B.tenantId)]) {
          expect(r.statusCode, r.body).toBe(503);
          expect(erroDe(r).codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');
          expect(r.body).not.toContain('https://');
        }
      } finally {
        modo = 's3';
      }
      expect(await auditorias(B.tenantId)).toHaveLength(antes);
    });

    // ACHADO D2 (modulo-core; a decidir com o dono do produto): a licença da RN-CORE-67 vem de `plataforma.tenant_modulo`, que o
    // próprio admin do cliente grava pela rota `PUT /v1/core/licencas/tenant/:modulo` (ação `modulo.gerir_licencas`), sem conferir
    // o plano contratado. Assim o admin liga o Gestor na empresa, põe no perfil dele e baixa o APK do Gestão sem licença. O caso
    // espera que o admin NÃO consiga ligar no tenant um módulo fora do contratado.
    it.fails('D2: admin B não consegue ligar sozinho o Gestor no tenant para baixar o APK do Gestão', async () => {
      try {
        const lig = await api.chamar(tk.adminB, { method: 'PUT', url: '/v1/core/licencas/tenant/gestor', payload: { ativo: true } });
        const per = await api.chamar(tk.adminB, { method: 'PUT', url: '/v1/core/licencas/perfis/admin/gestor', payload: { ativo: true } });
        expect([lig.statusCode, per.statusCode]).toEqual([200, 200]);
        const r = await pedir(tk.adminB, 'gestao');
        expect(r.statusCode, r.body).toBe(403);
      } finally {
        await api.admin.query("update plataforma.tenant_modulo set ativo = false where tenant_id = $1 and modulo = 'gestor'", [B.tenantId]);
        // hora-fixa-ok: now() só marca a exclusão lógica (nunca comparado)
        await api.admin.query("update plataforma.perfil_modulo set deleted_at = now() where tenant_id = $1 and perfil = 'admin' and modulo = 'gestor' and deleted_at is null", [B.tenantId]);
      }
    });
  });

  describe('AD-04 critério 4: multi-tenant', () => {
    it('o link do APK é o mesmo objeto para A e B e não leva id, código nem nome de tenant', async () => {
      const la = linkDe(await comoSA('campo', A.tenantId));
      const lb = linkDe(await comoSA('campo', B.tenantId));
      expect(new URL(la.url).pathname).toBe(new URL(lb.url).pathname);
      for (const l of [la, lb]) {
        const texto = JSON.stringify(l);
        for (const x of [A.tenantId, B.tenantId, A.codigo, B.codigo, 'Distribuidora Alfa', 'Comercial Beta']) expect(texto).not.toContain(x);
      }
    });

    it('a auditoria de cada geração fica no tenant da requisição; o admin de B não vê a de A pela rota de auditoria', async () => {
      const antesA = (await auditorias(A.tenantId)).length;
      const antesB = (await auditorias(B.tenantId)).length;
      linkDe(await comoSA('campo', A.tenantId));
      expect(await auditorias(A.tenantId)).toHaveLength(antesA + 1);
      expect(await auditorias(B.tenantId)).toHaveLength(antesB);
      const r = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/auditoria?limite=200' });
      if (r.statusCode === 200) {
        expect(r.body).not.toContain(A.tenantId);
        for (const linha of (r.json() as { itens?: { tenant_id?: string }[] }).itens ?? []) expect(linha.tenant_id ?? B.tenantId).toBe(B.tenantId);
      }
    });
  });

  describe('AD-05 critério 5: auditoria e log sem URL e sem dado pessoal', () => {
    it('cada geração gravou `core.app_download_link` com { variante, versao, arquivo }; sem URL, assinatura, e-mail, nome, IP nem token', async () => {
      const linhas = [...(await auditorias(A.tenantId)), ...(await auditorias(B.tenantId))];
      expect(linhas.length).toBeGreaterThan(0);
      for (const l of linhas) {
        expect(l).toMatchObject({ modulo: 'core', acao: 'core.app_download_link', entidade: 'app_pacote', entidade_id: null, antes: null });
        expect(Object.keys(l.depois).sort()).toEqual(['arquivo', 'variante', 'versao']);
        for (const proibido of ['http', 'X-Amz', 'Signature', s3.endpoint, ...PESSOAIS]) expect(l.bruto, proibido).not.toContain(proibido);
        // Regex, não o texto '10.': o texto casava com os segundos do carimbo (`...T14:23:10.5+00:00`).
        expect(l.bruto, 'IP na auditoria').not.toMatch(IPV4);
      }
    });

    it('o log da API (nível trace) não tem a URL assinada, a assinatura nem dado pessoal', () => {
      expect(urlsGeradas.length).toBeGreaterThan(5);
      const log = linhasLog.join('\n');
      for (const u of urlsGeradas) {
        expect(log).not.toContain(u);
        expect(log).not.toContain(new URL(u).searchParams.get('X-Amz-Signature')!);
      }
      expect(log).not.toContain('X-Amz-Signature');
      for (const p of PESSOAIS) expect(log, 'dado pessoal ou segredo no log').not.toContain(p);
    });

    it('a auditoria do portal (super-admin e admin_cliente) não guarda a URL do link', async () => {
      const r = await api.admin.query<{ t: string }>('select row_to_json(a)::text as t from plataforma.auditoria_plataforma a');
      const texto = r.rows.map((x) => x.t).join('\n');
      expect(texto).toContain('/v1/core/apps/download');
      expect(texto).not.toContain('X-Amz');
      for (const u of urlsGeradas) expect(texto).not.toContain(u);
    });
  });

  describe('AD-06 critério 6: nenhuma rota pública lista ou serve o APK; apps v1.0.17/18 sem regressão', () => {
    it('app v1.0.17/18 (`?variante=` sem `contrato`): a resposta passa no contrato antigo e o `apk_url` é a página /v1/app/atualizar da API', async () => {
      for (const variante of ['campo', 'gestao'] as const) {
        const r = await api.app.inject({ method: 'GET', url: `/v1/app/versao?variante=${variante}` });
        expect(r.statusCode, r.body).toBe(200);
        const c = ContratoAppV1018.parse(r.json());
        expect(c).toMatchObject({ variante, versao: '1.0.19' });
        expect(c.apk_url).toBe(`${URL_PUBLICA}/v1/app/atualizar?variante=${variante}`);
        expect(c.apk_url).not.toMatch(/\.apk|pacotes|X-Amz/i);
        expect(r.headers['cache-control']).toBe('public, max-age=300');
      }
    });

    it('app novo (`contrato=2`): sem `apk_url`; contrato desconhecido = 400', async () => {
      const r = await api.app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo&contrato=2' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ variante: 'campo', versao: '1.0.19', publicada_em: '2026-11-21T12:00:00.000Z' });
      expect(r.body).not.toContain('apk');
      // o app novo ainda lê o corpo antigo (com apk_url) sem quebrar? a resposta V2 não passa no contrato antigo, e isso é o esperado
      expect(ContratoAppV1018.safeParse(r.json()).success).toBe(false);
      for (const q of ['contrato=3', 'contrato=1', 'contrato=2&apk=1']) {
        const x = await api.app.inject({ method: 'GET', url: `/v1/app/versao?variante=campo&${q}` });
        expect(x.statusCode, `${q}: ${x.body}`).toBe(400);
      }
    });

    it('a página /v1/app/atualizar só orienta: HTML sem link, sem script, sem o arquivo nem endereço do bucket', async () => {
      for (const variante of ['campo', 'gestao'] as const) {
        const r = await api.app.inject({ method: 'GET', url: `/v1/app/atualizar?variante=${variante}` });
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toMatch(/^text\/html/);
        expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
        expect(r.body).toContain(variante === 'campo' ? 'Macuxi Campo 1.0.19' : 'Macuxi Gestão 1.0.19');
        expect(r.body).toContain('Peça o link de download');
        for (const proibido of ['<a ', 'href', '<script', '.apk', 'pacotes', 'X-Amz', s3.endpoint, 'application/vnd.android']) expect(r.body, proibido).not.toContain(proibido);
      }
      const ruim = await api.app.inject({ method: 'GET', url: '/v1/app/atualizar?variante=conector' });
      expect(ruim.statusCode).toBe(400);
    });

    it('nenhuma rota da API devolve APK sem login: varredura das rotas registradas e dos caminhos óbvios', async () => {
      const rotas = api.app.printRoutes({ commonPrefix: false });
      expect(rotas.toLowerCase()).not.toContain('apk');
      const candidatos = [
        '/v1/app/apk?variante=campo',
        '/v1/app/download?variante=campo',
        '/v1/app/campo.apk',
        `/v1/app/${APK_CAMPO.arquivo}`,
        '/v1/core/apps/download',
        '/v1/core/apps/download?variante=campo',
        `/pacotes/campo/${APK_CAMPO.arquivo}`,
        '/v1/arquivos/pacotes/campo/ultimo.json',
        '/v1/sync/pacotes',
      ];
      for (const url of candidatos) {
        const r = await api.app.inject({ method: 'GET', url });
        expect([401, 403, 404, 405, 400], `${url}: ${r.statusCode}`).toContain(r.statusCode);
        expect(r.headers['content-type'] ?? '', url).not.toContain('android.package-archive');
        expect(Buffer.from(r.rawPayload).includes(Buffer.from(APK_CAMPO.bytes)), url).toBe(false);
        expect(r.body, url).not.toContain('X-Amz');
      }
      // o POST do link sem login também não sai
      const semLogin = await api.app.inject({ method: 'POST', url: ROTA, payload: { variante: 'campo' } });
      expect(semLogin.statusCode).toBe(401);
      expect(semLogin.body).not.toContain('https://');
    });
  });
});
