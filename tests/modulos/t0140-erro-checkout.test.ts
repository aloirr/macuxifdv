/**
 * T-0140 (teste de campo de 08/11 à noite) — o que dá para provar sem aparelho:
 *  (E) tela de erro e registro do último erro (apps/mobile/src/services/erros.ts → lib/erro-de-tela.ts → services/storage.ts):
 *      regra 8 do CLAUDE.md, SEM DADO PESSOAL nem no que fica gravado no aparelho (o `JSON.stringify` do `writeJson`) nem no
 *      `console.warn` (vai para o logcat do build de release) — ponto levantado pelo engenheiro-software (R-20261108-215731).
 *      Cadeia REAL: `gravarErro` e o tratador global do `ErrorUtils`, com o AsyncStorage simulado em memória;
 *  (F) relato 5: o aviso de checkout recusado fica 10 s na tela (antes 3,8 s, sumia antes de ser lido) — conferido no fonte
 *      (o provedor das folhas importa react-native).
 * Sem banco: roda local e no CI. Matriz e roteiro do aparelho: docs/testes/T-0140.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `travar` segura o setItem até o fim do caso; o afterEach solta as gravações presas, porque o `writeJson` grava em série
// por chave e uma gravação presa (E6) seguraria a fila dos casos seguintes (o E8 ficava em timeout de 60 s)
const disco = vi.hoisted(() => ({ m: new Map<string, string>(), travar: false, presas: [] as Array<() => void> }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disco.m.get(k) ?? null,
    setItem: (k: string, v: string) => (disco.travar ? new Promise<void>((soltar) => disco.presas.push(soltar)) : (disco.m.set(k, v), Promise.resolve())),
    removeItem: async (k: string) => {
      disco.m.delete(k);
    },
  },
}));
// o serviço importa a regra pelo alias do Metro (`@/lib/erro-de-tela`); aqui aponta para o arquivo real
vi.mock('@/lib/erro-de-tela', () => import('../../apps/mobile/src/lib/erro-de-tela'));

import { CHAVE_ULTIMO_ERRO, textoDoUltimoErro, type ErroRegistrado } from '../../apps/mobile/src/lib/erro-de-tela';
import { gravarErro, lerUltimoErro, ligarRegistroDeErrosFatais } from '../../apps/mobile/src/services/erros';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

/** Dados pessoais de um cliente fictício que podem aparecer numa mensagem de erro (corpo de resposta, validação, etc.). */
const PESSOAIS = {
  email: 'maria.silva@exemplo.com.br',
  cpf: '123.456.789-09',
  cpfCru: '12345678909',
  cnpj: '12.345.678/0001-90',
  telefone: '(92) 99123-4567',
  nome: 'Maria da Silva',
};
const SEM_NUMEROS_PESSOAIS = [PESSOAIS.email, PESSOAIS.cpf, PESSOAIS.cpfCru, PESSOAIS.cnpj, '99123-4567', '12345678909'];

let avisos: unknown[][];
beforeEach(() => {
  disco.m.clear();
  disco.travar = false;
  avisos = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    avisos.push(a);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  disco.travar = false;
  for (const soltar of disco.presas.splice(0)) soltar();
});

