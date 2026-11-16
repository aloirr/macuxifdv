/**
 * T-0174 (RN-CAT-14, ADR 0058): as 6 rotas do lote de fotos pelo `createApp` REAL (apps/api), com o módulo Catálogo real
 * de `MODULOS_API`, sem Postgres: o banco é um falso em memória que guarda `catalogo.foto_lote`, `catalogo.foto_lote_item`,
 * `plataforma.arquivo` e a outbox (`plataforma.evento`). Prova, na fronteira HTTP, o que o teste do dono prova com um
 * contexto montado à mão: licença (403 MODULO_INATIVO), ação `produto.enriquecer` (403 para quem não é analista/admin),
 * teto do ZIP antes de qualquer SQL (422 RN-CAT-14), idempotência do POST, evento `catalogo.foto_lote.enfileirado@1` na
 * outbox validado pelo Zod `@1`, e o CSV do relatório neutralizado contra fórmula, com cabeçalhos de download.
 * RLS de verdade (outro tenant) fica no CI: modules/catalogo/api/fotos-lote.db.test.ts e db/testes/foto-lote.db.test.ts.
 */
import { FotoLoteCriadoSchema, FotoLoteEnfileiradoSchema, ROTAS_CATALOGO } from '@macuxi/catalogo/contracts';
import { ErroApiSchema, LIMITES_ZIP_TETO, PARTE_ENVIO_BYTES, type ClienteBanco, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import type { BancoApp } from '../../../apps/api/src/banco';
import { LICENCAS_PADRAO, opcoesDeTeste, TENANT, usuarios, type Licencas } from '../../../apps/api/test/apoio';

const LOTE = '0ca00000-0000-4000-8000-000000000174';
const ARQ = '0ca00000-0000-4000-8000-0000000001a4';
const MIB = 1024 * 1024;
const BASE = '/v1/catalogo/';

const QUEM: Record<string, UsuarioAutenticado> = {
  ...usuarios,
  admin: { id: '0b000000-0000-4000-8000-000000000005', tenant_id: TENANT, perfil: 'admin' },
};
const cab = (quem: string) => ({ 'x-teste-usuario': quem });

interface LinhaLote {
  id: string;
  enviado_por: string;
  arquivo_id: string;
  nome_arquivo: string;
  tamanho_bytes: number;
  sha256: string | null;
  situacao: string;
  motivo: string | null;
  duplicado_de: string | null;
  total: number | null;
  concluido_em: string | null;
  created_at: string;
}
interface LinhaItem {
  lote_id: string;
  indice: number;
  caminho: string;
  situacao: string;
  motivo: string | null;
  tipo_detectado: string | null;
  codigo: string | null;
  ordem: number | null;
  produto_id: string | null;
  produto_codigo: string | null;
  codigos_candidatos: string[] | null;
}

/** Banco falso em memória: só o que as 6 rotas do lote e a plataforma (arquivo, outbox, auditoria) tocam. */
function bancoEmMemoria() {
  const lotes = new Map<string, LinhaLote>();
  const itens: LinhaItem[] = [];
  const arquivos = new Map<string, { id: string; situacao: string; tipo: string; tamanho_bytes: number | null; modulo: string; entidade: string; entidade_id: string; enviado_por: string }>();
  const eventos: { nome: string; payload: unknown }[] = [];
  const sqls: string[] = [];
  const res = <R>(rows: unknown[], rowCount = rows.length) => ({ rows: rows as R[], rowCount });
  const cliente: ClienteBanco = {
    query: async <R>(sql: string, v: readonly unknown[] = []) => {
      sqls.push(sql);
      if (/insert into catalogo\.foto_lote\b/.test(sql)) {
        const [id, enviado_por, arquivo_id, nome_arquivo, tamanho] = v as [string, string, string, string, number];
        if ([...lotes.values()].some((l) => l.arquivo_id === arquivo_id)) throw Object.assign(new Error('único'), { code: '23505' });
        lotes.set(id, { id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes: Number(tamanho), sha256: null, situacao: 'aguardando_envio', motivo: null, duplicado_de: null, total: null, concluido_em: null, created_at: new Date().toISOString() });
        return res<R>([], 1);
      }
      if (/count\(\*\)::int as n from catalogo\.foto_lote\b/.test(sql)) {
        const em = v[0] as string[];
        return res<R>([{ n: [...lotes.values()].filter((l) => em.includes(l.situacao)).length }]);
      }
      if (/from catalogo\.foto_lote where id = \$1::uuid/.test(sql)) return res<R>(lotes.has(v[0] as string) ? [{ ...lotes.get(v[0] as string)! }] : []);
      if (/from catalogo\.foto_lote\s+where deleted_at is null and situacao <> 'duplicado'/.test(sql)) return res<R>([...lotes.values()].filter((l) => l.situacao !== 'duplicado'));
      if (/update catalogo\.foto_lote set situacao = 'enfileirado'/.test(sql)) {
        const l = lotes.get(v[0] as string);
        if (l && l.situacao === 'aguardando_envio') l.situacao = 'enfileirado';
        return res<R>([], l ? 1 : 0);
      }
      if (/group by lote_id, situacao/.test(sql)) {
        const ids = v[0] as string[];
        const cont = new Map<string, number>();
        for (const i of itens.filter((x) => ids.includes(x.lote_id))) cont.set(`${i.lote_id}|${i.situacao}`, (cont.get(`${i.lote_id}|${i.situacao}`) ?? 0) + 1);
        return res<R>([...cont.entries()].map(([k, n]) => ({ lote_id: k.split('|')[0], situacao: k.split('|')[1], n })));
      }
      if (/from catalogo\.foto_lote_item where lote_id = \$1::uuid and deleted_at is null order by indice$/.test(sql.trim())) {
        return res<R>(itens.filter((i) => i.lote_id === v[0]).sort((a, b) => a.indice - b.indice));
      }
      if (/insert into plataforma\.arquivo/.test(sql)) {
        const [id, , modulo, , entidade, entidade_id, , enviado_por, tipo] = v as string[];
        if (arquivos.has(id!)) return res<R>([], 0);
        arquivos.set(id!, { id: id!, situacao: 'aguardando', tipo: tipo!, tamanho_bytes: null, modulo: modulo!, entidade: entidade!, entidade_id: entidade_id!, enviado_por: enviado_por! });
        return res<R>([], 1);
      }
      if (/from plataforma\.arquivo where id = \$1 and modulo = \$2/.test(sql)) {
        const a = arquivos.get(v[0] as string);
        return res<R>(a && a.modulo === v[1] ? [{ ...a }] : []);
      }
      if (/insert into plataforma\.evento\b/.test(sql)) {
        eventos.push({ nome: v[2] as string, payload: JSON.parse(v[5] as string) });
        return res<R>([], 1);
      }
      return res<R>([], 1);
    },
  };
  const tenants: string[] = [];
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (t, fn) => {
      tenants.push(t);
      return fn(cliente);
    },
    semTenant: async (fn) => fn(cliente),
    horizonteSync: async () => new Date(Date.now() - 2_000),
    instanteSync: async () => new Date(),
  };
  return { banco, lotes, itens, arquivos, eventos, sqls, tenants };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

function montar(o: { licencas?: Licencas; parametrosCatalogo?: Record<string, unknown> } = {}) {
  const mem = bancoEmMemoria();
  const l = o.licencas ?? { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, admin: ['core', 'catalogo'] } };
  const base = opcoesDeTeste(l, { banco: mem.banco });
  app = createApp({
    ...base,
    autenticar: async (h) => QUEM[h['x-teste-usuario'] ?? ''] ?? null,
    licencas: async (u) => ({
      ativosNoTenant: l.tenant,
      doPerfil: l.perfil[u.perfil] ?? ['core'],
      removidosDoUsuario: [],
      parametros: { core: { raio_checkin_m: 150 }, catalogo: o.parametrosCatalogo ?? {} },
    }),
  });
  return { app, ...mem };
}

