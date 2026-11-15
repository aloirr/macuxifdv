/**
 * T-0172: tela única de entrada. O logo do JS fica no mesmo lugar e no mesmo tamanho da splash nativa (sem corte), a lista
 * de etapas só entra se couber abaixo do logo, e os rótulos são só o nome da etapa e o percentual.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  cabeLista,
  criarMemoriaDaEntrada,
  erroDeSinal,
  LARGURA_LOGO_COM_CLIENTE,
  LARGURA_LOGO_ENTRADA,
  linhaComLogoDoCliente,
  posicaoDoLogo,
  rotuloDaBarra,
  textoDoErro,
} from './entrada';
import { PROPORCAO_LOGO_EMPILHADO } from './logo-marca';

// o índice de `@macuxi/core/app` (API pública do Core) puxa telas: os módulos nativos viram vazios e a regra pura é a real
vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-router', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/ui/mobile', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
const { progressoDaEntrada } = await import('@macuxi/core/app');

/** Largura e altura de um PNG (cabeçalho IHDR). */
function tamanhoPng(caminho: URL): { largura: number; altura: number } {
  const b = readFileSync(caminho);
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

describe('logo da entrada × splash nativa', () => {
  it('mesma largura do app.config.ts e mesma proporção das splash-*.png', () => {
    const config = readFileSync(new URL('../../app.config.ts', import.meta.url), 'utf8');
    expect(config).toContain(`const LARGURA_LOGO_SPLASH = ${LARGURA_LOGO_ENTRADA};`);
    for (const v of ['campo', 'gestao']) {
      const { largura, altura } = tamanhoPng(new URL(`../../assets/images/splash-${v}.png`, import.meta.url));
      expect(largura / altura).toBeCloseTo(PROPORCAO_LOGO_EMPILHADO, 2);
    }
  });

  it('o logo fica no centro da janela', () => {
    const { altura, topo } = posicaoDoLogo(800);
    expect(altura).toBe(Math.round(LARGURA_LOGO_ENTRADA / PROPORCAO_LOGO_EMPILHADO));
    expect(topo + altura / 2).toBeCloseTo(400, 0);
  });

  it('a lista de etapas só entra se couber abaixo do logo (na tela baixa fica só a barra)', () => {
    expect(cabeLista(860, 5, 48, true)).toBe(true);
    expect(cabeLista(640, 5, 48, true)).toBe(false);
    expect(cabeLista(0, 5, 48, true)).toBe(false);
    // sem o "Olá" sobra mais espaço
    expect(cabeLista(780, 5, 0, false)).toBe(true);
    // parada: o erro e as ações ocupam o lugar da barra; a lista só fica na tela alta
    expect(cabeLista(915, 5, 48, true, true)).toBe(false);
    expect(cabeLista(1280, 5, 48, true, true)).toBe(true);
  });
});

describe('rótulos da entrada', () => {
  const etapa = { id: 'clientes_rota' as const, nome: 'Clientes e rota', numero: 2, situacao: 'atual' as const };

  it('"Etapa n de N · nome" e "Pronto" no fim', () => {
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: false })).toBe('Etapa 2 de 5 · Clientes e rota');
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: true })).toBe('Pronto');
  });

  it('erro: "Sem internet" quando falta sinal; senão "Parou"', () => {
    expect(erroDeSinal('Sem sinal: a sincronização fica para quando a conexão voltar.', false)).toBe(true);
    expect(erroDeSinal('HTTP 500', true)).toBe(true);
    expect(erroDeSinal('HTTP 500', false)).toBe(false);
    expect(erroDeSinal(null, false)).toBe(false);
    expect(textoDoErro(etapa, 5, true)).toBe('Sem internet na etapa 2 de 5');
    expect(textoDoErro(etapa, 5, false)).toBe('Parou na etapa 2 de 5');
  });

  it('RD-0239: com a lista na tela, o erro não repete o número da etapa (a lista já marca a que parou)', () => {
    expect(textoDoErro(etapa, 5, true, true)).toBe('Sem internet');
    expect(textoDoErro(etapa, 5, false, true)).toBe('A sincronização parou');
  });
});

