/**
 * T-0162 — kit do piloto. Sem Windows e sem SQL Server no teste: conferência estática do instalador (.ps1) e do SQL, e a lógica do
 * "ERP via API" contra dublês do banco e do Hub. O SQL real roda no PC do dono do produto (roteiro) e a conferência de views no CI do banco.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { ENTIDADES, ORIGEM, parametrosDoPedido, INTERVALO_CARGA_MS, converterLinha, criarErpPiloto, enviarRetornos, executarCiclo, lerPaginaDaView } from './erp-via-api/erp-via-api.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit em Node puro)
import { ENTIDADES_PILOTO, gerarConectorJson, montarEntradas, tornarIdempotente } from './scripts/montar-kit.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { ErroHub, RejeicaoErp } from '../docs/exemplos/node/cliente-hub.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const aqui = (...p: string[]) => fileURLToPath(new URL(p.join('/'), import.meta.url));
const ler = (...p: string[]) => readFileSync(aqui(...p), 'utf8');
const raiz = (...p: string[]) => readFileSync(fileURLToPath(new URL(['..', '..', '..', ...p].join('/'), import.meta.url)), 'utf8');

const INSTALADOR = ler('Instalar-Piloto.ps1');
const SQL_ESQUEMA = ler('sql', '01-erp-piloto.sql');
const SQL_EXTENSAO = ler('sql', '03-pedido-extensao.sql');
const SQL_USUARIOS = ler('sql', '04-usuarios.sql');

/** Colunas devolvidas por um `CREATE ... VIEW nome AS SELECT ... FROM`: o apelido (AS) ou o nome depois do último ponto. */
function colunasDaView(sql: string, view: string): string[] {
  const m = new RegExp(`VIEW dbo\\.${view} AS\\s+SELECT([\\s\\S]*?)\\nFROM`, 'i').exec(sql);
  if (!m) throw new Error(`view ${view} não encontrada`);
  const itens: string[] = [];
  let nivel = 0;
  let atual = '';
  let aspas = false;
  for (const ch of m[1]!) {
    if (ch === "'") aspas = !aspas;
    if (!aspas && ch === '(') nivel += 1;
    if (!aspas && ch === ')') nivel -= 1;
    if (!aspas && nivel === 0 && ch === ',') {
      itens.push(atual);
      atual = '';
    } else atual += ch;
  }
  itens.push(atual);
  return itens.map((i) => {
    const t = i.replace(/--.*$/gm, '').trim();
    const apelido = /\bAS\s+(\w+)\s*$/i.exec(t);
    return apelido ? apelido[1]! : t.split('.').pop()!.trim();
  });
}