const corpo = (tamanho = 50 * MIB) => ({ id: LOTE, arquivo_id: ARQ, nome_arquivo: 'fotos.zip', tamanho_bytes: tamanho });
const url = (r: string) => BASE + r.replace(':id', LOTE);
/** As 6 rotas do lote (ADR 0058 §9). */
const ROTAS: { metodo: 'GET' | 'POST'; caminho: string }[] = [
  { metodo: 'POST', caminho: ROTAS_CATALOGO.fotosLote },
  { metodo: 'GET', caminho: ROTAS_CATALOGO.fotosLote },
  { metodo: 'GET', caminho: ROTAS_CATALOGO.fotoLote },
  { metodo: 'POST', caminho: ROTAS_CATALOGO.fotoLoteEnfileirar },
  { metodo: 'GET', caminho: ROTAS_CATALOGO.fotoLoteItens },
  { metodo: 'GET', caminho: ROTAS_CATALOGO.fotoLoteRelatorio },
];
const chamar = (a: FastifyInstance, r: (typeof ROTAS)[number], quem: string) =>
  a.inject({ method: r.metodo, url: url(r.caminho), headers: cab(quem), ...(r.metodo === 'POST' && r.caminho === ROTAS_CATALOGO.fotosLote ? { payload: corpo() } : {}) });