const gravado = () => disco.m.get(CHAVE_ULTIMO_ERRO) ?? '';
const textoDosAvisos = () => avisos.map((a) => a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n');

describe('T-0140 E — último erro do app sem dado pessoal (regra 8; R-20261108-215731)', () => {
  it('E1. Error com e-mail, CPF, CNPJ e telefone na mensagem e na pilha: nada disso chega ao disco nem ao console.warn', async () => {
    const e = new TypeError(`cliente ${PESSOAIS.email} cpf ${PESSOAIS.cpf} cnpj ${PESSOAIS.cnpj} fone ${PESSOAIS.telefone} doc ${PESSOAIS.cpfCru}`);
    e.stack = `TypeError: x\n    at validar (${PESSOAIS.email}:1:1)\n    at OrderEditor (index.android.bundle:1234:56)\n    at doc ${PESSOAIS.cnpj}`;
    await gravarErro(e, 'tela', '/m/novo-pedido');
    const disk = gravado();
    expect(disk).not.toBe('');
    for (const p of SEM_NUMEROS_PESSOAIS) {
      expect(disk, `disco: ${p}`).not.toContain(p);
      expect(textoDosAvisos(), `console: ${p}`).not.toContain(p);
    }
    const r = JSON.parse(disk) as ErroRegistrado;
    expect(r).toMatchObject({ origem: 'tela', onde: '/m/novo-pedido' });
    expect(r.mensagem).toContain('[e-mail]');
    expect(r.mensagem).toContain('[número]');
    expect(r.pilha).toContain('OrderEditor (index.android.bundle:1234:56)'); // a pilha útil fica
    // o console.warn leva só a origem e o tipo
    expect(avisos).toEqual([['[erro tela] TypeError']]);
  });

  it('E2. objeto lançado (ex.: corpo de resposta da API com o cliente): guarda só as chaves, nunca os valores', async () => {
    await gravarErro({ codigo: 'CLIENTE_BLOQUEADO', nome: PESSOAIS.nome, email: PESSOAIS.email, cnpj: PESSOAIS.cnpj }, 'fatal');
    const disk = gravado();
    for (const p of [PESSOAIS.nome, PESSOAIS.email, PESSOAIS.cnpj, 'CLIENTE_BLOQUEADO']) expect(disk, p).not.toContain(p);
    expect((JSON.parse(disk) as ErroRegistrado).mensagem).toBe('Objeto lançado {codigo, nome, email, cnpj}');
    expect(textoDosAvisos()).toBe('[erro fatal] object');
  });

  it('E3. texto lançado com e-mail: mascarado no disco; o console.warn não leva o texto', async () => {
    await gravarErro(`falhou para ${PESSOAIS.email}`, 'raiz');
    expect(gravado()).not.toContain(PESSOAIS.email);
    expect(textoDosAvisos()).toBe('[erro raiz] string');
  });

  it('E4. o não fatal não apaga a causa do fechamento; o Diagnóstico mostra o fatal', async () => {
    await gravarErro(new Error('Rendered more hooks than during the previous render.'), 'fatal', '/m/novo-pedido');
    await gravarErro(new Error('rede caiu'), 'nao-fatal');
    const r = await lerUltimoErro();
    expect(r?.origem).toBe('fatal');
    expect(r?.mensagem).toBe('Rendered more hooks than during the previous render.');
    const linha = textoDoUltimoErro(r, () => 'hoje 21:10');
    expect(linha).toContain('hoje 21:10');
    expect(linha).toContain('/m/novo-pedido');
    expect(linha).toContain('Rendered more hooks');
  });

  it('E5. registrar nunca derruba o app: disco com erro → gravarErro resolve sem lançar', async () => {
    const orig = disco.m.set.bind(disco.m);
    disco.m.set = () => {
      throw new Error('disco cheio');
    };
    await expect(gravarErro(new Error('x'), 'tela')).resolves.toBeUndefined();
    disco.m.set = orig;
  });

  it('E6. erro fatal fora do React: grava ANTES de deixar o React Native encerrar, chama o tratador anterior uma vez; disco travado → segue em 600 ms', async () => {
    vi.useFakeTimers();
    let tratador: ((e: unknown, fatal?: boolean) => void) | null = null;
    const anteriores: Array<{ fatal: boolean | undefined; gravouAntes: boolean }> = [];
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => (_e: unknown, fatal?: boolean) => anteriores.push({ fatal, gravouAntes: disco.m.has(CHAVE_ULTIMO_ERRO) }),
      setGlobalHandler: (t: (e: unknown, fatal?: boolean) => void) => (tratador = t),
    };
    try {
      ligarRegistroDeErrosFatais();
      ligarRegistroDeErrosFatais(); // liga uma vez só
      expect(tratador).not.toBeNull();

      // fatal: grava e só então chama o anterior (que encerra o app)
      tratador!(new Error(`quebrou com ${PESSOAIS.email}`), true);
      await vi.advanceTimersByTimeAsync(0);
      expect(anteriores).toEqual([{ fatal: true, gravouAntes: true }]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(anteriores).toHaveLength(1); // o limite de 600 ms não chama de novo
      expect(gravado()).not.toContain(PESSOAIS.email);

      // fatal com o disco travado: o app não fica preso, segue em 600 ms
      disco.m.clear();
      disco.travar = true;
      tratador!(new Error('outro'), true);
      await vi.advanceTimersByTimeAsync(599);
      expect(anteriores).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(anteriores).toHaveLength(2);

      // não fatal: segue na hora
      disco.travar = false;
      tratador!(new Error('aviso'), false);
      expect(anteriores).toHaveLength(3);
      expect(anteriores[2]!.fatal).toBe(false);
    } finally {
      vi.useRealTimers();
      delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    }
  });

  it('E7. a tela de erro grava com a rota (módulo) e a raiz grava sem rota; o registro é ligado antes do roteador', () => {
    const tela = ler('apps/mobile/src/components/tela-de-erro.tsx');
    expect(tela).toContain("void gravarErro(error, 'tela', onde);");
    expect(tela).toContain("void gravarErro(error, 'raiz');");
    expect(ler('apps/mobile/src/app/_layout.tsx')).toContain('export const ErrorBoundary = TelaDeErroDaRaiz;');
    expect(ler('apps/mobile/src/app/(tabs)/m/[...caminho].tsx')).toContain('export const ErrorBoundary = TelaDeErroDoModulo;');
    const index = ler('apps/mobile/index.ts');
    const erros = index.indexOf("import './src/services/erros-globais';");
    expect(erros).toBeGreaterThanOrEqual(0);
    expect(erros).toBeLessThan(index.indexOf("import 'expo-router/entry';"));
    expect(erros).toBeLessThan(index.indexOf("import './src/services/segundo-plano';"));
    // nenhum console.* da tela de erro e do serviço leva o objeto do erro inteiro
    expect(tela).not.toMatch(/console\.\w+\(/);
    expect(ler('apps/mobile/src/services/erros.ts').match(/console\.\w+\([^)]*\)/g)).toEqual(['console.warn(`[erro ${origem}] ${e instanceof Error ? e.name : typeof e}`)']);
  });

  // Corrigido pelo engenheiro-apps (R-20261109-001858): `limparDadoPessoal` troca o telefone sem DDD (8 ou 9 dígitos,
  // hífen opcional) por [número], sem pegar a pilha (bundle:linha:coluna), o UUID nem a data ISO.
  it('E8. telefone SEM DDD (99123-4567, 3234-5678, 991234567) sai mascarado; pilha, UUID e data ficam', async () => {
    const uuid = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
    await gravarErro(
      new Error(`cliente sem crédito; ligar 99123-4567, 3234-5678 ou 991234567 (visita ${uuid} em 2026-11-09) at index.android.bundle:1234:56789`),
      'tela',
    );
    const texto = gravado();
    expect(texto).not.toContain('99123-4567');
    expect(texto).not.toContain('3234-5678');
    expect(texto).not.toContain('991234567');
    expect(texto).toContain('[número]');
    expect(texto).toContain('index.android.bundle:1234:56789');
    expect(texto).toContain(uuid);
    expect(texto).toContain('2026-11-09');
  });
});

describe('T-0140 F — relato 5: aviso de checkout recusado com 10 s (RN-CORE-12)', () => {
  const folhas = ler('modules/core/app/components/visit-sheets.tsx');
  it('F1. checkout recusado pelo servidor: aviso de alerta por 10 s com o motivo (ou o texto padrão)', () => {
    expect(folhas).toContain(
      "toast(`O checkout não foi concluído. ${item.ultimo_erro || 'O servidor não aceitou o checkout. Confira os dados e conclua de novo.'}`, 'warning', 10000);",
    );
    expect(folhas).toMatch(/if \(item\.entidade === 'visita_checkout'\) \{/);
  });
  it('F2. o sucesso continua com 3,8 s e um aviso novo substitui o anterior (o temporizador é trocado)', () => {
    expect(folhas).toContain("const toast = useCallback((message: string, tone: ToastTone = 'success', duracaoMs = 3800) => {");
    expect(folhas).toMatch(/if \(timer\.current\) clearTimeout\(timer\.current\);\s*timer\.current = setTimeout\(\(\) => setToast\(null\), duracaoMs\);/);
    expect(folhas).toContain('toast(`Checkout feito em ${name}. Check-in liberado para o próximo cliente.`);');
  });
  it('F3. o item recusado sai da fila depois do aviso (a visita volta aberta para refazer, sem aviso repetido)', () => {
    expect(folhas).toMatch(/'warning', 10000\);[\s\S]{0,400}void motor\.descartar\(item\.id\);/);
  });
});
