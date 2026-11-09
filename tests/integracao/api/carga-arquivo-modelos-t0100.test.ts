/**
 * T-0100 (carga por arquivo self-service no BKO; RF-INT-03, ADR 0033) pela API REAL: `createApp` com os 8 módulos, JWT de
 * verdade e Postgres como `macuxi_app` (RLS), na fixture dois-tenants num banco efêmero próprio do arquivo (apoio/api.ts).
 * Banco só no CI (sem Docker no PC do dono do produto, R-20261105-053835); a parte sem banco (C-*) roda em qualquer máquina.
 *
 * O que já está coberto e NÃO se repete aqui: a declaração das rotas e a matriz de fábrica da ação `carga.arquivo`
 * (modules/integracao/api/bko-modelos.test.ts), o handler do POST × Postgres (bko-carga-arquivo.db.test.ts) e as partes
 * puras da tela (web/lib/carga.test.ts).
 *
 * Casos (matriz docs/testes/T-0100.md):
 *  P-1  admin e analista de A baixam o modelo CSV (BOM, `text/csv`, `attachment; filename="<entidade>.csv"`) e o dicionário
 *       das 15 entidades; o conteúdo é exatamente o do contrato (`gerarModeloCsv` / `dicionarioDaEntidade`).
 *  P-2  vendedor, promotor, supervisor, gerente e assistente, COM a licença do módulo ligada para o perfil (para isolar o
 *       motor de permissões da licença): 403 PERFIL_SEM_ACESSO no modelo, no dicionário e no POST cargas-arquivo.
 *  P-3  licença: Integração desligada no tenant → 403 MODULO_INATIVO para o admin (antes do motor); sem token → 401.
 *  M-1  multi-tenant: o tenant vem só do token. Dica de outro tenant no cabeçalho/corpo é ignorada; B com o módulo
 *       desligado recebe MODULO_INATIVO mesmo mandando o tenant de A; o modelo é igual para as duas empresas.
 *  M-2  multi-tenant na carga: A não carrega no Conector de B (404 CONECTOR_NAO_ENCONTRADO); o lote de A nasce no tenant de A
 *       mesmo com `tenant_id` de B no corpo; o admin de B não vê o lote de A (404).
 *  C-1  o CSV do dicionário (o que o BKO baixa: `dicionarioParaCsv`) sai com `protegerFormula` em toda célula: o exemplo
 *       real `-60,6753` (longitude) e células maliciosas (`=`, `+`, `-`, `@`, tabulação) ganham o apóstrofo.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { semBanco } from '@macuxi/db/teste/estado';
import { CargaArquivoAceita, DicionarioModelo, ENTIDADES } from '@macuxi/integracao/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dicionarioDaEntidade, gerarModeloCsv } from '../../../modules/integracao/domain';
import { dicionarioParaCsv } from '../../../modules/integracao/web/lib/carga';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const RAIZ = join(__dirname, '..', '..', '..');
const BOM = '﻿';
const FORMULA = /^[=+\-@\t\r]/;
const OUTROS_PERFIS = ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const;
const EMAIL: Record<(typeof OUTROS_PERFIS)[number] | 'admin' | 'analista', string> = {
  admin: 'admin@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
  vendedor: 'vendedor@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  supervisor: 'supervisor@exemplo.com.br',
  gerente: 'gerente@exemplo.com.br',
  assistente: 'assistente@exemplo.com.br',
};

/** Células de um CSV `;` com aspas (RFC 4180), sem o BOM. */
function celulasDoCsv(csv: string): string[][] {
  const texto = csv.startsWith(BOM) ? csv.slice(1) : csv;
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i]!;
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') {
        cel += '"';
        i += 1;
      } else if (ch === '"') aspas = false;
      else cel += ch;
    } else if (ch === '"' && cel === '') aspas = true;
    else if (ch === ';') {
      linha.push(cel);
      cel = '';
    } else if (ch === '\r' && texto[i + 1] === '\n') {
      linha.push(cel);
      linhas.push(linha);
      linha = [];
      cel = '';
      i += 1;
    } else cel += ch;
  }
  if (cel !== '' || linha.length > 0) linhas.push([...linha, cel]);
  return linhas;
}

// ------------------------------------------------------------------------------------------------ sem banco (qualquer máquina)