describe('T-0174 critério 9 — permissão e licença na fronteira HTTP (createApp real, sem banco)', () => {
  it('FL-API-01: vendedor, promotor e supervisor (sem produto.enriquecer) → 403 nas 6 rotas, sem abrir transação', async () => {
    const m = montar();
    for (const quem of ['vendedor', 'promotor', 'supervisor']) {
      for (const r of ROTAS) {
        const resp = await chamar(m.app, r, quem);
        expect(resp.statusCode, `${quem} ${r.metodo} ${r.caminho}`).toBe(403);
        expect(ErroApiSchema.parse(resp.json()).codigo, `${quem} ${r.metodo} ${r.caminho}`).not.toBe('MODULO_INATIVO');
      }
    }
    expect(m.tenants).toEqual([]);
    expect(m.lotes.size).toBe(0);
  });

  it('FL-API-02: analista e admin (com produto.enriquecer) passam da autorização: POST cria (201) e o GET do lote responde 200', async () => {
    for (const quem of ['analista', 'admin']) {
      const m = montar();
      const criado = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab(quem), payload: corpo() });
      expect(criado.statusCode, quem).toBe(201);
      const lote = await m.app.inject({ method: 'GET', url: url(ROTAS_CATALOGO.fotoLote), headers: cab(quem) });
      expect(lote.statusCode, quem).toBe(200);
      expect(lote.json()).toMatchObject({ id: LOTE, situacao: 'aguardando_envio' });
      await m.app.close();
      app = null;
    }
  });

  it('FL-API-03: Catálogo fora da licença do tenant → 403 MODULO_INATIVO nas 6 rotas, mesmo para o analista', async () => {
    const m = montar({ licencas: { tenant: ['core', 'vendedor'], perfil: { analista: ['core', 'catalogo', 'vendedor'] } } });
    for (const r of ROTAS) {
      const resp = await chamar(m.app, r, 'analista');
      expect(resp.statusCode, `${r.metodo} ${r.caminho}`).toBe(403);
      expect(resp.json(), `${r.metodo} ${r.caminho}`).toMatchObject({ codigo: 'MODULO_INATIVO' });
    }
    expect(m.lotes.size).toBe(0);
  });

  it('FL-API-04: Catálogo fora do perfil do analista (tenant com Catálogo) → 403 MODULO_INATIVO', async () => {
    const m = montar({ licencas: { tenant: ['core', 'catalogo'], perfil: { analista: ['core'] } } });
    for (const r of ROTAS) expect((await chamar(m.app, r, 'analista')).json(), `${r.metodo} ${r.caminho}`).toMatchObject({ codigo: 'MODULO_INATIVO' });
  });

  it('FL-API-05: sem sessão → 401 nas 6 rotas', async () => {
    const m = montar();
    for (const r of ROTAS) expect((await m.app.inject({ method: r.metodo, url: url(r.caminho) })).statusCode, `${r.metodo} ${r.caminho}`).toBe(401);
  });
});