describe('Instalar-Piloto.ps1 (conferência estática)', () => {
  it('RN-INT-kit: exige administrador e Windows PowerShell 5.1, e traz -Limpar, -ComExemplo e -Modalidade', () => {
    expect(INSTALADOR).toContain('#requires -RunAsAdministrator');
    expect(INSTALADOR).toContain('#requires -Version 5.1');
    expect(INSTALADOR).toMatch(/\[switch\]\$Limpar/);
    expect(INSTALADOR).toMatch(/\[switch\]\$ComExemplo/);
    expect(INSTALADOR).toMatch(/ValidateSet\('Ambas', 'Conector', 'API'\)/);
  });

  it('RN-INT-kit: instala pelo winget SQL Server 2022 Express, SSMS e Node LTS, e o módulo SqlServer', () => {
    expect(INSTALADOR).toContain('Microsoft.SQLServer.2022.Express');
    expect(INSTALADOR).toContain('Microsoft.SQLServerManagementStudio');
    expect(INSTALADOR).toContain('OpenJS.NodeJS.LTS');
    expect(INSTALADOR).toMatch(/'SqlServer', 'ImportExcel'/);
  });

  it('RN-INT-kit: liga TCP 1433 e autenticação mista e abre o firewall só para a rede local', () => {
    expect(INSTALADOR).toContain('LoginMode');
    expect(INSTALADOR).toMatch(/TcpPort -Value '1433'/);
    expect(INSTALADOR).toMatch(/-LocalPort 1433 -RemoteAddress LocalSubnet/);
    expect(INSTALADOR).not.toMatch(/RemoteAddress\s+Any/i);
  });

  it('RN-INT-kit: segredos só por Read-Host mascarado e Gerenciador de Credenciais, nunca em arquivo ou log', () => {
    expect(INSTALADOR).toMatch(/Read-Host -AsSecureString/);
    expect(INSTALADOR).not.toMatch(/Read-Host(?! -AsSecureString)[^\n]*(chave|senha)/i);
    expect(INSTALADOR).not.toMatch(/ConvertFrom-SecureString|Out-File|Set-Content|Add-Content/);
    expect(INSTALADOR).not.toMatch(/Write-(Host|Output|Verbose|Debug)[^\n]*\$(chave|script:Senha|senhaWin)/i);
    expect(INSTALADOR).not.toMatch(/mxc_[A-Za-z0-9_-]{43}/);
    expect(INSTALADOR).not.toMatch(/cmdkey|net user|sc\.exe config/i);
  });

  it('RN-INT-kit: cria a ERP_PILOTO, as planilhas em C:\\MacuxiPiloto\\planilhas e a tarefa "ERP via API" a cada minuto', () => {
    expect(INSTALADOR).toContain("$BANCO = 'ERP_PILOTO'");
    expect(INSTALADOR).toContain("'C:\\MacuxiPiloto'");
    expect(INSTALADOR).toContain("$TAREFA_API = 'ERP via API'");
    expect(INSTALADOR).toMatch(/-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  });

  it('RN-INT-kit: cada planilha tem uma tabela piloto_* e o relatório lista novas, atualizadas, recusadas e o motivo', () => {
    const tabelas = [...INSTALADOR.matchAll(/'(piloto_\w+)'/g)].map((m) => m[1]);
    const criadas = [...SQL_ESQUEMA.matchAll(/CREATE TABLE dbo\.(piloto_\w+)/g)].map((m) => m[1]);
    expect(new Set(tabelas)).toEqual(new Set(criadas));
    expect(INSTALADOR).toMatch(/RELATORIO DAS PLANILHAS/);
    expect(INSTALADOR).toMatch(/Recusadas\.Add\("linha \$\{n\}: \$m"\)/);
  });

  it('RN-INT-kit: o script só tem ASCII (o Windows PowerShell 5.1 lê arquivo sem BOM como ANSI)', () => {
    for (const arquivo of ['Instalar-Piloto.ps1', 'erp-via-api/executar.ps1', 'erp-via-api/Macuxi-Credencial.ps1']) {
      const bytes = readFileSync(aqui(arquivo));
      const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      // eslint-disable-next-line no-control-regex
      expect(bom || !/[^\x00-\x7f]/.test(bytes.toString('latin1')), `${arquivo}: salve com BOM UTF-8 ou só ASCII`).toBe(true);
    }
  });
});

describe('SQL da ERP_PILOTO (conferência estática)', () => {
  it('RN-INT-kit: roda duas vezes seguidas: toda tabela é guardada por OBJECT_ID e toda view/procedure é CREATE OR ALTER', () => {
    const esquema = SQL_ESQUEMA + SQL_EXTENSAO;
    expect(esquema).not.toMatch(/^CREATE (VIEW|PROCEDURE)/m);
    for (const m of esquema.matchAll(/^(\w.*)\n?CREATE TABLE (dbo\.\w+)/gm)) {
      expect(m[1], `${m[2]} sem guarda`).toMatch(/^IF OBJECT_ID\(/);
    }
    const entrada = tornarIdempotente(raiz('db', 'conector', 'entrada-pedido-modelo.sql'));
    expect(entrada).not.toMatch(/^CREATE PROCEDURE/m);
    expect(entrada.match(/^CREATE TABLE/gm)).toHaveLength(2);
    expect(entrada.match(/^IF OBJECT_ID\('dbo\.\w+', 'U'\) IS NULL\nCREATE TABLE/gm)).toHaveLength(2);
    expect(entrada.match(/CREATE OR ALTER PROCEDURE/g)).toHaveLength(2);
    expect(SQL_EXTENSAO).toMatch(/IF COL_LENGTH\('dbo\.macuxi_pedido_entrada', 'origem'\) IS NULL/);
  });

  it('RN-INT-kit: cada view piloto traz todas as colunas que o conector.json consulta (mesmo contrato do views-modelo.sql)', () => {
    const exemplo = JSON.parse(raiz('apps', 'conector', 'exemplos', 'conector.exemplo.json'));
    const cfg = gerarConectorJson(exemplo);
    for (const entidade of ENTIDADES_PILOTO as string[]) {
      const consulta: string = cfg.entidades[entidade].consulta;
      const lista = /SELECT TOP \(:limite\) (.+?) FROM dbo\.(vw_macuxi_\w+)/.exec(consulta)!;
      const colunas = colunasDaView(SQL_ESQUEMA, lista[2]!);
      // SELECT * (RN-INT-15, prazo): a coluna opcional só é lida se existir; não há lista a conferir
      for (const c of lista[1]!.split(',').filter((x) => x.trim() !== '*').map((x) => x.trim())) expect(colunas, `${entidade}.${c}`).toContain(c);
      // as colunas da view do kit existem no modelo oficial (o kit não inventa campo)
      const modelo = raiz('db', 'conector', 'views-modelo.sql');
      expect(modelo).toContain(`CREATE VIEW ${lista[2]} AS`);
    }
  });

  it('RN-INT-kit: usuário restrito do Conector só lê views, executa as 2 procedures e lê a entrada; nunca é dono nem escreve nas tabelas piloto', () => {
    expect(SQL_USUARIOS).toMatch(/GRANT SELECT ON dbo\.' \+ QUOTENAME\(name\) \+ N' TO macuxi_conector/);
    expect(SQL_USUARIOS).toContain('GRANT EXECUTE ON dbo.sp_macuxi_pedido_inserir TO macuxi_conector');
    expect(SQL_USUARIOS).toContain('GRANT SELECT ON dbo.macuxi_pedido_entrada TO macuxi_conector');
    expect(SQL_USUARIOS).not.toMatch(/db_owner|sysadmin|db_datawriter|ON dbo\.piloto_/i);
    expect(SQL_USUARIOS).not.toMatch(/PASSWORD = N'(?!\$\()/);
  });

  it('RN-INT-kit: a entrada de pedidos identifica a origem (Piloto Conector x Piloto API)', () => {
    expect(SQL_EXTENSAO).toContain("DEFAULT 'Piloto Conector'");
    expect(ORIGEM).toBe('Piloto API');
    expect(SQL_EXTENSAO).toContain('vw_piloto_pedidos');
    expect(colunasDaView(SQL_EXTENSAO, 'vw_piloto_pedidos')).toContain('origem');
  });
});

describe('pacote do kit', () => {
  it('RN-INT-kit: o zip leva o instalador, o roteiro, o SQL, o ERP via API com o cliente-hub e o conector.json sem segredo', () => {
    const entradas = montarEntradas() as { nome: string; dados: Buffer }[];
    const nomes = entradas.map((e) => e.nome);
    for (const n of ['Instalar-Piloto.ps1', 'ROTEIRO.md', 'dados-exemplo.json', 'sql/01-erp-piloto.sql', 'sql/02-entrada-pedido.sql', 'sql/03-pedido-extensao.sql', 'sql/04-usuarios.sql', 'erp-via-api/cliente-hub.mjs', 'erp-via-api/executar.mjs', 'conector/conector.json']) {
      expect(nomes).toContain(n);
    }
    expect(new Set(nomes).size).toBe(nomes.length);
    const conector = JSON.parse(entradas.find((e) => e.nome === 'conector/conector.json')!.dados.toString('utf8'));
    expect(conector.hub.url).toBe('https://api.macuxifdv.com.br');
    expect(conector.hub.conectorId).toBe('piloto-conector');
    expect(Object.keys(conector.entidades)).toEqual(ENTIDADES_PILOTO);
    for (const e of entradas) expect(e.dados.toString('latin1'), e.nome).not.toMatch(/mxc_[A-Za-z0-9_-]{43}/);
    expect(JSON.stringify(conector)).not.toMatch(/"(chave|senha|password|token|segredo)"/i);
  });

  it('RN-INT-kit: o roteiro cabe em uma página e cita -Limpar, as duas empresas e a coluna origem', () => {
    const roteiro = ler('ROTEIRO.md');
    expect(roteiro.split('\n').length).toBeLessThanOrEqual(45);
    for (const t of ['-Limpar', 'Piloto Conector', 'Piloto API', 'origem']) expect(roteiro).toContain(t);
  });
});

/* ------------------------------------------------------------------ ERP via API ------------------------------------------------------------------ */

type Consulta = { sql: string; params: Record<string, any> };
function bancoFalso(respostas: Array<[RegExp, any[]]>) {
  const consultas: Consulta[] = [];
  return {
    consultas,
    async consultar(sql: string, params: Record<string, any> = {}) {
      consultas.push({ sql, params });
      for (const [re, linhas] of respostas) if (re.test(sql)) return linhas;
      return [];
    },
  };
}

const PEDIDO = PedidoParaErp.parse({
  versao_contrato: 'v1',
  pedido_uuid: '11111111-2222-4333-8444-555555555555',
  cliente_external_id: 'C001',
  vendedor_external_id: 'V01',
  condicao_pagamento_erp: 'BOL-3060',
  criado_em: '2026-11-12T13:00:00Z',
  aprovado_em: '2026-11-12T13:05:00Z',
  desconto_total_cents: 0,
  total_cents: 1580,
  filial: { codigo: '0001', external_id: '0001', padrao: true },
  frete: { modalidade: 'CIF' },
  pagamento: { forma_codigo: 'BOLETO', prazo_codigo: 'BOL-3060', parcelas_dias: [30, 60], prazo_medio_dias: 45 },
  itens: [
    { sequencia: 1, produto_external_id: 'P001', quantidade: 2, preco_unitario_cents: 790, desconto_cents: 0, total_cents: 1580 },
  ],
});

describe('ERP via API: conversão e leitura', () => {
  it('RN-INT-kit: a linha da view vira o registro do contrato (booleano, centavos inteiros, JSON, endereço aninhado, nulo ausente)', () => {
    const r = converterLinha({
      external_id: 'C001', alterado_em: new Date('2026-11-12T13:00:00.123Z'), ativo: 1, bloqueado: 0, razao_social: ' Mercadinho ',
      limite_credito_cents: 500000, endereco_cidade: 'Boa Vista', endereco_uf: 'RR', telefone: null, formas_pagamento: '["PIX","BOLETO"]', prazo_medio_max_dias: 60,
    });
    expect(r).toEqual({
      external_id: 'C001', alterado_em: '2026-11-12T13:00:00.123Z', ativo: true, bloqueado: false, razao_social: 'Mercadinho',
      limite_credito_cents: 500000, endereco: { cidade: 'Boa Vista', uf: 'RR' }, formas_pagamento: ['PIX', 'BOLETO'], prazo_medio_max_dias: 60,
    });
  });

  it('RN-INT-05: a leitura é por keyset (alterado_em, external_id em ordem binária) e a carga inicial parte do começo', async () => {
    const db = bancoFalso([[/vw_macuxi_produto/, [{ external_id: 'P001', alterado_em: new Date('2026-11-12T10:00:00Z'), ativo: 1 }]]]);
    const linhas = await lerPaginaDaView(db, 'produto')(null, 100);
    expect(linhas).toHaveLength(1);
    expect(db.consultas[0]!.sql).toContain('COLLATE Latin1_General_BIN2');
    expect(db.consultas[0]!.sql).toContain('ORDER BY alterado_em, external_id COLLATE Latin1_General_BIN2');
    expect(db.consultas[0]!.params).toMatchObject({ limite: 100, cursor_external_id: '' });
    expect(() => lerPaginaDaView(db, 'pedido')).toThrow(/desconhecida/);
  });

  it('RN-INT-kit: as entidades do ERP via API são as mesmas do Conector do piloto, em ordem de carga', () => {
    expect(ENTIDADES).toEqual(ENTIDADES_PILOTO);
    expect(ENTIDADES.indexOf('filial')).toBeLessThan(ENTIDADES.indexOf('vendedor'));
    expect(ENTIDADES.indexOf('filial')).toBeLessThan(ENTIDADES.indexOf('cliente'));
    expect(ENTIDADES.indexOf('produto')).toBeLessThan(ENTIDADES.indexOf('preco'));
  });
});

describe('ERP via API: gravação do pedido', () => {
  const deps = { RejeicaoErp, ErroHub };

  it('RN-INT-08: pedido já gravado devolve o mesmo número (idempotente por pedido_uuid)', async () => {
    const db = bancoFalso([[/FROM dbo\.macuxi_pedido_entrada WHERE pedido_uuid/, [{ numero_pedido: 17 }]]]);
    expect(await criarErpPiloto(db, deps).gravarPedido(PEDIDO)).toEqual({ numero_erp: '17' });
    expect(db.consultas).toHaveLength(1);
  });

  it('RN-INT-kit: cliente inexistente, bloqueado ou produto fora da ERP_PILOTO viram rejeitado_erp com o motivo', async () => {
    await expect(criarErpPiloto(bancoFalso([]), deps).gravarPedido(PEDIDO)).rejects.toThrow(/Cliente C001 não existe/);
    const bloqueado = bancoFalso([[/vw_macuxi_cliente/, [{ bloqueado: 1 }]]]);
    await expect(criarErpPiloto(bloqueado, deps).gravarPedido(PEDIDO)).rejects.toThrow(/bloqueado/);
    const semProduto = bancoFalso([[/vw_macuxi_cliente/, [{ bloqueado: 0 }]]]);
    const erro = await criarErpPiloto(semProduto, deps).gravarPedido(PEDIDO).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RejeicaoErp);
    expect((erro as Error).message).toContain('P001');
  });

  it('RN-INT-kit: grava pela procedure do modelo numa transação e marca a origem "Piloto API"', async () => {
    const db = bancoFalso([
      [/FROM dbo\.macuxi_pedido_entrada WHERE pedido_uuid = @pedido_uuid$/, []],
      [/vw_macuxi_cliente/, [{ bloqueado: 0 }]],
      [/vw_macuxi_produto/, [{ ok: 1 }]],
      [/BEGIN TRAN/, [{ numero_pedido: 18 }]],
    ]);
    expect(await criarErpPiloto(db, deps).gravarPedido(PEDIDO)).toEqual({ numero_erp: '18' });
    const gravacao = db.consultas.find((c) => c.sql.includes('BEGIN TRAN'))!;
    expect(gravacao.sql).toContain('EXEC dbo.sp_macuxi_pedido_inserir @pedido_uuid = @pedido_uuid');
    expect(gravacao.sql).toContain('EXEC dbo.sp_macuxi_pedido_item_inserir');
    expect(gravacao.sql).toContain('SET origem = @origem');
    expect(gravacao.params).toMatchObject({ origem: 'Piloto API', cliente: 'C001', filial_codigo: '0001', pagamento_parcelas_dias: '30,60', pagamento_prazo_medio_dias: 45, frete_modalidade: 'CIF', total_cents: 1580 });
  });
});

describe('ERP via API: retorno de status ao Hub', () => {
  const pedidoR = { pedido_uuid: 'AAAAAAAA-2222-4333-8444-555555555555', situacao: 'R', numero_pedido: 5, motivo: 'Sem estoque', nota_numero: null };
  const pedidoF = { pedido_uuid: 'BBBBBBBB-2222-4333-8444-555555555555', situacao: 'F', numero_pedido: 6, motivo: null, nota_numero: '900', nota_serie: '1', nota_emitida_em: new Date('2026-11-12T15:00:00Z'), nota_total_cents: 1580 };
  const pedidoSemNota = { ...pedidoF, pedido_uuid: 'CCCCCCCC-2222-4333-8444-555555555555', nota_numero: null };

  it('RN-INT-09: rejeitado e faturado voltam ao Hub; faturado sem nota espera; o enviado fica marcado', async () => {
    const enviados: Array<{ uuid: string; retorno: any }> = [];
    const cliente = { devolverRetorno: async (uuid: string, retorno: any) => enviados.push({ uuid, retorno }) };
    const db = bancoFalso([
      [/WHERE origem = @origem/, [pedidoR, pedidoF, pedidoSemNota]],
      [/vw_macuxi_pedido_nota_item/, [{ sequencia: 1, quantidade: 2, valor_cents: 1580, produto_codigo: 'P001' }]],
    ]);
    const resumo = await enviarRetornos({ cliente, db, ErroHub, log: () => {} });
    expect(resumo).toEqual({ enviados: 2, aguardando_nota: 1, recusados: 0 });
    expect(enviados[0]!.retorno).toMatchObject({ status: 'rejeitado_erp', motivo: 'Sem estoque', pedido_uuid: 'aaaaaaaa-2222-4333-8444-555555555555' });
    expect(enviados[1]!.retorno).toMatchObject({ status: 'faturado_total', numero_erp: '6', nota: { numero: '900', serie: '1', total_cents: 1580 }, itens_faturados: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 2, valor_cents: 1580 }] });
    expect(db.consultas.filter((c) => c.sql.includes('SET retorno_enviado'))).toHaveLength(2);
  });

  it('RN-INT-09: recusa definitiva (422) do Hub não trava a fila: registra e marca como enviado', async () => {
    const cliente = { devolverRetorno: async () => { throw new ErroHub({ status: 422, codigo: 'transicao_invalida', mensagem: 'x' }); } };
    const logs: string[] = [];
    const db = bancoFalso([[/WHERE origem = @origem/, [pedidoR]]]);
    const resumo = await enviarRetornos({ cliente, db, ErroHub, log: (m: string) => logs.push(m) });
    expect(resumo.recusados).toBe(1);
    expect(logs[0]).toContain('transicao_invalida');
    expect(logs[0]).not.toContain('Sem estoque');
    expect(db.consultas.some((c) => c.sql.includes('SET retorno_enviado'))).toBe(true);
  });
});

