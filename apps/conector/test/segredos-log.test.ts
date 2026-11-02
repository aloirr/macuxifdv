import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { criarLogger } from '../src/log/logger';
import { limparSegredosRegistrados, mascararTexto, mascararValor, registrarSegredo } from '../src/log/mascara';
import { criarProvedor, nomeVariavel, ProvedorEnv, ProvedorWindows, scriptGravarCredencial, Segredos, type ExecutarPowerShell } from '../src/segredos/provedores';

afterEach(() => limparSegredosRegistrados());

describe('segredos fora do arquivo de configuração', () => {
  it('provedor por variável de ambiente: MACUXI_CONECTOR_<NOME>', async () => {
    expect(nomeVariavel('erp_senha')).toBe('MACUXI_CONECTOR_ERP_SENHA');
    const p = new ProvedorEnv({ MACUXI_CONECTOR_HUB_CHAVE: 'tok-123456' });
    expect(await p.obter('hub_chave')).toBe('tok-123456');
    expect(await p.obter('erp_senha')).toBeUndefined();
  });

  it('provedor Windows: lê pelo Gerenciador de Credenciais via PowerShell; o segredo NUNCA vai no script/argumentos, só por stdin', async () => {
    const chamadas: { script: string; entrada?: string }[] = [];
    const exec: ExecutarPowerShell = async (script, entrada) => {
      chamadas.push({ script, entrada });
      return script.includes('::Ler(') ? { codigo: 0, saida: 'senha-do-banco', erro: '' } : { codigo: 0, saida: '', erro: '' };
    };
    const p = new ProvedorWindows(exec);
    expect(await p.obter('erp_senha')).toBe('senha-do-banco');
    expect(chamadas[0]?.script).toContain("'Macuxi.Conector/erp_senha'");
    await p.definir('hub_chave', 'segredo-super-secreto');
    expect(chamadas[1]?.entrada).toBe('segredo-super-secreto');
    expect(chamadas[1]?.script).not.toContain('segredo-super-secreto');
    expect(scriptGravarCredencial("a'b")).toContain("'a''b'");
  });

  it('credencial inexistente (código 3) devolve indefinido; falha do PowerShell vira erro legível', async () => {
    expect(await new ProvedorWindows(async () => ({ codigo: 3, saida: '', erro: '' })).obter('x')).toBeUndefined();
    await expect(new ProvedorWindows(async () => ({ codigo: 1, saida: '', erro: 'boom' })).obter('x')).rejects.toThrow(/Gerenciador de Credenciais/);
  });

  it('auto: variável de ambiente primeiro; no Windows cai para o Gerenciador de Credenciais; fora do Windows só env', async () => {
    const exec: ExecutarPowerShell = async () => ({ codigo: 0, saida: 'do-windows', erro: '' });
    const win = criarProvedor('auto', { env: { MACUXI_CONECTOR_ERP_SENHA: 'do-env' }, plataforma: 'win32', executar: exec });
    expect(await win.obter('erp_senha')).toBe('do-env');
    expect(await win.obter('hub_chave')).toBe('do-windows');
    const linux = criarProvedor('auto', { env: {}, plataforma: 'linux', executar: exec });
    expect(await linux.obter('hub_chave')).toBeUndefined();
  });

  it('rotação: o segredo é relido depois do TTL, sem reiniciar o serviço', async () => {
    const env: NodeJS.ProcessEnv = { MACUXI_CONECTOR_HUB_CHAVE: 'token-antigo' };
    let agora = 0;
    const s = new Segredos(new ProvedorEnv(env), 1000, () => agora);
    expect(await s.exigir('hub_chave')).toBe('token-antigo');
    env.MACUXI_CONECTOR_HUB_CHAVE = 'token-novo!';
    expect(await s.exigir('hub_chave')).toBe('token-antigo');
    agora = 2000;
    expect(await s.exigir('hub_chave')).toBe('token-novo!');
  });

  it('segredo ausente: erro em português dizendo o que fazer, sem inventar valor', async () => {
    await expect(new Segredos(new ProvedorEnv({})).exigir('erp_senha')).rejects.toThrow(/MACUXI_CONECTOR_ERP_SENHA.*conector segredo definir/s);
  });

  it('todo segredo lido passa a ser mascarado em qualquer log', async () => {
    await new Segredos(new ProvedorEnv({ MACUXI_CONECTOR_ERP_SENHA: 'S3nh@-muito-longa' })).exigir('erp_senha');
    expect(mascararTexto('falha ao autenticar com S3nh@-muito-longa no host')).toBe('falha ao autenticar com *** no host');
  });
});

