/**
 * T-0174 — kit da thathyany. Sem Windows e sem SQL Server: confere que os artefatos gerados batem com o contrato, roda os testes
 * do carga_csv.py (unittest, banco de mentira), confere o zip, o instalador (.ps1, conferência estática) e o roteiro.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
    const pastas = [aqui('..', 'docs'), aqui('..', 'api', 'openapi')];
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

  it('instala SQL Server Express, ODBC 18 e Python com pyodbc; roda o criar-banco.sql e os usuários que existem no kit', () => {
    expect(INSTALADOR).toContain('Microsoft.SQLServer.2022.Express');
    expect(INSTALADOR).toContain('Microsoft.msodbcsql.18');
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
    expect(ROTEIRO.slice(f2)).toMatch(/desative o Conector `thathyany-conector`/);
  });

  it('o que ter em mãos: SQL Server Express, chave do portal e o código novo da thathyany depois do deploy da v1.0.9', () => {
    const secao = ROTEIRO.slice(ROTEIRO.indexOf('## O que ter em mãos'), ROTEIRO.indexOf('## Preparar'));
    expect(secao).toContain('SQL Server Express');
    expect(secao).toMatch(/chaves? gerada?s? no portal/);
    expect(secao).toContain('código novo da thathyany');
    expect(secao).toContain('v1.0.9');
    expect(secao).toContain('Baixar o Conector');
  });

  it('chave gerada no portal, nunca "no BKO"; sem endereço da demo', () => {
    expect(ROTEIRO).toContain('chave gerada no portal');
    expect(ROTEIRO).not.toMatch(/no BKO/);
    expect(ROTEIRO).not.toMatch(/demo/i);
  });
});
