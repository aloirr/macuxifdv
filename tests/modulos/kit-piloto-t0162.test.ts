/**
 * T-0162 — kit do piloto: validação do agente testes (pedido R-20261112-113348-modulo-integracao).
 *
 * Sem Windows real e sem SQL Server (não há Docker no PC): o que se prova aqui é a lógica do "ERP via API" contra o contrato
 * oficial do pedido (`PedidoParaErp`) e contra dublês do banco e do Hub, mais a conferência estática do instalador, do SQL, do
 * zip e do roteiro. O 1º uso no notebook (roteiro) é o teste de aceite do que só o Windows prova.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto D-T0162-n (fica vermelho quando corrigido e vira `it` no mesmo commit).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PedidoParaErp } from '@macuxi/integracao/contracts';

type Linha = Record<string, unknown>;
type Banco = { consultas: { sql: string; params: Linha }[]; consultar: (sql: string, params?: Linha) => Promise<Linha[]> };
type Ler = (cursor: { alterado_em: string; external_id: string } | null, limite: number) => Promise<Linha[]>;
type ErroHubCtor = new (d: { status: number; codigo: string; mensagem: string }) => Error;

interface ErpViaApi {
  ORIGEM: string;
  ENTIDADES: string[];
  parametrosDoPedido: (p: unknown) => Linha;
  criarErpPiloto: (db: Banco, deps: { RejeicaoErp: new (m: string) => Error }) => { gravarPedido: (p: unknown) => Promise<{ numero_erp: string }> };
  enviarRetornos: (a: { cliente: unknown; db: Banco; ErroHub: ErroHubCtor; log: (m: string) => void }) => Promise<Linha>;
  executarCiclo: (a: { cliente: unknown; db: Banco; deps: unknown; estado?: Linha; agoraMs?: number; log?: (m: string) => void }) => Promise<{ estado: Linha; resumo: Linha }>;
  lerPaginaDaView: (db: Banco, entidade: string) => Ler;
}
interface ClienteHubMod {
  ErroHub: ErroHubCtor;
  RejeicaoErp: new (m: string) => Error;
  lerConfig: (env: Record<string, string>) => { url: string; conectorId: string };
}
interface MontarKit {
  ID_CONECTOR_PILOTO: string;
  ID_API_PILOTO: string;
  montarEntradas: (o?: { conectorZip?: string }) => { nome: string; dados: Buffer }[];
}

const KIT = new URL('../../modules/integracao/kit-piloto/', import.meta.url);
const noKit = (rel: string) => fileURLToPath(new URL(rel, KIT));
const lerKit = (rel: string) => readFileSync(noKit(rel), 'utf8');
const importar = async <T>(url: URL): Promise<T> => (await import(url.href)) as T;

const api = await importar<ErpViaApi>(new URL('erp-via-api/erp-via-api.mjs', KIT));
const hub = await importar<ClienteHubMod>(new URL('../../modules/integracao/docs/exemplos/node/cliente-hub.mjs', import.meta.url));
const kit = await importar<MontarKit>(new URL('scripts/montar-kit.mjs', KIT));
const deps = { RejeicaoErp: hub.RejeicaoErp, ErroHub: hub.ErroHub };

const INSTALADOR = lerKit('Instalar-Piloto.ps1');
const EXECUTAR_PS1 = lerKit('erp-via-api/executar.ps1');
const EXECUTAR_MJS = lerKit('erp-via-api/executar.mjs');
const SQL_ESQUEMA = lerKit('sql/01-erp-piloto.sql');
const SQL_EXTENSAO = lerKit('sql/03-pedido-extensao.sql');
const ROTEIRO = lerKit('ROTEIRO.md');

function bancoFalso(respostas: Array<[RegExp, Linha[] | Error]>): Banco {
  const consultas: Banco['consultas'] = [];
  return {
    consultas,
    async consultar(sql, params = {}) {
      consultas.push({ sql, params });
      for (const [re, r] of respostas) {
        if (!re.test(sql)) continue;
        if (r instanceof Error) throw r;
        return r;
      }
      return [];
    },
  };
}

/** Corpo de uma função do .ps1 (do `function Nome` até a próxima `function` de topo). */
function funcaoPs(nome: string): string {
  const inicio = INSTALADOR.indexOf(`function ${nome}`);
  if (inicio < 0) throw new Error(`função ${nome} não encontrada`);
  const fim = INSTALADOR.indexOf('\nfunction ', inicio + 1);
  return INSTALADOR.slice(inicio, fim < 0 ? undefined : fim);
}