describe('máscara de dados pessoais e segredos nos logs', () => {
  it('mascara CPF, CNPJ, e-mail, telefone e Bearer em texto livre', () => {
    const t = mascararTexto('cliente 123.456.789-09 / 12.345.678/0001-95 / ana@ex.com.br / (95) 99123-4567 / Authorization: Bearer abc.def-123');
    expect(t).toBe('cliente [cpf] / [cnpj] / [email] / [telefone] / Authorization: Bearer ***');
    expect(mascararTexto('12345678909 e 12345678000195')).toBe('[cpf] e [cnpj]');
  });

  it('mascara senha em string de conexão e URL com credencial', () => {
    expect(mascararTexto('Server=x;User Id=sa;Password=abc123;Database=erp')).toContain('Password=***');
    expect(mascararTexto('postgres://user:pass123@host/db')).toBe('postgres://user:***@host/db');
  });

  it('chaves sensíveis têm o valor trocado, em qualquer profundidade; contadores e booleanos passam', () => {
    const v = mascararValor({ entidade: 'cliente', linhas: 12, nome: 'Maria', cliente: { email: 'a@b.co', documento: '1', razao_social: 'X' }, erp_senha: 'x', ok: true, registros: [{ a: 1 }] }) as Record<string, unknown>;
    expect(v).toEqual({ entidade: 'cliente', linhas: 12, nome: '***', cliente: { email: '***', documento: '***', razao_social: '***' }, erp_senha: '***', ok: true, registros: '***' });
  });

  it('chave sensível com valor NUMÉRICO também é mascarada (latitude, CPF guardado como número); só boolean passa', () => {
    const v = mascararValor({ latitude: -3.1, cpf: 12345678901, cliente: { telefone: 95991234567, longitude: -60.6 }, ativo: true, cpf_ok: false, linhas: 12 }) as Record<string, unknown>;
    expect(v).toEqual({ latitude: '***', cpf: '***', cliente: { telefone: '***', longitude: '***' }, ativo: true, cpf_ok: false, linhas: 12 });
    expect(JSON.stringify(v)).not.toMatch(/12345678901|-3\.1|9599123/);
  });

  it('o logger grava JSON mascarado por linha', () => {
    const saidas: string[] = [];
    const log = criarLogger({ escrever: (l) => saidas.push(l), nivel: 'info' });
    registrarSegredo('token-de-teste-123456');
    log.info('teste', { token: 'token-de-teste-123456', erro: 'falhou para 123.456.789-09', linhas: 3 });
    log.debug('nao_aparece');
    expect(saidas).toHaveLength(1);
    const o = JSON.parse(saidas[0] as string);
    expect(o).toMatchObject({ nivel: 'info', evento: 'teste', token: '***', erro: 'falhou para [cpf]', linhas: 3 });
  });
});

describe('rotação e retenção de logs', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('um arquivo por dia; ao passar do tamanho vira .1, .2…; apaga o que passou da retenção', () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-log-'));
    let t = Date.parse('2026-03-10T12:00:00Z');
    const log = criarLogger({ pasta: dir, maxBytes: 300, maxArquivosPorDia: 3, retencaoDias: 30, relogio: { agora: () => t } });
    for (let i = 0; i < 20; i++) log.info('evento_longo_para_encher_o_arquivo', { i, texto: 'x'.repeat(40) });
    const arquivos = readdirSync(dir).sort();
    expect(arquivos).toContain('conector-2026-03-10.log');
    expect(arquivos).toContain('conector-2026-03-10.1.log');
    expect(arquivos.length).toBeLessThanOrEqual(3);

    writeFileSync(join(dir, 'conector-2026-01-01.log'), 'velho');
    // hora-fixa-ok: mtime recente de propósito — a retenção vale pela data do NOME do arquivo, não pelo mtime do sistema
    utimesSync(join(dir, 'conector-2026-01-01.log'), new Date(), new Date());
    t = Date.parse('2026-03-11T12:00:00Z');
    log.info('novo_dia');
    const depois = readdirSync(dir);
    expect(depois).not.toContain('conector-2026-01-01.log');
    expect(depois).toContain('conector-2026-03-11.log');
    expect(readFileSync(join(dir, 'conector-2026-03-11.log'), 'utf8')).toContain('novo_dia');
  });
});
