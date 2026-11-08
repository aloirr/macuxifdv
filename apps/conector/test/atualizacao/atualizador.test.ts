import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atualizarConector,
  pastasAtualizacao,
  ResultadoAtualizacao,
  type OpcoesAtualizacao,
} from '../../src/atualizacao';
import { criarLogger } from '../../src/log/logger';
import {
  anunciar,
  bytesDoPacote,
  chavesEd25519,
  criarInstalacao,
  ler,
  Mundo,
  VERSAO_ATUAL,
  VERSAO_NOVA,
} from './suporte';

let pasta = '';
afterEach(() => {
  if (pasta) rmSync(pasta, { recursive: true, force: true });
  pasta = '';
});

const chave = chavesEd25519();
const CHAVES = { teste: chave.publicaPem };

function cenario(conectorNovo: string, extra: Record<string, string> = {}) {
  pasta = criarInstalacao();
  const bytes = bytesDoPacote({ 'conector.mjs': conectorNovo, 'node.exe': 'node-24.9', ...extra });
  const mundo = new Mundo(pasta, bytes);
  const opcoes: OpcoesAtualizacao = {
    pasta,
    versaoAtual: VERSAO_ATUAL,
    pacote: anunciar(bytes, chave.privada),
    limiteSaudeMs: 10_000,
    intervaloSaudeMs: 1_000,
  };
  return { mundo, opcoes, bytes };
}

/** O resultado obedece ao schema e a mensagem não carrega URL, token nem caminho de pasta. */
function conferirSemDadoPessoal(r: ResultadoAtualizacao): void {
  expect(ResultadoAtualizacao.safeParse(r).success).toBe(true);
  const texto = JSON.stringify(r);
  expect(texto).not.toMatch(/https?:|token|segredo|exemplo\.invalid/);
  expect(texto).not.toContain(pasta);
}