describe('T-0100 C-1 — CSV do dicionário com protegerFormula (CWE-1236)', () => {
  it.each(ENTIDADES)('C-1a. "%s": nenhuma célula do dicionário em CSV começa com =, +, -, @, tabulação ou retorno', (entidade) => {
    const csv = dicionarioParaCsv(dicionarioDaEntidade(entidade));
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const linhas = celulasDoCsv(csv);
    expect(linhas[0]).toEqual(['campo', 'obrigatorio', 'tipo', 'tamanho_max', 'formato', 'exemplo', 'observacao']);
    expect(linhas).toHaveLength(dicionarioDaEntidade(entidade).campos.length + 1);
    for (const [n, l] of linhas.entries()) for (const c of l) expect(c, `linha ${n + 1}: ${c}`).not.toMatch(FORMULA);
  });

  it('C-1b. o exemplo real da longitude (-60,6753) sai como texto no dicionário de cliente e de cliente_endereco', () => {
    for (const entidade of ['cliente', 'cliente_endereco'] as const) {
      const d = dicionarioDaEntidade(entidade);
      const lon = d.campos.find((c) => c.exemplo.startsWith('-'));
      expect(lon, `${entidade}: campo com exemplo negativo`).toBeDefined();
      const linha = celulasDoCsv(dicionarioParaCsv(d)).find((l) => l[0] === lon!.campo);
      expect(linha?.[5]).toBe(`'${lon!.exemplo}`);
    }
  });

  it('C-1c. células maliciosas (=, +, -, @, tabulação, retorno) ganham o apóstrofo; ; e aspas continuam escapados', () => {
    const d = DicionarioModelo.parse({
      entidade: 'cliente',
      arquivo: 'cliente.csv',
      ordem: 1,
      depende_de: [],
      opcional: false,
      campos: [
        { campo: '=cmd|"/c calc"!A1', obrigatorio: true, tipo: 'texto', tamanho_max: 10, formato: '+55', exemplo: '-1+1', observacao: '@SOMA(A1)' },
        { campo: 'tab', obrigatorio: false, tipo: 'texto', tamanho_max: null, formato: '\tx', exemplo: '\rx', observacao: 'a;b "c"' },
      ],
    });
    const linhas = celulasDoCsv(dicionarioParaCsv(d));
    expect(linhas[1]).toEqual([`'=cmd|"/c calc"!A1`, 'sim', 'texto', '10', "'+55", "'-1+1", "'@SOMA(A1)"]);
    expect(linhas[2]).toEqual(['tab', 'não', 'texto', '', "'\tx", "'\rx", 'a;b "c"']);
  });

  it('C-1d. o botão "Dicionário" do BKO baixa pelo dicionarioParaCsv (não monta outro CSV sem a proteção)', () => {
    const q = readFileSync(join(RAIZ, 'modules/integracao/web/lib/carga-queries.ts'), 'utf8');
    expect(q).toMatch(/export async function baixarDicionario[\s\S]{0,400}dicionarioParaCsv\(d\)/);
    const tela = readFileSync(join(RAIZ, 'modules/integracao/web/components/carga-arquivo-page.tsx'), 'utf8');
    expect(tela).toContain('baixarDicionario(m.entidade)');
  });
});

// ------------------------------------------------------------------------------------------------ API real × Postgres (CI)