describe('memória da entrada (RN-CORE-48: "1 de 5, 2 de 5, 3 de 5...")', () => {
  type Carga = { entidade: string | null; modulo: string | null };
  /** Número mostrado em cada passo da carga, com a memória (`anterior`) entre os passos. */
  function mostrados(perfil: string, modulos: string[], passos: (Carga & { chave?: string })[], fim = false) {
    const lembrar = criarMemoriaDaEntrada();
    const xs = passos.map(
      (c) =>
        lembrar(c.chave ?? 'u1|t1', (anterior) =>
          progressoDaEntrada({
            perfil,
            modulos,
            carga: { entidade: c.entidade, modulo: c.modulo, concluidas: 0, total: 10 },
            progresso: 0.5,
            sincronizando: true,
            erro: null,
            sincronizado: false,
            anterior,
          }),
        ).atual.numero,
    );
    if (!fim) return xs;
    const ultimo = lembrar(passos.at(-1)?.chave ?? 'u1|t1', (anterior) =>
      progressoDaEntrada({
        perfil,
        modulos,
        carga: { entidade: null, modulo: null, concluidas: 10, total: 10 },
        progresso: 1,
        sincronizando: false,
        erro: null,
        sincronizado: true,
        anterior,
      }),
    );
    return [...xs, ultimo.atual.numero];
  }

  it('Campo (vendedor): entidades fora de ordem não fazem a etapa voltar', () => {
    const modulos = ['core', 'catalogo', 'vendedor', 'promotor'];
    // sem a memória: 1, 4, 2, 3, 5, 2 (o que o dono do produto viu)
    const passos: Carga[] = [
      { entidade: null, modulo: null },
      { entidade: 'pedido', modulo: 'vendedor' },
      { entidade: 'cliente', modulo: 'core' },
      { entidade: 'produto', modulo: 'catalogo' },
      { entidade: 'cliente_foto', modulo: 'core' },
      { entidade: 'rota', modulo: 'core' },
    ];
    expect(mostrados('vendedor', modulos, passos)).toEqual([1, 4, 4, 4, 5, 5]);
    // em ordem, a memória não muda nada: 1, 2, 3, 4, 5 e a última no fim
    const emOrdem: Carga[] = [
      { entidade: null, modulo: null },
      { entidade: 'cliente', modulo: 'core' },
      { entidade: 'produto', modulo: 'catalogo' },
      { entidade: 'pedido', modulo: 'vendedor' },
      { entidade: 'cliente_foto', modulo: 'core' },
    ];
    expect(mostrados('vendedor', modulos, emOrdem, true)).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('Gestão (supervisor): o mesmo, com as etapas da gestão', () => {
    const modulos = ['core', 'catalogo', 'vendedor', 'gestor'];
    const passos: Carga[] = [
      { entidade: null, modulo: null },
      { entidade: 'meta', modulo: 'core' },
      { entidade: 'painel_vendedor_dia', modulo: 'gestor' },
      { entidade: 'pedido', modulo: 'vendedor' },
      { entidade: 'alerta', modulo: 'gestor' },
      { entidade: 'cliente', modulo: 'core' },
    ];
    const xs = mostrados('supervisor', modulos, passos);
    expect(xs).toEqual([1, 4, 4, 4, 5, 5]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('outra carga (outro usuário ou tenant) recomeça do zero', () => {
    const modulos = ['core', 'catalogo', 'vendedor', 'promotor'];
    const xs = mostrados('vendedor', modulos, [
      { entidade: 'pedido', modulo: 'vendedor', chave: 'u1|t1' },
      { entidade: 'cliente', modulo: 'core', chave: 'u1|t1' },
      { entidade: 'cliente', modulo: 'core', chave: 'u2|t1' },
      { entidade: 'pedido', modulo: 'vendedor', chave: 'u2|t1' },
      { entidade: null, modulo: null, chave: 'u2|t2' },
    ]);
    expect(xs).toEqual([4, 4, 2, 4, 1]);
  });
});

describe('T-0182: carga com a logo da empresa (variação A, spec logo-cliente §3)', () => {
  it('Macuxi a 124 dp, filete com 24 dp de cada lado e a placa até 112: logo larga = 285 dp, dentro dos 312 úteis de 360 dp', () => {
    const larga = linhaComLogoDoCliente(4);
    expect(larga.larguraPlaca).toBe(112);
    expect(larga.total).toBe(124 + 24 + 1 + 24 + 112);
    expect(larga.total).toBeLessThanOrEqual(312);
  });
  it('logo quadrada: placa de 64 × 64 (nunca mais estreita que alta)', () => {
    expect(linhaComLogoDoCliente(1).larguraPlaca).toBe(64);
  });
  it('passagem da splash: o Macuxi parte do centro da linha e do tamanho da splash', () => {
    const l = linhaComLogoDoCliente(2.5);
    expect(l.deslocamentoInicial).toBe((l.total - LARGURA_LOGO_COM_CLIENTE) / 2);
    expect(l.escalaInicial).toBeCloseTo(LARGURA_LOGO_ENTRADA / LARGURA_LOGO_COM_CLIENTE, 5);
  });
});
