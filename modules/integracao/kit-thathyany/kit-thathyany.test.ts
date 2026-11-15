/**
 * T-0174 — kit da thathyany. Sem Windows e sem SQL Server: confere que os artefatos gerados batem com o contrato, roda os testes
 * do carga_csv.py (unittest, banco de mentira), confere o zip, o instalador (.ps1, conferência estática) e o roteiro.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTIDADES_ORDEM_CARGA } from '../domain/modelos-csv';
import { converterCsvParaLote } from '../domain/carga-arquivo';
import { LIMITES_CATALOGO_PRODUTO, SCHEMA_REGISTRO } from '../contracts';
import { limitarCatalogoDoProduto } from '../domain/catalogo-produto';
import { artefatos, HUB_URL } from './scripts/gerar';
// @ts-expect-error módulo .mjs sem tipos (kit em Node puro)
import { ARQUIVOS_ERP_VIA_API, adaptarErpViaApi, montarEntradas } from './scripts/gerar-zip.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit em Node puro)
import { criarZip } from '../kit-piloto/scripts/zip.mjs';

const aqui = (...p: string[]) => fileURLToPath(new URL(p.join('/'), import.meta.url));
const ler = (...p: string[]) => readFileSync(aqui(...p), 'utf8');

const INSTALADOR = ler('Instalar-Thathyany.ps1');
const ROTEIRO = ler('ROTEIRO.md');
type Entrada = { nome: string; dados: Buffer };
const ENTRADAS = montarEntradas() as Entrada[];
const doZip = (nome: string) => ENTRADAS.find((e) => e.nome === nome)?.dados.toString('utf8') ?? '';

describe('artefatos gerados do contrato', () => {
  it('contrato.json, modelos, criar-banco.sql e conector.json estão atualizados (rode scripts/gerar.ts se falhar)', () => {
    // o .gitattributes grava texto com LF no repositório: a comparação ignora o fim de linha
    const lf = (t: string) => t.replaceAll('\r\n', '\n');
    for (const [rel, conteudo] of Object.entries(artefatos())) {
      expect(lf(ler(rel)), rel).toBe(lf(conteudo));
    }
  });

  it('16 entidades, 16 modelos de CSV e o conector.json apontando para a produção', () => {
    const contrato = JSON.parse(ler('contrato.json')) as { entidades: { entidade: string }[] };
    expect(contrato.entidades).toHaveLength(16);
    for (const e of contrato.entidades) expect(existsSync(aqui('modelos', `${e.entidade}.csv`)), e.entidade).toBe(true);
    const conector = JSON.parse(ler('conector', 'conector.json')) as { hub: { url: string; conectorId: string }; entidades: object };
    expect(HUB_URL).toBe('https://api.macuxifdv.com.br');
    expect(conector.hub).toMatchObject({ url: HUB_URL, conectorId: 'thathyany-conector' });
    expect(Object.keys(conector.entidades)).toHaveLength(16);
  });
});

describe('carga_csv.py', () => {
  it('os testes unittest passam sem SQL Server (validação, MERGE idempotente e relatório)', () => {
    const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', aqui('testes'), '-t', aqui('testes')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    expect(r.error, 'python3 não encontrado').toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Ran \d+ tests[\s\S]*OK/);
  });
});

describe('zip do kit', () => {
  it('leva instalador, roteiro, Python, contrato, 16 modelos, SQL, conector.json e o ERP via API; sem o pacote do Conector', () => {
    const nomes = ENTRADAS.map((e) => e.nome);
    expect(nomes).toEqual(expect.arrayContaining([
      'Instalar-Thathyany.ps1', 'ROTEIRO.md', 'carga_csv.py', 'contrato.json', 'conector/conector.json', 'VERSAO.txt',
      'sql/criar-banco.sql', 'sql/usuario-conector.sql', 'sql/usuario-api.sql', 'erp-via-api/cliente-hub.mjs',
      ...ARQUIVOS_ERP_VIA_API.map((f: string) => `erp-via-api/${f}`),
    ]));
    expect(nomes.filter((n) => n.startsWith('modelos/'))).toHaveLength(16);
    expect(nomes.some((n) => /conector-.*\.zip$/.test(n))).toBe(false);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes.some((n) => n.startsWith('testes/'))).toBe(false);
  });

  it('nenhum segredo e nenhum endereço da demo; o Hub é api.macuxifdv.com.br', () => {
    for (const { nome, dados } of ENTRADAS) {
      const t = dados.toString('utf8');
      expect(t, nome).not.toMatch(/mxc_[A-Za-z0-9_-]{43}/);
      expect(t, nome).not.toMatch(/demo\.macuxifdv|macuxifdv-demo|api-demo/i);
    }
    expect(doZip('erp-via-api/executar.mjs')).toContain("'https://api.macuxifdv.com.br/integracao/v1'");
  });

  it('critério 5: nem os exemplos e a documentação da API apontam para a demo', () => {
    const pastas = [aqui('../docs'), aqui('../api/openapi')];
    for (const pasta of pastas) {
      for (const rel of readdirSync(pasta, { recursive: true }) as string[]) {
        const caminho = join(pasta, rel);
        if (!statSync(caminho).isFile() || /node_modules/.test(caminho)) continue;
        expect(readFileSync(caminho, 'utf8'), rel).not.toMatch(/api-demo|demo\.macuxifdv/i);
      }
    }
  });

  it('o ERP via API leva os nomes da thathyany: banco, origem, credencial e identificador', () => {
    expect(doZip('erp-via-api/erp-via-api.mjs')).toContain("export const ORIGEM = 'Thathyany API';");
    expect(doZip('erp-via-api/executar.mjs')).toContain("'ERP_THATHYANY'");
    expect(doZip('erp-via-api/executar.mjs')).toContain("MACUXI_CONECTOR: 'thathyany-api'");
    expect(doZip('erp-via-api/executar.ps1')).toContain("'Macuxi.Thathyany/hub_chave_api'");
    expect(INSTALADOR).toContain("'Macuxi.Thathyany/hub_chave_api'");
    expect(INSTALADOR).toContain("'Macuxi.Thathyany/erp_senha_api'");
    // a origem gravada pelo ERP via API é a que o criar-banco.sql espera
    expect(ler('sql', 'criar-banco.sql')).toContain("'Thathyany API'");
    expect(() => adaptarErpViaApi('x.mjs', "const alvo = 'Macuxi.Piloto.chave';")).toThrow(/Macuxi\.Piloto/);
  });

  it('o zip abre: assinatura PK e uma entrada por arquivo', () => {
    const zip = criarZip(ENTRADAS) as Buffer;
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    const fim = zip.subarray(zip.length - 22);
    expect(fim.readUInt32LE(0)).toBe(0x06054b50);
    expect(fim.readUInt16LE(10)).toBe(ENTRADAS.length);
  });
});

describe('Instalar-Thathyany.ps1 (conferência estática)', () => {
  it('exige administrador e Windows PowerShell 5.1, com -Fase Conector|API obrigatório', () => {
    expect(INSTALADOR.charCodeAt(0)).toBe(0xfeff);
    expect(INSTALADOR).toContain('#requires -RunAsAdministrator');
    expect(INSTALADOR).toContain('#requires -Version 5.1');
    expect(INSTALADOR).toMatch(/\[Parameter\(Mandatory = \$true\)\]\[ValidateSet\('Conector', 'API'\)\]\[string\]\$Fase/);
    expect([...INSTALADOR.slice(1)].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
  });

  it('não instala SQL Server pelo winget: detecta a instância (-Instancia) e orienta o link oficial; ODBC 18 e Python com pyodbc; roda o criar-banco.sql e os usuários que existem no kit', () => {
    expect(INSTALADOR).not.toMatch(/Microsoft\.SQLServer\.20\d\d/);
    expect(INSTALADOR).toContain('[string]$Instancia');
    expect(INSTALADOR).toContain('Instance Names\\SQL');
    expect(INSTALADOR).toContain("'MSSQL$*'");
    expect(INSTALADOR).toContain('https://www.microsoft.com/pt-br/sql-server/sql-server-downloads');
    expect(INSTALADOR).toContain('(Get-UICulture).Name');
    const semComentarios = INSTALADOR.split('\n').filter((l) => !l.trimStart().startsWith('#') && !/^\s+\(ex\.:/.test(l));
    expect(semComentarios.join('\n')).not.toContain('.\\SQLEXPRESS');
    expect(INSTALADOR).toContain('Microsoft.msodbcsql.18');
    // programa achado no computador (registro ou Get-Command) não passa pelo winget: instalação manual não aparece no "winget list"
    expect(INSTALADOR).toMatch(/function Garantir-Programa[\s\S]*?if \(\$onde\) \{ Ok "\$nome ja instalado: \$onde"; return \}[\s\S]*?Winget-Instalar/);
    for (const achar of ['{ Achar-Ssms }', '{ Achar-Odbc }', '{ $p = Achar-Python; if ($p) { $p[0] } }', '{ Achar-Node }']) expect(INSTALADOR).toContain(achar);
    expect(INSTALADOR).toContain('Program Files*\\Microsoft SQL Server Management Studio*');
    expect(INSTALADOR).toContain("Get-OdbcDriver -Name $nome");
    expect(INSTALADOR).toContain('ODBCINST.INI');
    expect(INSTALADOR.match(/^\s*Winget-Instalar /gm) ?? []).toHaveLength(1);
    expect(INSTALADOR).toMatch(/pip install[^\n]*pyodbc/);
    for (const m of INSTALADOR.matchAll(/'sql\\([\w-]+\.sql)'|Trocar-Senha-Login '([\w-]+\.sql)'/g)) {
      const arq = m[1] ?? m[2]!;
      expect(existsSync(aqui('sql', arq)), arq).toBe(true);
    }
  });

  it('fase 1: Conector baixado do portal, nunca de dentro do kit; desliga a tarefa da API', () => {
    expect(INSTALADOR).toMatch(/Baixar o Conector" do portal/);
    expect(INSTALADOR).toMatch(/Disable-ScheduledTask -TaskName \$TAREFA_API/);
    expect(INSTALADOR).toContain("PedirChave 'thathyany-conector'");
  });

  it('fase 2: para e desativa o serviço do Conector, desabilita o login dele e usa outra credencial', () => {
    expect(INSTALADOR).toMatch(/Set-Service -Name \$SERVICO_CONECTOR -StartupType Disabled/);
    expect(INSTALADOR).toContain("PedirChave 'thathyany-api'");
    expect(ler('sql', 'usuario-api.sql')).toContain('ALTER LOGIN macuxi_conector DISABLE');
    expect(ler('sql', 'usuario-conector.sql')).toContain('ALTER LOGIN macuxi_conector ENABLE');
  });

  it('chave pela área de transferência (o console 5.1 não cola no Read-Host mascarado), limpa logo depois e nunca mostrada', () => {
    const pedir = /function PedirChave[\s\S]*?\n\}/.exec(INSTALADOR)![0];
    expect(pedir).toContain('Get-Clipboard -Raw');
    expect(pedir).toMatch(/\$copiada -match \$REGEX_CHAVE\) \{\s+Limpar-AreaTransferencia/);
    expect(pedir).toContain('lida da area de transferencia');
    expect(pedir).toMatch(/Read-Host -AsSecureString/);
    expect(INSTALADOR).toContain('Set-Clipboard -Value $null');
    expect(INSTALADOR).not.toMatch(/(Write-\w+|Ok|Aviso|Falha)[^\n]*\$copiada/);
    expect(ROTEIRO).toContain('copie a chave gerada no portal e, logo em seguida, rode:');
    expect(ROTEIRO).toContain('copie a chave nova e, logo em seguida, rode:');
  });

  it('segredos só por Read-Host mascarado e Gerenciador de Credenciais, nunca em arquivo ou log', () => {
    expect(INSTALADOR).toMatch(/Read-Host -AsSecureString/);
    expect(INSTALADOR).not.toMatch(/Read-Host(?! -AsSecureString)[^\n]*(chave|senha)/i);
    expect(INSTALADOR).not.toMatch(/ConvertFrom-SecureString|Out-File|Set-Content|Add-Content/);
    expect(INSTALADOR).not.toMatch(/Write-(Host|Output|Verbose|Debug)[^\n]*\$(chave|senha)/i);
    for (const arq of ['usuario-conector.sql', 'usuario-api.sql']) expect(ler('sql', arq)).toMatch(/PASSWORD = N'\$\(SENHA\)'/);
  });
});

describe('ROTEIRO.md', () => {
  it('duas fases (RN-INT-13), cada uma do pedido no app até o número do ERP voltar', () => {
    const f1 = ROTEIRO.indexOf('## Fase 1 — Conector 1.4.0');
    const f2 = ROTEIRO.indexOf('## Fase 2 — API com outra credencial');
    expect(f1).toBeGreaterThan(0);
    expect(f2).toBeGreaterThan(f1);
    for (const fase of [ROTEIRO.slice(f1, f2), ROTEIRO.slice(f2)]) {
      expect(fase).toMatch(/Pedido no app/);
      expect(fase).toMatch(/Número de volta/);
    }
    expect(ROTEIRO.slice(f2)).toMatch(/Desative o `thathyany-conector`:\*\* peça ao gerente-projetos/);
  });

  it('o que ter em mãos: SQL Server Express e o código novo da thathyany depois do deploy da v1.0.9', () => {
    const secao = ROTEIRO.slice(ROTEIRO.indexOf('## O que ter em mãos'), ROTEIRO.indexOf('## Preparar'));
    expect(secao).toContain('SQL Server Express');
    expect(secao).toContain('código novo da thathyany');
    expect(secao).toContain('v1.0.9');
  });

  it('chave gerada no portal, nunca "no BKO"', () => {
    expect(ROTEIRO).toContain('chave gerada no portal');
    expect(ROTEIRO).not.toMatch(/no BKO/);
  });
});

describe('T-0174 defeito 4: o kit e o Zod REAL do Hub não divergem', () => {
  type CampoK = { campo: string; obrigatorio: boolean; regra: Record<string, unknown>; so_kit?: boolean };
  type EntK = { entidade: string; campos: CampoK[]; regras_entidade: { campos: string[] }[] };
  const contrato = JSON.parse(ler('contrato.json')) as { entidades: EntK[] };
  const AGORA = '2026-11-15T12:00:00Z';
  /** Tira do CSV as colunas só do kit (referencia_N...): o Hub não as conhece, a view as converte em `referencias`. */
  const semColunasDoKit = (e: string, texto: string): string => {
    const fora = new Set((contrato.entidades.find((x) => x.entidade === e)?.campos ?? []).filter((c) => c.so_kit).map((c) => c.campo));
    if (fora.size === 0) return texto;
    const linhas = texto.replace('\uFEFF', '').split(/\r?\n/).filter((l) => l !== '');
    const cab = (linhas[0] as string).split(';');
    const manter = cab.map((c, i) => (fora.has(c) ? -1 : i)).filter((i) => i >= 0);
    return linhas.map((l) => { const cel = l.split(';'); return manter.map((i) => cel[i] ?? '').join(';'); }).join('\n') + '\n';
  };
  const registroDoModelo = (e: string, texto0 = ler('modelos', `${e}.csv`)): Record<string, unknown> => {
    const texto = semColunasDoKit(e, texto0);
    const r = converterCsvParaLote({ entidade: e as never, modo: 'delta', texto, agora: AGORA });
    if (!r.ok) throw new Error(`${e}: ${r.mensagem}`);
    expect(r.linhasInvalidas, e).toEqual([]);
    return r.registros[0] as Record<string, unknown>;
  };
  const tirar = (reg: Record<string, unknown>, caminho: string): Record<string, unknown> => {
    const copia = structuredClone(reg);
    const partes = caminho.split('.');
    let alvo = copia;
    for (const p of partes.slice(0, -1)) alvo = alvo[p] as Record<string, unknown>;
    delete alvo[partes[partes.length - 1] as string];
    return copia;
  };

  it('todo modelo de CSV, convertido como o Hub converte (converterCsvParaLote), passa no Zod real da entidade', () => {
    for (const e of ENTIDADES_ORDEM_CARGA) {
      const r = SCHEMA_REGISTRO[e].safeParse(registroDoModelo(e));
      expect(r.success, `${e}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('sonda: tirar um campo do modelo recusa no Hub se e só se o contrato do kit o marca obrigatório ou o cita em regras_entidade', () => {
    for (const ent of contrato.entidades) {
      const base = registroDoModelo(ent.entidade);
      const entre = new Set(ent.regras_entidade.flatMap((r) => r.campos));
      for (const c of ent.campos) {
        // só as colunas que o CSV traz (os modelos trazem todas as de campo simples)
        const caminho = c.campo;
        const presente = caminho.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], base) !== undefined;
        if (!presente || caminho === 'alterado_em') continue; // alterado_em: o Hub (e o carga_csv.py) preenchem com a hora do envio quando a coluna não vem
        const hubRecusa = !SCHEMA_REGISTRO[ent.entidade as keyof typeof SCHEMA_REGISTRO].safeParse(tirar(base, caminho)).success;
        expect(hubRecusa, `${ent.entidade}.${caminho}`).toBe(c.obrigatorio || entre.has(caminho));
      }
    }
  });

  it('negativo: filial com CNPJ de DV errado é recusada pelo Zod do Hub e o kit liga a regra cnpj', () => {
    const modelo = ler('modelos', 'filial.csv').replaceAll('\r\n', '\n').split('\n');
    const cab = (modelo[0] as string).replace('\uFEFF', '').split(';');
    const dados = (modelo[1] as string).split(';');
    dados[cab.indexOf('cnpj')] = '11222333000180';
    const hub = SCHEMA_REGISTRO.filial.safeParse(registroDoModelo('filial', `${cab.join(';')}\n${dados.join(';')}\n`));
    expect(hub.success).toBe(false);
    const filial = contrato.entidades.find((e) => e.entidade === 'filial') as EntK;
    expect(filial.campos.find((c) => c.campo === 'cnpj')?.regra).toMatchObject({ cnpj: true });
  });
});

describe('Referência cruzada do produto (até 3 códigos da concorrência)', () => {
  const sql = ler('sql', 'criar-banco.sql');
  const modelo = ler('modelos', 'produto.csv').replace('\uFEFF', '').split(/\r?\n/);

  it('RN-CAT-09: o modelo de produto traz referencia_1..3 e marca_referencia_1..3, e o limite do kit é o do Hub', () => {
    const cab = (modelo[0] as string).split(';');
    for (const n of [1, 2, 3]) {
      expect(cab).toContain(`referencia_${n}`);
      expect(cab).toContain(`marca_referencia_${n}`);
    }
    expect(cab).not.toContain('referencia_4');
    expect(LIMITES_CATALOGO_PRODUTO.referencias).toBe(3);
  });

  it('RN-CAT-09: a view do produto monta `referencias` em JSON {marca_nome, codigo}; as três vazias = NULL (não altera)', () => {
    const view = /CREATE OR ALTER VIEW dbo\.vw_macuxi_produto AS[\s\S]*?GO/.exec(sql)?.[0] ?? '';
    expect(view).toContain('FOR JSON PATH');
    expect(view).toContain('marca_nome');
    expect(view).toMatch(/referencia_1 IS NULL AND referencia_2 IS NULL AND referencia_3 IS NULL THEN NULL/);
  });

  it('banco criado pela versão anterior do kit ganha as colunas novas (ALTER TABLE idempotente): referências, marca_codigo e filial do vendedor', () => {
    const colunas: [string, string][] = [['tha_produto', 'referencia_1'], ['tha_produto', 'marca_referencia_3'], ['tha_produto', 'marca_codigo'], ['tha_vendedor', 'filial_external_id']];
    for (const [tabela, col] of colunas) expect(sql).toContain(`IF COL_LENGTH('dbo.${tabela}', '${col}') IS NULL ALTER TABLE dbo.${tabela} ADD ${col}`);
  });

  it('marca_codigo no modelo e no conector.json; vendedor.filial_external_id referenciada à filial (RN-CORE-39)', () => {
    expect((modelo[0] as string).split(';')).toContain('marca_codigo');
    expect(ler('conector', 'conector.json')).toContain('"marca_codigo": "marca_codigo"');
    const contratoKit = JSON.parse(ler('contrato.json')) as { entidades: { entidade: string; campos: { campo: string; referencia?: string }[] }[] };
    const vend = contratoKit.entidades.find((e) => e.entidade === 'vendedor');
    expect(vend?.campos.find((c) => c.campo === 'filial_external_id')?.referencia).toBe('filial');
  });

  it('RN-CAT-09: o que o kit gera cabe no contrato do Hub (código até 30, marca até 120, marca opcional)', () => {
    const r = SCHEMA_REGISTRO.produto.safeParse({ external_id: 'PRO-001', alterado_em: '2026-11-01T12:00:00Z', sku: 'SKU-001', nome: 'Refrigerante Cola 2L', unidade: 'UN', referencias: [{ marca_nome: 'Marca Beta', codigo: 'PAF-0503' }] });
    expect(r.success).toBe(true);
    const lim = limitarCatalogoDoProduto(r.success ? (r.data as never) : (undefined as never));
    expect(lim.registro.referencias).toHaveLength(1);
    expect(lim.avisos).toEqual([]);
    const semMarca = SCHEMA_REGISTRO.produto.safeParse({ external_id: 'PRO-001', alterado_em: '2026-11-01T12:00:00Z', sku: 'SKU-001', nome: 'X', unidade: 'UN', referencias: [{ codigo: 'PAF-0503' }] });
    expect(limitarCatalogoDoProduto(semMarca.success ? (semMarca.data as never) : (undefined as never)).registro.referencias).toEqual([{ codigo: 'PAF-0503' }]);
  });
});
