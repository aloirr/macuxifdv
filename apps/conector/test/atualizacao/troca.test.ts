import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ErroTroca,
  lerManifesto,
  pastasAtualizacao,
  restaurarVersao,
  trocarVersao,
} from '../../src/atualizacao';
import { criarInstalacao, ler, VERSAO_ATUAL, VERSAO_NOVA } from './suporte';

let pasta = '';
afterEach(() => {
  if (pasta) rmSync(pasta, { recursive: true, force: true });
  pasta = '';
});

function extrairNova(arquivos: Record<string, string>): void {
  const { nova } = pastasAtualizacao(pasta);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(nova, caminho, '..'), { recursive: true });
    writeFileSync(join(nova, caminho), conteudo);
  }
}

describe('T-0116: troca de versão com backup da atual', () => {
  it('põe a nova em uso, guarda a atual em atualizacao/anterior e não toca em dados/ nem conector.json', () => {
    pasta = criarInstalacao();
    extrairNova({
      'conector.mjs': `versao=${VERSAO_NOVA}`,
      'node.exe': 'node-24.9',
      'LEIA-ME.txt': 'novidades',
    });
    const m = trocarVersao(pasta, VERSAO_ATUAL, VERSAO_NOVA);
    expect(m).toMatchObject({
      estado: 'trocada',
      substituidos: ['conector.mjs', 'node.exe'],
      novos: ['LEIA-ME.txt'],
    });
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_NOVA}`);
    expect(ler(pasta, 'LEIA-ME.txt')).toBe('novidades');
    expect(ler(pasta, 'atualizacao/anterior/conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(ler(pasta, 'atualizacao/anterior/node.exe')).toBe('node-24.7');
    // fora do pacote: fica como estava
    expect(ler(pasta, 'exemplos/views.sql')).toBe('select 1 -- antigo');
    expect(ler(pasta, 'dados/fila.db')).toBe('fila');
    expect(ler(pasta, 'conector.json')).toBe('{"hub":{}}');
  });

  it('restaurar volta exatamente a anterior: substituídos voltam, itens só da nova saem; e é idempotente', () => {
    pasta = criarInstalacao();
    extrairNova({
      'conector.mjs': `versao=${VERSAO_NOVA}`,
      'exemplos/views.sql': 'select 2',
      'LEIA-ME.txt': 'novidades',
    });
    trocarVersao(pasta, VERSAO_ATUAL, VERSAO_NOVA);
    expect(ler(pasta, 'exemplos/views.sql')).toBe('select 2');
    restaurarVersao(pasta);
    restaurarVersao(pasta);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(ler(pasta, 'exemplos/views.sql')).toBe('select 1 -- antigo');
    expect(existsSync(join(pasta, 'LEIA-ME.txt'))).toBe(false);
    expect(ler(pasta, 'node.exe')).toBe('node-24.7');
    expect(ler(pasta, 'dados/fila.db')).toBe('fila');
    expect(lerManifesto(pasta)?.estado).toBe('restaurada');
  });

  it('troca interrompida no meio (parte dos itens já saiu): a restauração recompõe a versão anterior', () => {
    pasta = criarInstalacao();
    extrairNova({ 'conector.mjs': `versao=${VERSAO_NOVA}`, 'node.exe': 'node-24.9' });
    const p = pastasAtualizacao(pasta);
    // simula a queda logo depois do manifesto e da 1ª movimentação
    mkdirSync(p.anterior, { recursive: true });
    writeFileSync(
      p.manifesto,
      JSON.stringify({
        versao_anterior: VERSAO_ATUAL,
        versao_nova: VERSAO_NOVA,
        estado: 'em_troca',
        substituidos: ['conector.mjs', 'node.exe'],
        novos: [],
      }),
    );
    renameSync(join(pasta, 'conector.mjs'), join(p.anterior, 'conector.mjs'));
    restaurarVersao(pasta);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(ler(pasta, 'node.exe')).toBe('node-24.7');
  });

  it('pacote que traz item protegido (dados/, conector.json) ou não traz o conector.mjs é recusado antes de mexer em algo', () => {
    pasta = criarInstalacao();
    extrairNova({
      'conector.mjs': `versao=${VERSAO_NOVA}`,
      'Conector.json': '{"hub":{"url":"https://atacante.invalid"}}',
    });
    expect(() => trocarVersao(pasta, VERSAO_ATUAL, VERSAO_NOVA)).toThrow(ErroTroca);
    expect(ler(pasta, 'conector.json')).toBe('{"hub":{}}');
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    rmSync(pastasAtualizacao(pasta).nova, { recursive: true });
    extrairNova({ 'LEIA-ME.txt': 'sem o conector' });
    expect(() => trocarVersao(pasta, VERSAO_ATUAL, VERSAO_NOVA)).toThrow(/conector\.mjs/);
  });

  it('sem backup não há o que restaurar', () => {
    pasta = criarInstalacao();
    expect(() => restaurarVersao(pasta)).toThrow(expect.objectContaining({ codigo: 'sem_backup' }));
  });
});