describe('T-0174 critério 6 — teto do ZIP antes de processar (RN-CAT-14)', () => {
  it('FL-API-06: 500 MiB + 1 byte → 422 RN-CAT-14 (zip_grande) com mensagem, sem nenhuma transação nem lote; 500 MiB exatos → 201', async () => {
    const m = montar();
    const acima = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo(LIMITES_ZIP_TETO.bytesZipMax + 1) });
    expect(acima.statusCode).toBe(422);
    const erro = ErroApiSchema.parse(acima.json());
    expect(erro).toMatchObject({ codigo: 'RN-CAT-14', detalhes: { motivo: 'zip_grande' } });
    expect(erro.mensagem).toContain('500 MB');
    expect(m.tenants).toEqual([]);
    expect(m.lotes.size).toBe(0);
    const no = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo(LIMITES_ZIP_TETO.bytesZipMax) });
    expect(no.statusCode).toBe(201);
    const r = FotoLoteCriadoSchema.parse(no.json());
    // 500 MiB em partes de 8 MiB = 63 partes (62,5 arredondado para cima)
    expect(r.envio).toEqual({ arquivo_id: ARQ, parte_bytes: PARTE_ENVIO_BYTES, partes: Math.ceil(LIMITES_ZIP_TETO.bytesZipMax / PARTE_ENVIO_BYTES) });
  });

  it('FL-API-07: o parâmetro do tenant só BAIXA o teto: 100 MB vale (100 MB + 1 → 422 com "100 MB" na mensagem); 900 MB é ignorado (500 MB + 1 → 422)', async () => {
    const baixo = montar({ parametrosCatalogo: { foto_lote_zip_max: 100 * MIB } });
    const r1 = await baixo.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo(100 * MIB + 1) });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().mensagem).toContain('100 MB');
    await baixo.app.close();
    app = null;
    const alto = montar({ parametrosCatalogo: { foto_lote_zip_max: 900 * MIB } });
    const r2 = await alto.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo(LIMITES_ZIP_TETO.bytesZipMax + 1) });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().mensagem).toContain('500 MB');
  });
});