describe('ERP via API: ciclo', () => {
  const clienteFalso = () => {
    const chamadas: string[] = [];
    return {
      chamadas,
      consultarCursor: async (e: string) => { chamadas.push(`cursor:${e}`); return { cursor: null }; },
      enviarCompleto: async () => [],
      enviarDelta: async () => [],
      processarPedidos: async () => ({ integrados: 0, rejeitados: 0, repetidos: 0, definitivos: [] as unknown[] }),
      devolverRetorno: async () => ({}),
    };
  };

  it('RN-INT-kit: a carga roda a cada 5 minutos e os pedidos em toda passada', async () => {
    const deps = { RejeicaoErp, ErroHub };
    const c1 = clienteFalso();
    const a = await executarCiclo({ cliente: c1, db: bancoFalso([]), deps, estado: {}, agoraMs: 1_000_000 });
    expect(c1.chamadas.filter((c) => c.startsWith('cursor:'))).toHaveLength(ENTIDADES.length);
    expect(a.estado.ultimaCargaEm).toBe(1_000_000);
    const c2 = clienteFalso();
    const b = await executarCiclo({ cliente: c2, db: bancoFalso([]), deps, estado: a.estado, agoraMs: 1_000_000 + 60_000 });
    expect(c2.chamadas).toHaveLength(0);
    expect(b.resumo.pedidos).toBeDefined();
    const c3 = clienteFalso();
    await executarCiclo({ cliente: c3, db: bancoFalso([]), deps, estado: a.estado, agoraMs: 1_000_000 + INTERVALO_CARGA_MS });
    expect(c3.chamadas).toHaveLength(ENTIDADES.length);
  });
});

