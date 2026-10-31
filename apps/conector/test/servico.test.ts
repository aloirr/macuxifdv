import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { desinstalarServico, gerarXmlWinSW, instalarServico, type ExecutarComando } from '../src/servico';

let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('serviço Windows (WinSW)', () => {
  it('gera o XML com reinício automático, rotação do log do serviço e escapa caracteres especiais', () => {
    const xml = gerarXmlWinSW({ executavel: 'C:\\Program Files\\nodejs\\node.exe', argumentos: ['C:\\Macuxi & Cia\\conector.mjs', 'rodar', '--config', 'C:\\dados\\c.json'], diretorioTrabalho: 'C:\\Macuxi', pastaLogs: 'C:\\Macuxi\\logs' });
    expect(xml).toContain('<id>MacuxiConector</id>');
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml).toContain('<onfailure action="restart" delay="10 sec"/>');
    expect(xml).toContain('<log mode="roll-by-size">');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;C:\\Macuxi &amp; Cia\\conector.mjs&quot; rodar --config C:\\dados\\c.json');
    expect(xml).not.toMatch(/senha|password|token/i);
  });

  it('--somente-gerar escreve o XML em qualquer sistema, sem instalar nada', async () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-svc-'));
    const r = await instalarServico({ pasta: dir, caminhoConfig: '/etc/c.json', script: '/opt/conector.mjs', pastaLogs: join(dir, 'logs'), somenteGerar: true, plataforma: 'linux' });
    expect(readFileSync(r.xml, 'utf8')).toContain('<executable>');
  });

  it('fora do Windows, instalar de verdade é recusado com orientação', async () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-svc-'));
    await expect(instalarServico({ pasta: dir, caminhoConfig: 'c', script: 's', pastaLogs: 'l', plataforma: 'linux' })).rejects.toThrow(/só é possível no Windows/);
  });

  it('no Windows: copia o WinSW, gera o XML, roda install e start; sem --winsw pede o executável', async () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-svc-'));
    const winsw = join(dir, 'WinSW-x64.exe');
    writeFileSync(winsw, 'binario');
    const comandos: string[] = [];
    const exec: ExecutarComando = async (cmd, args) => (comandos.push(`${cmd.split(/[\\/]/).pop()} ${args.join(' ')}`), { codigo: 0, saida: '' });
    await expect(instalarServico({ pasta: join(dir, 's'), caminhoConfig: 'c', script: 's', pastaLogs: 'l', plataforma: 'win32', executar: exec })).rejects.toThrow(/--winsw/);
    const r = await instalarServico({ pasta: join(dir, 's'), winsw, caminhoConfig: 'c', script: 's', pastaLogs: 'l', plataforma: 'win32', executar: exec });
    expect(existsSync(r.exe)).toBe(true);
    expect(comandos).toEqual(['macuxi-conector.exe install', 'macuxi-conector.exe start']);
  });

  it('desinstalar: para e remove o serviço', async () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-svc-'));
    writeFileSync(join(dir, 'macuxi-conector.exe'), 'x');
    const comandos: string[] = [];
    await desinstalarServico({ pasta: dir, plataforma: 'win32', executar: async (_c, a) => (comandos.push(a.join(' ')), { codigo: 0, saida: '' }) });
    expect(comandos).toEqual(['stop', 'uninstall']);
  });
});