describe('T-0116: atualização automática do Conector (isolada do executor)', () => {
  it('pacote válido: troca, sobe, responde à saúde na versão nova → atualizado (backup guardado)', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'atualizado', de: VERSAO_ATUAL, para: VERSAO_NOVA });
    conferirSemDadoPessoal(r);
    expect(mundo.rodando).toBe(VERSAO_NOVA);
    expect(mundo.chamadas.slice(0, 4)).toEqual(['baixar', 'extrair', 'parar', 'iniciar']);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_NOVA}`);
    expect(ler(pasta, 'atualizacao/anterior/conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(ler(pasta, 'dados/fila.db')).toBe('fila');
    // nada de lixo: sem pasta de extração, sem arquivo do pacote, sem trava
    const p = pastasAtualizacao(pasta);
    expect([p.nova, p.arquivoPacote, p.trava].some(existsSync)).toBe(false);
  });

  it('assinatura inválida → mantido, sem parar o serviço nem tocar em arquivo', async () => {
    const { mundo, opcoes, bytes } = cenario(`versao=${VERSAO_NOVA}`);
    const forjado = anunciar(bytes, chavesEd25519().privada);
    const r = await atualizarConector({ ...opcoes, pacote: forjado }, mundo.deps(CHAVES));
    expect(r).toMatchObject({
      resultado: 'mantido',
      versao: VERSAO_ATUAL,
      oferecida: VERSAO_NOVA,
      motivo: 'assinatura_invalida',
    });
    conferirSemDadoPessoal(r);
    expect(mundo.chamadas).toEqual(['baixar']);
    expect(mundo.rodando).toBe(VERSAO_ATUAL);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(existsSync(pastasAtualizacao(pasta).anterior)).toBe(false);
  });

  it('sem chave embutida (padrão até a chave de produção existir): recusa tudo — falha fechada', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    const { chaves: _semChaves, ...deps } = mundo.deps(CHAVES);
    const r = await atualizarConector(opcoes, deps);
    expect(r).toMatchObject({ resultado: 'mantido', motivo: 'chave_desconhecida' });
    expect(mundo.rodando).toBe(VERSAO_ATUAL);
  });

  it('versão nova sobe mas não responde à saúde em N segundos → volta à anterior (revertido, anterior saudável)', async () => {
    const { mundo, opcoes } = cenario('quebrado');
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({
      resultado: 'revertido',
      de: VERSAO_ATUAL,
      tentou: VERSAO_NOVA,
      motivo: 'sem_saude',
      anterior: 'saudavel',
    });
    conferirSemDadoPessoal(r);
    expect(r.duracao_ms).toBeGreaterThanOrEqual(10_000);
    expect(mundo.rodando).toBe(VERSAO_ATUAL);
    expect(mundo.respondendo).toBe(true);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(ler(pasta, 'node.exe')).toBe('node-24.7');
    expect(ler(pasta, 'dados/fila.db')).toBe('fila');
  });

  it('versão nova nem sobe (iniciar falha) → revertido por falha na subida', async () => {
    const { mundo, opcoes } = cenario('nao-sobe');
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'revertido', motivo: 'falha_na_subida', anterior: 'saudavel' });
    expect(mundo.rodando).toBe(VERSAO_ATUAL);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
  });

  it('responde, mas com outra versão (processo antigo não morreu) → revertido por versão divergente', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    mundo.saudeForcada = '1.2.0';
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'revertido', motivo: 'versao_divergente', anterior: 'sem_saude' });
    expect(r.mensagem).toMatch(/versão anterior também não respondeu/);
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
  });

  it('nem a anterior volta a responder depois da volta → revertido com anterior sem saúde (para o monitor alertar)', async () => {
    const { mundo, opcoes } = cenario('quebrado');
    writeFileSync(join(pasta, 'conector.mjs'), 'quebrado'); // a "atual" também está quebrada no disco
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'revertido', motivo: 'sem_saude', anterior: 'sem_saude' });
    conferirSemDadoPessoal(r);
  });

  it('falha no download → mantido, e o erro (com URL e token) não vaza para o resultado nem para o log', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    mundo.falharDownload = true;
    const linhas: string[] = [];
    const log = criarLogger({
      nivel: 'debug',
      escrever: (l) => linhas.push(l),
      relogio: { agora: () => mundo.tempo },
    });
    const r = await atualizarConector(opcoes, { ...mundo.deps(CHAVES), log });
    expect(r).toMatchObject({ resultado: 'mantido', motivo: 'falha_no_download' });
    conferirSemDadoPessoal(r);
    expect(linhas.join('\n')).toContain('atualizacao_mantida');
    expect(linhas.join('\n')).not.toMatch(/token|segredo|https?:/);
  });

  it('pacote mal formado ou com item protegido (conector.json) → mantido, nada trocado', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`, {
      'conector.json': '{"hub":{"url":"https://atacante.invalid"}}',
    });
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'mantido', motivo: 'pacote_invalido' });
    expect(mundo.chamadas).not.toContain('parar');
    expect(ler(pasta, 'conector.json')).toBe('{"hub":{}}');
    mundo.falharExtracao = true;
    const r2 = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r2).toMatchObject({ resultado: 'mantido', motivo: 'pacote_invalido' });
  });

  it('não consegue parar o serviço → mantido, versão atual intacta e serviço de pé', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    mundo.falharParada = true;
    const r = await atualizarConector(opcoes, mundo.deps(CHAVES));
    expect(r).toMatchObject({ resultado: 'mantido', motivo: 'falha_ao_parar' });
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
    expect(mundo.rodando).toBe(VERSAO_ATUAL);
  });

  it('sem pacote, pacote fora do contrato ou versão não mais nova → mantido sem baixar nada', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    const deps = mundo.deps(CHAVES);
    expect(await atualizarConector({ ...opcoes, pacote: null }, deps)).toMatchObject({
      resultado: 'mantido',
      motivo: 'sem_pacote',
      oferecida: null,
    });
    expect(
      await atualizarConector({ ...opcoes, pacote: { ...opcoes.pacote!, sha256: 'xyz' } }, deps),
    ).toMatchObject({ motivo: 'pacote_invalido' });
    expect(
      await atualizarConector({ ...opcoes, pacote: { ...opcoes.pacote!, versao: VERSAO_ATUAL } }, deps),
    ).toMatchObject({ motivo: 'ja_atualizado' });
    expect(
      await atualizarConector({ ...opcoes, pacote: { ...opcoes.pacote!, versao: '1.2.0' } }, deps),
    ).toMatchObject({ motivo: 'ja_atualizado' });
    expect(mundo.chamadas).toEqual([]);
  });

  it('só uma atualização por vez: trava recente bloqueia; trava vencida (tentativa que morreu) é retomada', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    const p = pastasAtualizacao(pasta);
    mkdirSync(p.raiz, { recursive: true });
    mundo.tempo = 3_600_000;
    writeFileSync(p.trava, String(mundo.tempo - 60_000));
    expect(await atualizarConector(opcoes, mundo.deps(CHAVES))).toMatchObject({
      resultado: 'mantido',
      motivo: 'atualizacao_em_andamento',
    });
    expect(existsSync(p.trava)).toBe(true);
    writeFileSync(p.trava, String(mundo.tempo - 31 * 60_000));
    expect(await atualizarConector(opcoes, mundo.deps(CHAVES))).toMatchObject({ resultado: 'atualizado' });
    expect(existsSync(p.trava)).toBe(false);
  });

  it('falha na troca antes do manifesto não restaura o backup de uma atualização ANTIGA', async () => {
    const { mundo, opcoes } = cenario(`versao=${VERSAO_NOVA}`);
    // backup de uma atualização anterior (1.1.0 → 1.2.1) ainda na pasta
    const p = pastasAtualizacao(pasta);
    mkdirSync(p.anterior, { recursive: true });
    writeFileSync(join(p.anterior, 'conector.mjs'), 'versao=1.1.0');
    writeFileSync(
      p.manifesto,
      JSON.stringify({
        versao_anterior: '1.1.0',
        versao_nova: VERSAO_ATUAL,
        estado: 'trocada',
        substituidos: ['conector.mjs'],
        novos: [],
      }),
    );
    // o conector.mjs extraído some entre a validação e a troca: a troca falha antes de gravar o manifesto novo
    const deps = mundo.deps(CHAVES);
    const parar = deps.servico.parar;
    deps.servico = {
      ...deps.servico,
      parar: async () => {
        rmSync(join(p.nova, 'conector.mjs'), { force: true });
        await parar();
      },
    };
    const r = await atualizarConector(opcoes, deps);
    expect(r).toMatchObject({ resultado: 'revertido', motivo: 'falha_na_troca' });
    expect(ler(pasta, 'conector.mjs')).toBe(`versao=${VERSAO_ATUAL}`);
  });
});