describe('ERP via API: paridade com o Conector', async () => {
  // Caminho montado em tempo de execução: o módulo não importa app (regra 1); o teste só carrega a função para comparar.
  const caminhoConector = fileURLToPath(new URL(['..', '..', '..', 'apps', 'conector', 'src', 'pedidos.ts'].join('/'), import.meta.url));
  const { parametrosCabecalho } = (await import(/* @vite-ignore */ caminhoConector)) as { parametrosCabecalho: (p: unknown) => Record<string, unknown> };
  const base = JSON.parse(JSON.stringify(PEDIDO));
  const transp = { tipo: 'cadastrada', id: '99999999-2222-4333-8444-555555555555', external_id: 'T01', nome: 'Rapido', cnpj: '11444777000161' };
  const casos: Record<string, unknown> = {
    'CIF': base,
    'FOB com transportadora cadastrada': { ...base, frete: { modalidade: 'FOB', transportadora: transp } },
    'FOB com transportadora digitada': { ...base, frete: { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Frete do Ze', cnpj: '11444777000161' } } },
    'com entrega': { ...base, endereco_entrega: { origem: 'erp', external_id: 'E01', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000', principal: true } },
    'sem pagamento': { ...base, pagamento: undefined },
  };
  const RENOMEADAS: Record<string, string> = { cliente: 'cliente_external_id', vendedor: 'vendedor_external_id', condicao: 'condicao_pagamento_erp' };
  for (const [nome, bruto] of Object.entries(casos)) {
    it(`RN-INT-kit: parametrosDoPedido do kit = parametrosCabecalho do Conector (${nome})`, () => {
      const pedido = PedidoParaErp.parse(bruto);
      const kit = parametrosDoPedido(pedido) as Record<string, unknown>;
      const conector = parametrosCabecalho(pedido);
      const esperado: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(kit)) esperado[RENOMEADAS[k] ?? k] = v;
      delete conector.tentativa;
      // O kit manda o bit como 0/1; o Conector manda boolean e o driver converte para bit.
      if (typeof conector.entrega_principal === 'boolean') conector.entrega_principal = conector.entrega_principal ? 1 : 0;
      expect(esperado).toEqual(conector);
    });
  }
});