describe('T-0174 critérios 5 e 10 — idempotência do POST e evento na outbox', () => {
  it('FL-API-08: o mesmo POST (mesmo id) devolve o mesmo lote, sem segunda linha nem segundo arquivo; o ZIP é registrado como application/zip do Catálogo', async () => {
    const m = montar();
    const a = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo() });
    const b = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo() });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(FotoLoteCriadoSchema.parse(b.json()).lote.id).toBe(FotoLoteCriadoSchema.parse(a.json()).lote.id);
    expect(m.lotes.size).toBe(1);
    expect(m.arquivos.size).toBe(1);
    expect(m.arquivos.get(ARQ)).toMatchObject({ modulo: 'catalogo', tipo: 'application/zip', entidade: 'foto_lote', entidade_id: LOTE, enviado_por: usuarios.analista!.id });
  });

  it('FL-API-09: enfileirar com o ZIP ainda aguardando → 409 ENVIO_INCOMPLETO e nada na outbox', async () => {
    const m = montar();
    await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo() });
    const r = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotoLoteEnfileirar), headers: cab('analista') });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'ENVIO_INCOMPLETO' });
    expect(m.eventos).toEqual([]);
  });

  it('FL-API-10: com o ZIP recebido, enfileirar publica catalogo.foto_lote.enfileirado@1 UMA vez na outbox (payload válido no Zod @1); repetir não publica de novo', async () => {
    const m = montar();
    await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo() });
    m.arquivos.get(ARQ)!.situacao = 'recebido';
    m.arquivos.get(ARQ)!.tamanho_bytes = 50 * MIB;
    const r1 = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotoLoteEnfileirar), headers: cab('analista') });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ id: LOTE, situacao: 'enfileirado' });
    const r2 = await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotoLoteEnfileirar), headers: cab('analista') });
    expect(r2.statusCode).toBe(200);
    expect(m.eventos.map((e) => e.nome)).toEqual(['catalogo.foto_lote.enfileirado@1']);
    const p = FotoLoteEnfileiradoSchema.parse(m.eventos[0]!.payload);
    expect(p).toMatchObject({ lote_id: LOTE, arquivo_id: ARQ, enviado_por: usuarios.analista!.id });
  });

  it('FL-API-11: lote inexistente (ou de outro tenant, escondido pelo RLS) → 404 no GET, nos itens, no relatório e no enfileirar', async () => {
    const m = montar();
    for (const r of ROTAS.filter((x) => x.caminho.includes(':id'))) {
      const resp = await chamar(m.app, r, 'analista');
      expect(resp.statusCode, `${r.metodo} ${r.caminho}`).toBe(404);
      expect(resp.json(), `${r.metodo} ${r.caminho}`).toMatchObject({ codigo: 'LOTE_NAO_ENCONTRADO' });
    }
  });
});

describe('T-0174 critério 8 — CSV do relatório pela rota (anti-injeção de fórmula)', () => {
  it('FL-API-12: o download sai como text/csv com nosniff e nome sem dado pessoal; célula que começa com = + - @ tab CR ganha apóstrofo, inclusive o código lido do nome', async () => {
    const m = montar();
    await m.app.inject({ method: 'POST', url: url(ROTAS_CATALOGO.fotosLote), headers: cab('analista'), payload: corpo() });
    const perigosos = ['=HYPERLINK("http://x")', '+1+1.jpg', '-2+3.jpg', '@SOMA(1).jpg', '\tTAB.jpg', '\rCR.jpg'];
    perigosos.forEach((nome, i) =>
      m.itens.push({ lote_id: LOTE, indice: i, caminho: nome, situacao: 'sem_produto', motivo: null, tipo_detectado: null, codigo: nome.replace(/\.jpg$/, ''), ordem: null, produto_id: null, produto_codigo: null, codigos_candidatos: null }),
    );
    m.itens.push({ lote_id: LOTE, indice: 9, caminho: 'Ab.jpg', situacao: 'ambiguo', motivo: null, tipo_detectado: null, codigo: 'Ab', ordem: null, produto_id: null, produto_codigo: null, codigos_candidatos: ['=ab', 'AB'] });
    const r = await m.app.inject({ method: 'GET', url: url(ROTAS_CATALOGO.fotoLoteRelatorio), headers: cab('analista') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/csv/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-disposition']).toBe(`attachment; filename="fotos-lote-${LOTE.slice(0, 8)}.csv"`);
    const linhas = r.body.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
    expect(linhas).toHaveLength(1 + perigosos.length + 1);
    // nenhuma célula do CSV começa (depois da aspa opcional) com um gatilho de fórmula
    for (const linha of linhas.slice(1)) {
      for (const celula of linha.split(';')) expect(celula.replace(/^"/, ''), linha).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(linhas[1]).toContain(`'=HYPERLINK`);
    expect(linhas[1]).toContain('Sem produto');
    expect(linhas.at(-1)).toContain('Ambígu');
  });
});