/** Pedido válido pelo contrato oficial (o que o Hub entrega em GET /pedidos/pendentes). */
const pedidoDoContrato = (extra: Linha = {}) =>
  PedidoParaErp.parse({
    versao_contrato: 'v1',
    pedido_uuid: '11111111-2222-4333-8444-555555555555',
    cliente_external_id: 'C001',
    vendedor_external_id: 'V01',
    condicao_pagamento_erp: 'BOL-3060',
    criado_em: '2026-11-12T13:00:00Z',
    aprovado_em: '2026-11-12T13:05:00Z',
    total_cents: 1580,
    itens: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 2, preco_unitario_cents: 790, total_cents: 1580 }],
    filial: { codigo: '0001', external_id: '0001', padrao: true },
    pagamento: { forma_codigo: 'BOLETO', forma_external_id: 'BOLETO', prazo_codigo: 'BOL-3060', prazo_external_id: 'BOL-3060', parcelas_dias: [30, 60], prazo_medio_dias: 45 },
    ...extra,
  });

/* --------------------------------------------------------------- ERP via API × contrato --------------------------------------------------------------- */

describe('T-0162 ERP via API: pedido do contrato vira os parâmetros da procedure (mesmo resultado do Conector)', () => {
  it('D-T0162-1 corrigido (RN-VEN-24): forma e prazo de pagamento do contrato (campos planos forma_codigo/prazo_codigo) chegam à ERP_PILOTO', () => {
    const p = api.parametrosDoPedido(pedidoDoContrato());
    // O Conector (apps/conector/src/pedidos.ts, parametrosCabecalho) lê pg.forma_codigo; o ERP via API lê pg.forma.codigo e grava NULL.
    expect(p).toMatchObject({
      pagamento_forma_codigo: 'BOLETO',
      pagamento_forma_external_id: 'BOLETO',
      pagamento_prazo_codigo: 'BOL-3060',
      pagamento_prazo_external_id: 'BOL-3060',
    });
  });

  it('RN-VEN-24: parcelas e prazo médio do contrato chegam como no Conector ("30,60" e 45)', () => {
    expect(api.parametrosDoPedido(pedidoDoContrato())).toMatchObject({ pagamento_parcelas_dias: '30,60', pagamento_prazo_medio_dias: 45 });
  });

  it('RN-VEN-16: frete FOB com transportadora cadastrada leva id e external_id; digitada leva só nome, CNPJ e telefone', () => {
    const cadastrada = api.parametrosDoPedido(
      pedidoDoContrato({ frete: { modalidade: 'FOB', transportadora: { tipo: 'cadastrada', id: '22222222-3333-4444-8555-666666666666', external_id: 'TR1', nome: 'Trans Norte', cnpj: '11222333000181' } } }),
    );
    expect(cadastrada).toMatchObject({ frete_modalidade: 'FOB', frete_transportadora_tipo: 'cadastrada', frete_transportadora_id: '22222222-3333-4444-8555-666666666666', frete_transportadora_external_id: 'TR1', frete_transportadora_cnpj: '11222333000181' });
    const digitada = api.parametrosDoPedido(pedidoDoContrato({ frete: { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Frete do Zé', cnpj: '11444777000161' } } }));
    expect(digitada).toMatchObject({ frete_transportadora_tipo: 'digitada', frete_transportadora_id: null, frete_transportadora_external_id: null, frete_transportadora_nome: 'Frete do Zé' });
  });

  it('RN-INT-08: nenhum parâmetro sai undefined (o driver mssql exige tipo; undefined derrubaria a gravação)', () => {
    const p = api.parametrosDoPedido(PedidoParaErp.parse({ ...pedidoDoContrato(), pagamento: undefined, filial: undefined, frete: undefined }));
    for (const [k, v] of Object.entries(p)) expect(v, k).not.toBeUndefined();
  });
});

/* --------------------------------------------------------------- gravação --------------------------------------------------------------- */

describe('T-0162 ERP via API: gravação do pedido', () => {
  it('RN-INT-08: pedido rejeitado (cliente fora da ERP_PILOTO) não grava nada: nenhuma transação aberta', async () => {
    const db = bancoFalso([]);
    await expect(api.criarErpPiloto(db, deps).gravarPedido(pedidoDoContrato())).rejects.toBeInstanceOf(hub.RejeicaoErp);
    expect(db.consultas.some((c) => c.sql.includes('BEGIN TRAN'))).toBe(false);
  });

  it('RN-INT-08: vários itens (quantidade fracionada) entram na mesma transação, um EXEC por item, com a origem Piloto API', async () => {
    const pedido = pedidoDoContrato({
      total_cents: 2370,
      itens: [
        { sequencia: 1, produto_external_id: 'P001', quantidade: 2, preco_unitario_cents: 790, total_cents: 1580 },
        { sequencia: 2, produto_external_id: 'P005', quantidade: 0.5, preco_unitario_cents: 1580, total_cents: 790 },
      ],
    });
    const db = bancoFalso([
      [/WHERE pedido_uuid = @pedido_uuid$/, []],
      [/vw_macuxi_cliente/, [{ bloqueado: 0 }]],
      [/vw_macuxi_produto/, [{ ok: 1 }]],
      [/BEGIN TRAN/, [{ numero_pedido: 21 }]],
    ]);
    expect(await api.criarErpPiloto(db, deps).gravarPedido(pedido)).toEqual({ numero_erp: '21' });
    const tx = db.consultas.find((c) => c.sql.includes('BEGIN TRAN'))!;
    expect(tx.sql.match(/EXEC dbo\.sp_macuxi_pedido_item_inserir/g)).toHaveLength(2);
    expect(tx.sql.indexOf('COMMIT')).toBeGreaterThan(tx.sql.lastIndexOf('sp_macuxi_pedido_item_inserir'));
    expect(tx.params).toMatchObject({ seq1: 2, prod1: 'P005', qtd1: 0.5, desc1_cents: 0, origem: api.ORIGEM });
    expect(api.ORIGEM).toBe('Piloto API');
  });
});

/* --------------------------------------------------------------- carga --------------------------------------------------------------- */

describe('T-0162 ERP via API: carga', () => {
  it('RN-INT-05: com cursor no Hub a carga é delta e a leitura parte do cursor (alterado_em, external_id)', async () => {
    const db = bancoFalso([]);
    const cursor = { alterado_em: '2026-11-12T10:00:00.123Z', external_id: 'P001' };
    const modos: string[] = [];
    const cliente = {
      consultarCursor: async () => ({ cursor }),
      enviarCompleto: async () => { modos.push('completo'); return []; },
      enviarDelta: async (_e: string, ler: Ler, o: { cursor: typeof cursor }) => { modos.push('delta'); await ler(o.cursor, 10); return []; },
      processarPedidos: async () => ({ integrados: 0, rejeitados: 0, repetidos: 0, definitivos: [] }),
    };
    await api.executarCiclo({ cliente, db, deps, estado: {}, agoraMs: 1 });
    expect(new Set(modos)).toEqual(new Set(['delta']));
    const leitura = db.consultas.find((c) => c.sql.includes('vw_macuxi_produto'))!;
    expect((leitura.params.cursor_alterado_em as Date).toISOString()).toBe(cursor.alterado_em);
    expect(leitura.params.cursor_external_id).toBe('P001');
  });

  it('D-T0162-2 corrigido: a planilha de prazos só aceita parcelas que viram JSON válido na view (o CHECK deixa passar "30,,60" e "30,60,")', () => {
    // O CHECK é lido do 01-erp-piloto.sql e avaliado como o SQL Server avalia (LIKE com % e [^...]), sem modelo à parte.
    const check = /parcelas_dias VARCHAR\(\d+\) NOT NULL CHECK \((.+?)\),? --/.exec(SQL_ESQUEMA)?.[1];
    expect(check, 'CHECK do parcelas_dias não encontrado: ajuste este teste').toBeDefined();
    const condicoes = check!.split(/\s+AND\s+/);
    const SIMBOLO_DO_LIKE = /\[\^?[^\]]*\]|%|_|[.*+?^$(){}|\\]/g;
    const likeParaRegex = (pad: string) => {
      const corpo = pad.replace(SIMBOLO_DO_LIKE, (t) => (t === '%' ? '.*' : t === '_' ? '.' : t.startsWith('[') ? t : '\\' + t));
      return new RegExp('^' + corpo + '$', 's');
    };
    const passaNoCheck = (v: string) =>
      condicoes.every((c) => {
        const diferente = /^parcelas_dias <> '(.*)'$/.exec(c);
        if (diferente) return v !== diferente[1];
        const like = /^parcelas_dias (NOT )?LIKE '(.*)'$/.exec(c);
        if (!like) throw new Error(`condição do CHECK não reconhecida: ${c}`);
        return likeParaRegex(like[2]!).test(v) !== Boolean(like[1]);
      });
    // controle: os válidos passam; os que quebravam a view (D-T0162-2) e o vazio não passam
    expect(['0', '30', '30,60', '30,60,90'].map(passaNoCheck)).toEqual([true, true, true, true]);
    expect(['', '30,,60', '30,60,', ',30', ',', '30 60', '30;60'].filter(passaNoCheck)).toEqual([]);
    for (const v of ['0', '30', '30,60', '30,60,90', '', '30,,60', '30,60,', ',30', ',', ',,', '1,2,3,']) {
      if (!passaNoCheck(v)) continue;
      // vw_macuxi_prazo_pagamento: '[' + parcelas_dias + ']'; o ERP via API faz JSON.parse
      expect(() => JSON.parse(`[${v}]`), `"${v}" passa no CHECK e quebra a view`).not.toThrow();
    }
  });

  it('D-T0162-2 corrigido: uma linha ruim na carga não impede que os pedidos da Piloto API entrem na ERP_PILOTO na mesma passada', async () => {
    const db = bancoFalso([[/vw_macuxi_prazo_pagamento/, [{ external_id: 'BOL', alterado_em: new Date('2026-11-12T10:00:00Z'), ativo: 1, parcelas_dias: '[30,,60]' }]]]);
    const processarPedidos = vi.fn(async () => ({ integrados: 1, rejeitados: 0, repetidos: 0, definitivos: [] }));
    const cliente = {
      consultarCursor: async () => ({ cursor: null }),
      enviarCompleto: async (_e: string, ler: Ler) => { await ler(null, 5000); return []; },
      enviarDelta: async () => [],
      processarPedidos,
      devolverRetorno: async () => ({}),
    };
    await api.executarCiclo({ cliente, db, deps, estado: {}, agoraMs: 1 }).catch(() => undefined);
    expect(processarPedidos).toHaveBeenCalledTimes(1);
  });
});

/* --------------------------------------------------------------- retornos --------------------------------------------------------------- */

describe('T-0162 ERP via API: status de volta ao Hub', () => {
  const base = { numero_pedido: 7, motivo: null, nota_numero: null, nota_serie: null, nota_emitida_em: null, nota_total_cents: null, situacao_em: new Date('2026-11-12T14:30:00Z') };

  it('RN-INT-09: faturado parcial com nota e cancelado (com e sem motivo) voltam com o status certo', async () => {
    const enviados: Linha[] = [];
    const cliente = { devolverRetorno: async (_u: string, r: Linha) => { enviados.push(r); return {}; } };
    const db = bancoFalso([
      [/WHERE origem = @origem/, [
        { ...base, pedido_uuid: 'AAAAAAAA-2222-4333-8444-555555555555', situacao: 'P', nota_numero: '901', nota_emitida_em: new Date('2026-11-12T15:00:00Z'), nota_total_cents: 790 },
        { ...base, pedido_uuid: 'BBBBBBBB-2222-4333-8444-555555555555', situacao: 'C', motivo: 'Cliente desistiu' },
        { ...base, pedido_uuid: 'CCCCCCCC-2222-4333-8444-555555555555', situacao: 'C' },
      ]],
    ]);
    const resumo = await api.enviarRetornos({ cliente, db, ErroHub: hub.ErroHub, log: () => {} });
    expect(resumo).toEqual({ enviados: 3, aguardando_nota: 0, recusados: 0 });
    expect(enviados[0]).toMatchObject({ status: 'faturado_parcial', numero_erp: '7', nota: { numero: '901', emitida_em: '2026-11-12T15:00:00.000Z', total_cents: 790 } });
    expect(enviados[0]).not.toHaveProperty('itens_faturados');
    expect(enviados[1]).toMatchObject({ status: 'cancelado', motivo: 'Cliente desistiu' });
    expect(enviados[2]).toMatchObject({ status: 'cancelado' });
    expect(enviados[2]).not.toHaveProperty('motivo');
  });

  it('RN-INT-09: falha não definitiva do Hub (503) não marca o retorno como enviado: repete na passada seguinte', async () => {
    const cliente = { devolverRetorno: async () => { throw new hub.ErroHub({ status: 503, codigo: 'indisponivel', mensagem: 'x' }); } };
    const db = bancoFalso([[/WHERE origem = @origem/, [{ ...base, pedido_uuid: 'AAAAAAAA-2222-4333-8444-555555555555', situacao: 'R', motivo: 'Sem estoque' }]]]);
    await expect(api.enviarRetornos({ cliente, db, ErroHub: hub.ErroHub, log: () => {} })).rejects.toThrow();
    expect(db.consultas.some((c) => c.sql.includes('SET retorno_enviado'))).toBe(false);
  });

  it('RN-INT-kit: só devolve pedidos da origem Piloto API cuja situação ainda não foi devolvida (os do Conector ficam com ele)', async () => {
    const db = bancoFalso([]);
    await api.enviarRetornos({ cliente: {}, db, ErroHub: hub.ErroHub, log: () => {} });
    expect(db.consultas[0]!.sql).toMatch(/origem = @origem/);
    expect(db.consultas[0]!.sql).toMatch(/ISNULL\(retorno_enviado, ''\) <> situacao/);
    expect(db.consultas[0]!.params).toEqual({ origem: 'Piloto API' });
  });

  it('D-T0162-3 corrigido: ocorrido_em do status é o situacao_em da ERP_PILOTO (como no Conector, vw_macuxi_pedido_status), não a hora do envio', async () => {
    const enviados: Linha[] = [];
    const cliente = { devolverRetorno: async (_u: string, r: Linha) => { enviados.push(r); return {}; } };
    const db = bancoFalso([[/WHERE origem = @origem/, [{ ...base, pedido_uuid: 'AAAAAAAA-2222-4333-8444-555555555555', situacao: 'R', motivo: 'Sem estoque' }]]]);
    await api.enviarRetornos({ cliente, db, ErroHub: hub.ErroHub, log: () => {} });
    expect(SQL_EXTENSAO).toMatch(/p\.situacao_em AS ocorrido_em/);
    expect(db.consultas[0]!.sql).toContain('situacao_em');
    expect(enviados[0]!.ocorrido_em).toBe('2026-11-12T14:30:00Z');
  });
});

/* --------------------------------------------------------------- instalador (estático) --------------------------------------------------------------- */

describe('T-0162 Instalar-Piloto.ps1 e executar.ps1 (conferência estática)', () => {
  it('RN-INT-kit: segredo nunca vai em linha de comando: a senha e a chave entram no Conector pela entrada padrão (pipe)', () => {
    const chamadasNode = INSTALADOR.split('\n').filter((l) => /& \$node\b/.test(l));
    expect(chamadasNode.length).toBeGreaterThan(0);
    for (const l of chamadasNode) {
      const argumentos = l.slice(l.indexOf('& $node'));
      expect(argumentos, l.trim()).not.toMatch(/\$(script:Senha\w*|chave|senhaWin|Senha\w*)/i);
    }
    expect(INSTALADOR).toMatch(/\$script:SenhaConector \| & \$node 'conector\.mjs' 'segredo' 'definir' 'erp_senha'/);
    expect(INSTALADOR).toMatch(/\$chave \| & \$node 'conector\.mjs' 'segredo' 'definir' 'hub_chave'/);
    // o ERP via API recebe por variável de ambiente só no processo filho e apaga no finally
    expect(EXECUTAR_PS1).toMatch(/Remove-Item Env:\\MACUXI_CHAVE, Env:\\MACUXI_ERP_SENHA/);
  });

  it('RN-INT-kit: -Limpar pede LIMPAR digitado (maiúsculas) e sai antes de instalar, trocar senha ou mexer em serviço', () => {
    expect(funcaoPs('Passo-Limpar')).toMatch(/-cne 'LIMPAR'/);
    const principal = INSTALADOR.slice(INSTALADOR.indexOf("Write-Host 'Kit do piloto Macuxi FDV'"));
    const limpar = principal.indexOf('if ($Limpar)');
    const retorno = principal.indexOf('return', limpar);
    expect(limpar).toBeGreaterThanOrEqual(0);
    expect(retorno).toBeLessThan(principal.indexOf('Passo-Programas'));
    expect(funcaoPs('Passo-Limpar')).not.toMatch(/DROP |TRUNCATE /i);
  });

  it('RN-INT-kit: idempotente: cada criação tem guarda (banco, firewall, módulos, programas, serviço) ou é substituição (-Force)', () => {
    expect(funcaoPs('Passo-Banco')).toMatch(/DB_ID\(@b\)[\s\S]*CREATE DATABASE/);
    expect(funcaoPs('Passo-Rede-Sql')).toMatch(/if \(-not \(Get-NetFirewallRule -DisplayName \$regra[\s\S]*New-NetFirewallRule/);
    expect(funcaoPs('Passo-Programas')).toMatch(/Get-Module -ListAvailable -Name \$modulo/);
    expect(funcaoPs('Winget-Instalar')).toMatch(/winget list --id \$id --exact/);
    expect(funcaoPs('Passo-Conector')).toMatch(/if \(-not \$existe\) \{\s*& \$node 'conector\.mjs' 'instalar-servico'/);
    expect(funcaoPs('Passo-Api')).toMatch(/Register-ScheduledTask[^\n]*-Force/);
  });

  it('D-T0162-4 corrigido (segurança): a porta 1433 abre só nos perfis de rede Privado/Domínio, nunca no Público (Wi-Fi de hotel ou café)', () => {
    const regra = /New-NetFirewallRule[^\n]*/.exec(funcaoPs('Passo-Rede-Sql'))![0];
    expect(regra).toMatch(/-RemoteAddress LocalSubnet/);
    expect(regra).not.toMatch(/-Profile Any\b/);
    expect(regra).toMatch(/-Profile (Private,\s*Domain|Domain,\s*Private)\b/);
  });

  it('D-T0162-5 corrigido: o erro do ERP via API chega ao erp-via-api.log (no Windows PowerShell 5.1, stderr redirecionado com Stop vira exceção e não vai ao arquivo)', () => {
    const linhas = EXECUTAR_PS1.split(/\r?\n/);
    const chamada = linhas.findIndex((l) => /& \$node/.test(l));
    expect(chamada).toBeGreaterThan(0);
    const preferencia = linhas.slice(0, chamada).filter((l) => /\$ErrorActionPreference\s*=/.test(l)).pop() ?? '';
    expect(preferencia).not.toMatch(/'Stop'/);
  });

  it('D-T0162-6 corrigido: a senha nova do macuxi_api vai ao cofre antes do npm (sem internet o npm falha e a Piloto API ficaria sem acesso ao banco)', () => {
    // a senha nova vai ao cofre já no Passo-Banco, logo depois de trocar no SQL; o Passo-Api não regrava (RD-0232) nem troca a senha
    const banco = funcaoPs('Passo-Banco');
    expect(banco.indexOf("Gravar-Credencial 'Macuxi.Piloto/erp_senha_api'")).toBeGreaterThan(banco.indexOf('04-usuarios.sql'));
    const passoApi = funcaoPs('Passo-Api');
    expect(passoApi).not.toContain('erp_senha_api');
    expect(passoApi).not.toMatch(/SenhaAleatoria|04-usuarios/);
    const principal = INSTALADOR.slice(INSTALADOR.lastIndexOf('\nPasso-Programas'));
    expect(principal.indexOf('Passo-Banco')).toBeLessThan(principal.indexOf('Passo-Api'));
    // sem conector-*.zip a senha do macuxi_conector não muda (senha vazia = o 04 não altera o login)
    expect(banco).toMatch(/\$script:SenhaConector = if \([^)]*\$script:ConectorZipAchado\) \{ SenhaAleatoria \} else \{ '' \}/);
    expect(lerKit('sql/04-usuarios.sql')).toMatch(/IF N'\$\(SENHA_CONECTOR\)' <> N''/);
  });
});

/* --------------------------------------------------------------- zip e roteiro --------------------------------------------------------------- */

describe('T-0162 zip do kit e roteiro', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'kit-piloto-'));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it('RN-INT-kit: tudo o que o instalador e o ERP via API abrem está no zip, na raiz (o roteiro faz cd na pasta extraída)', () => {
    const nomes = new Set(kit.montarEntradas().map((e) => e.nome));
    const doInstalador = [...INSTALADOR.matchAll(/Join-Path \$(?:kit|sql) '([^'*]+)'/g)].map((m) => m[1]!.replace(/\\/g, '/'));
    const esperados = doInstalador.map((n) => (n.endsWith('.sql') ? `sql/${n}` : n)).filter((n) => /\.(sql|json|ps1)$/.test(n));
    expect(esperados).toEqual(expect.arrayContaining(['sql/01-erp-piloto.sql', 'sql/04-usuarios.sql', 'conector/conector.json', 'dados-exemplo.json']));
    for (const n of esperados) expect(nomes, n).toContain(n);
    for (const n of ['Macuxi-Credencial.ps1', 'executar.mjs']) expect(EXECUTAR_PS1).toContain(n);
    for (const n of ['erp-via-api/Macuxi-Credencial.ps1', 'erp-via-api/executar.mjs', 'erp-via-api/erp-via-api.mjs', 'erp-via-api/cliente-hub.mjs', 'erp-via-api/package.json']) {
      expect(nomes, n).toContain(n);
    }
    expect([...nomes].every((n) => !n.startsWith('/') && !n.includes('\\'))).toBe(true);
    expect(nomes.has('Instalar-Piloto.ps1')).toBe(true);
  });

  it('RN-INT-kit: com --conector o pacote do Conector vai na raiz do zip, onde o instalador procura conector-*.zip', () => {
    const zip = join(pasta, 'conector-9.9.9.zip');
    writeFileSync(zip, 'zip falso');
    const nomes = kit.montarEntradas({ conectorZip: zip }).map((e) => e.nome);
    expect(nomes).toContain('conector-9.9.9.zip');
    expect(INSTALADOR).toMatch(/Get-ChildItem -Path \$kit -Filter 'conector-\*\.zip'/);
  });

  it('RN-INT-kit: o ERP via API usa o identificador piloto-api e o Hub de produção, e o cliente-hub aceita essa configuração', () => {
    expect(EXECUTAR_MJS).toContain("MACUXI_HUB_URL: 'https://api.macuxifdv.com.br/integracao/v1'");
    expect(EXECUTAR_MJS).toContain(`MACUXI_CONECTOR: '${kit.ID_API_PILOTO}'`);
    const cfg = hub.lerConfig({ MACUXI_HUB_URL: 'https://api.macuxifdv.com.br/integracao/v1', MACUXI_CONECTOR: kit.ID_API_PILOTO, MACUXI_CHAVE: `mxc_${'a'.repeat(43)}` });
    expect(cfg).toMatchObject({ url: 'https://api.macuxifdv.com.br/integracao/v1', conectorId: 'piloto-api' });
  });

  it('RN-INT-kit: o roteiro só usa parâmetros que o instalador tem e cita os identificadores que o kit usa', () => {
    const params = new Set([...INSTALADOR.matchAll(/\[(?:switch|string)\]\$(\w+)/g)].map((m) => m[1]!.toLowerCase()));
    for (const m of ROTEIRO.matchAll(/Instalar-Piloto\.ps1((?: -\w+(?: \w+)?)*)/g)) {
      for (const p of m[1]!.matchAll(/-(\w+)/g)) expect(params, `-${p[1]}`).toContain(p[1]!.toLowerCase());
    }
    for (const m of ROTEIRO.matchAll(/`-(\w+)/g)) expect(params, `-${m[1]}`).toContain(m[1]!.toLowerCase());
    expect(ROTEIRO).toContain(`\`${kit.ID_CONECTOR_PILOTO}\``);
    expect(ROTEIRO).toContain(`\`${kit.ID_API_PILOTO}\``);
    expect(ROTEIRO).toContain('-ExecutionPolicy Bypass');
  });
});

/* ------------------------------------- defeitos funcionais encaminhados pelo corretor (R-20261112-222454) ------------------------------------- */

describe('T-0162 textos do instalador × roteiro (encaminhados pelo corretor)', () => {
  it('corretor 1: nenhum código do roteiro fica partido em duas linhas (crases fechadas na mesma linha, fora dos blocos ```)', () => {
    let emBloco = false;
    for (const [i, linha] of ROTEIRO.split(/\r?\n/).entries()) {
      if (linha.trim().startsWith('```')) {
        emBloco = !emBloco;
        continue;
      }
      if (emBloco) continue;
      expect((linha.match(/`/g) ?? []).length % 2, `ROTEIRO.md:${i + 1}`).toBe(0);
    }
    expect(emBloco).toBe(false);
  });

  it('corretor 2: toda seção do roteiro citada na tela do instalador existe no ROTEIRO.md', () => {
    const secoes = new Set([...ROTEIRO.matchAll(/^##+ (.+)$/gm)].map((m) => m[1]!.trim().toLowerCase()));
    const citadas = [...INSTALADOR.matchAll(/roteiro,? secao ([A-Za-z ]+?)[.'"]/gi), ...INSTALADOR.matchAll(/secao (\w+) do ROTEIRO/gi)].map((m) => m[1]!.trim().toLowerCase());
    expect(citadas.length).toBeGreaterThan(0);
    for (const s of citadas) expect(secoes, s).toContain(s);
  });

  it('corretor 3: a tela não diz "senhas novas" (sem o pacote do Conector ou com -Modalidade única a senha não muda)', () => {
    expect(funcaoPs('Passo-Banco')).not.toMatch(/Ok [^\n]*senhas? nova/i);
  });

  it('corretor 6: toda chamada do instalador mostrada na tela leva -ExecutionPolicy Bypass, como no roteiro', () => {
    const naTela = INSTALADOR.split(/\r?\n/).filter((l) => /Write-Host|Aviso|Ok |Falha/.test(l) && /Instalar-Piloto\.ps1 -/.test(l));
    for (const l of naTela) expect(l).toContain('-ExecutionPolicy Bypass');
  });

  it('D-T0162-7 (baixa, corrigido): os títulos numerados dos passos na tela seguem 1, 2, 3... sem pular', () => {
    const numeros = [...INSTALADOR.matchAll(/^\s*Titulo ['"](\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numeros.length).toBeGreaterThan(0);
    expect(numeros).toEqual(numeros.map((_, i) => i + 1));
  });
});

describe('T-0162 doc do kit (encaminhado pelo corretor)', () => {
  it('corretor 5: todo caminho do repositório citado no kit-piloto.md existe', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../docs/modulos/integracao/kit-piloto.md', import.meta.url)), 'utf8');
    const caminhos = [...doc.matchAll(/`((?:modules|apps|db|docs|packages)\/[^`*<>\s]+)`/g)].map((m) => m[1]!);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const c of caminhos) expect(existsSync(fileURLToPath(new URL(`../../${c}`, import.meta.url))), c).toBe(true);
  });
});