describe.skipIf(semBanco())('T-0100 — modelos, dicionário e carga por arquivo no BKO pela API real (perfil, licença, tenant)', () => {
  let api: ApiDeTeste;
  const tk: Record<string, string> = {};
  let adminB = '';
  const ID_ARQ_A = `arq-a-${randomUUID().slice(0, 8)}`;
  const ID_ARQ_B = `arq-b-${randomUUID().slice(0, 8)}`;

  const modelo = (token: string | null, entidade: string, headers: Record<string, string> = {}) =>
    api.chamar(token, { method: 'GET', url: `/v1/integracao/modelos/${entidade}.csv`, headers });
  const dicionario = (token: string | null, entidade: string, headers: Record<string, string> = {}) =>
    api.chamar(token, { method: 'GET', url: `/v1/integracao/modelos/${entidade}/dicionario`, headers });
  const csvTransp = (pref: string) => `${BOM}external_id;nome;documento\n${pref}-1;Rápido Norte;\n${pref}-2;Boa Vista Cargas;\n`;
  const carregar = (token: string, corpo: Record<string, unknown>) =>
    api.chamar(token, {
      method: 'POST',
      url: '/v1/integracao/cargas-arquivo',
      payload: { entidade: 'transportadora', modo: 'delta', conteudo: csvTransp(`T100${randomUUID().slice(0, 4)}`), chave_idempotencia: `t0100-${randomUUID()}`, ...corpo },
    });

  beforeAll(async () => {
    api = await subirApi();
    tk.admin = (await api.sessao(EMAIL.admin)).access_token;
    // Integração ligada no tenant A e em TODOS os perfis: o 403 dos outros perfis tem de vir do motor (ação), não da licença
    expect((await licenca(api, tk.admin, 'tenant', 'integracao', true)).statusCode).toBe(200);
    for (const perfil of ['admin', 'analista', ...OUTROS_PERFIS]) {
      const r = await licenca(api, tk.admin, 'perfil', 'integracao', true, perfil);
      expect(r.statusCode, `${perfil}: ${r.body}`).toBe(200);
    }
    for (const p of ['analista', ...OUTROS_PERFIS] as const) tk[p] = (await api.sessao(EMAIL[p])).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    expect((await licenca(api, adminB, 'perfil', 'integracao', true, 'admin')).statusCode).toBe(200);
    // um Conector tipo arquivo por tenant (RN-INT-13), como o bko-carga-arquivo.db.test.ts do módulo
    const ins = (tenantId: string, identificador: string) =>
      api.admin.query(
        "insert into integracao.conector (tenant_id, identificador, nome, tipo, recebe_pedidos, entidades) values ($1, $2, 'Planilhas', 'arquivo', false, array['transportadora'])",
        [tenantId, identificador],
      );
    await ins(A.tenantId, ID_ARQ_A);
    await ins(B.tenantId, ID_ARQ_B);
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  it.each(['admin', 'analista'] as const)('P-1. %s baixa o modelo CSV e o dicionário das 15 entidades, iguais ao contrato', async (perfil) => {
    for (const entidade of ENTIDADES) {
      const m = await modelo(tk[perfil]!, entidade);
      expect(m.statusCode, `${perfil} ${entidade}: ${m.body}`).toBe(200);
      expect(m.headers['content-type']).toMatch(/^text\/csv/);
      expect(m.headers['content-disposition']).toBe(`attachment; filename="${entidade}.csv"`);
      expect(m.body.startsWith(BOM), `${entidade}: BOM`).toBe(true);
      expect(m.body).toBe(gerarModeloCsv(entidade).csv);

      const d = await dicionario(tk[perfil]!, entidade);
      expect(d.statusCode, `${perfil} ${entidade}: ${d.body}`).toBe(200);
      expect(DicionarioModelo.parse(d.json())).toEqual(dicionarioDaEntidade(entidade));
    }
  });

  it('P-1b. entidade desconhecida: 404 ENTIDADE_DESCONHECIDA (nada de arquivo); admin e analista também enviam a carga (202)', async () => {
    const r = await modelo(tk.admin!, 'pedido');
    expect(r.statusCode, r.body).toBe(404);
    expect(erroDe(r).codigo).toBe('ENTIDADE_DESCONHECIDA');
    expect(r.headers['content-disposition']).toBeUndefined();
    for (const perfil of ['admin', 'analista'] as const) {
      const c = await carregar(tk[perfil]!, {});
      expect(c.statusCode, `${perfil}: ${c.body}`).toBe(202);
      expect(CargaArquivoAceita.parse(c.json())).toMatchObject({ status: 'recebido', entidade: 'transportadora', conector_id: ID_ARQ_A, linhas_lidas: 2 });
    }
  });

  it.each(OUTROS_PERFIS)('P-2. %s (com a licença da Integração ligada) recebe 403 PERFIL_SEM_ACESSO no modelo, no dicionário e na carga', async (perfil) => {
    const token = tk[perfil]!;
    for (const [nome, r] of [
      ['modelo', await modelo(token, 'cliente')],
      ['dicionário', await dicionario(token, 'cliente')],
      ['carga', await carregar(token, {})],
    ] as const) {
      expect(r.statusCode, `${perfil} ${nome}: ${r.body}`).toBe(403);
      expect(erroDe(r).codigo, `${perfil} ${nome}`).toBe('PERFIL_SEM_ACESSO');
      expect(r.headers['content-disposition'], `${perfil} ${nome}`).toBeUndefined();
    }
  });

  it('P-3. sem token: 401; Integração desligada no tenant: 403 MODULO_INATIVO para o admin (licença antes do motor) → religa e volta', async () => {
    for (const r of [await modelo(null, 'cliente'), await dicionario(null, 'cliente')]) expect(r.statusCode, r.body).toBe(401);
    expect((await licenca(api, tk.admin!, 'tenant', 'integracao', false)).statusCode).toBe(200);
    try {
      for (const perfil of ['admin', 'analista', 'vendedor'] as const) {
        for (const r of [await modelo(tk[perfil]!, 'cliente'), await dicionario(tk[perfil]!, 'cliente')]) {
          expect(r.statusCode, `${perfil}: ${r.body}`).toBe(403);
          expect(erroDe(r).codigo, perfil).toBe('MODULO_INATIVO');
        }
      }
    } finally {
      expect((await licenca(api, tk.admin!, 'tenant', 'integracao', true)).statusCode).toBe(200);
    }
    expect((await modelo(tk.admin!, 'cliente')).statusCode).toBe(200);
  });

  it('M-1. o tenant vem só do token: dica de outro tenant é ignorada e B, com o módulo desligado, não baixa nem mandando o tenant de A', async () => {
    const dicaB = { 'x-tenant-id': B.tenantId, 'x-macuxi-tenant': B.tenantId, 'x-codigo-empresa': B.codigo };
    const dicaA = { 'x-tenant-id': A.tenantId, 'x-macuxi-tenant': A.tenantId, 'x-codigo-empresa': A.codigo };
    const semDica = await modelo(tk.admin!, 'cliente');
    const comDica = await modelo(tk.admin!, 'cliente', dicaB);
    expect(comDica.statusCode, comDica.body).toBe(200);
    expect(comDica.body).toBe(semDica.body);

    // B com a Integração desligada no tenant: a licença lida é a do tenant do TOKEN (B), não a da dica (A)
    expect((await licenca(api, adminB, 'tenant', 'integracao', false)).statusCode).toBe(200);
    for (const r of [await modelo(adminB, 'cliente', dicaA), await dicionario(adminB, 'cliente', dicaA)]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(erroDe(r).codigo).toBe('MODULO_INATIVO');
    }
    // ligada em B: o modelo e o dicionário são os mesmos de A (só o contrato; nada da empresa entra no arquivo)
    expect((await licenca(api, adminB, 'tenant', 'integracao', true)).statusCode).toBe(200);
    const mB = await modelo(adminB, 'cliente');
    expect(mB.statusCode, mB.body).toBe(200);
    expect(mB.body).toBe(semDica.body);
    expect((await dicionario(adminB, 'cliente')).json()).toEqual((await dicionario(tk.admin!, 'cliente')).json());
  });

  it('M-2. A não carrega no Conector de B (404) e o lote de A fica em A mesmo com tenant_id de B no corpo; o admin de B não vê o lote', async () => {
    const outro = await carregar(tk.admin!, { conector_id: ID_ARQ_B });
    expect(outro.statusCode, outro.body).toBe(404);
    expect(erroDe(outro).codigo).toBe('CONECTOR_NAO_ENCONTRADO');

    const r = await carregar(tk.admin!, { tenant_id: B.tenantId, empresa: B.codigo });
    expect(r.statusCode, r.body).toBe(202);
    const aceita = CargaArquivoAceita.parse(r.json());
    expect(aceita.conector_id).toBe(ID_ARQ_A);
    const { rows } = await api.admin.query<{ tenant_id: string }>('select tenant_id from integracao.lote where id = $1', [aceita.lote_id]);
    expect(rows).toEqual([{ tenant_id: A.tenantId }]);

    expect((await licenca(api, adminB, 'tenant', 'integracao', true)).statusCode).toBe(200);
    const vistoPorB = await api.chamar(adminB, { method: 'GET', url: `/v1/integracao/lotes/${aceita.lote_id}` });
    expect(vistoPorB.statusCode, vistoPorB.body).toBe(404);
    const vistoPorA = await api.chamar(tk.admin!, { method: 'GET', url: `/v1/integracao/lotes/${aceita.lote_id}` });
    expect(vistoPorA.statusCode, vistoPorA.body).toBe(200);
  });
});

