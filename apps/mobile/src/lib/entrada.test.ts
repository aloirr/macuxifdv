/**
 * T-0172: tela única de entrada. O logo do JS fica no mesmo lugar e no mesmo tamanho da splash nativa (sem corte), a lista
 * de etapas só entra se couber abaixo do logo, e os rótulos são só o nome da etapa e o percentual.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  alturaDoAviso,
  alturaDoBlocoFrase,
  cabeFrase,
  cabeLista,
  criarMemoriaDaEntrada,
  erroDeSinal,
  fraseEmUmaLinha,
  fraseInteira,
  linhasDoAviso,
  LARGURA_LOGO_ENTRADA,
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

describe('carga: bloco "Você sabia?" e aviso (T-0181, spec carga-aviso-frases §1.1)', () => {
  const LONGA = 'Os Macuxi se autodenominam Pemon e falam uma língua da família Karib.';
  const CURTA = 'O lavrado é a savana de Roraima.';

  it('bloco: 84 dp com a frase em 2 linhas, 64 com 1; a frase curta cabe em 1 linha, a longa não', () => {
    expect(alturaDoBlocoFrase(2)).toBe(84);
    expect(alturaDoBlocoFrase(1)).toBe(64);
    expect(alturaDoBlocoFrase(0)).toBe(0);
    expect(fraseEmUmaLinha(CURTA)).toBe(true);
    expect(fraseEmUmaLinha(LONGA)).toBe(false);
  });

  it('360 × 800 sem navegação: tudo aparece, frase em 2 linhas', () => {
    expect(cabeFrase(800, 0, LONGA)).toBe(2);
  });

  it('360 × 800 com 48 dp de navegação: tudo aparece, frase em 2 linhas', () => {
    expect(cabeFrase(800, 48, LONGA)).toBe(2);
  });

  it('360 × 640 com 48 dp de navegação: o bloco inteiro sai (ficam logo, "Olá", aviso e barra)', () => {
    expect(cabeFrase(640, 48, LONGA)).toBe(0);
    expect(cabeFrase(640, 48, CURTA)).toBe(0);
  });

  it('altura intermediária: a frase cai para 1 linha só se couber inteira; senão o bloco sai (sem reticências)', () => {
    expect(cabeFrase(700, 48, CURTA)).toBe(1);
    expect(cabeFrase(700, 48, LONGA)).toBe(0);
    expect(cabeFrase(0, 48, CURTA)).toBe(0);
    expect(cabeFrase(800, 0, '   ')).toBe(0);
  });

  it('a lista de etapas sai antes do bloco: conta o aviso e o bloco com o respiro de 24 dp', () => {
    // 860 com 48 de navegação: sem o bloco a lista cabia; com aviso e bloco de 2 linhas, sai e o bloco fica
    expect(cabeLista(860, 5, 48, true)).toBe(true);
    expect(cabeFrase(860, 48, LONGA)).toBe(2);
    expect(cabeLista(860, 5, 48, true, false, { aviso: true, linhasFrase: 2 })).toBe(false);
    // só o aviso já pesa
    expect(cabeLista(860, 5, 48, true, false, { aviso: true })).toBe(false);
    // tela alta: tudo junto
    expect(cabeLista(1100, 5, 48, true, false, { aviso: true, linhasFrase: 2 })).toBe(true);
    // parada (sem aviso nem bloco): a regra de antes
    expect(cabeLista(1280, 5, 48, true, true, {})).toBe(true);
  });
});

describe('carga: escala de fonte e frase sem reticências (T-0181, revisão 🟡1 e 🟡2)', () => {
  const LONGA = 'Os Macuxi se autodenominam Pemon e falam uma língua da família Karib.';
  const CURTA = 'O lavrado é a savana de Roraima.';

  it('aviso nunca cortado: 1 linha na escala 1,0; com fonte grande, 2 linhas, e a altura conta as 2', () => {
    expect(linhasDoAviso()).toBe(1);
    expect(linhasDoAviso(1)).toBe(1);
    expect(linhasDoAviso(1.15)).toBe(2);
    expect(linhasDoAviso(1.3)).toBe(2);
    expect(alturaDoAviso()).toBe(28);
    expect(alturaDoAviso(1.3)).toBe(2 * 24 + 10);
  });

  it('o bloco cresce com a fonte: 84 dp na escala 1,0, 108 na 1,3 (texto escala, espaços não)', () => {
    expect(alturaDoBlocoFrase(2, 1)).toBe(84);
    expect(alturaDoBlocoFrase(2, 1.3)).toBe(20 + 24 + 6 + 2 * 26);
    expect(alturaDoBlocoFrase(1, 1.3)).toBe(20 + 24 + 6 + 26);
  });

  it('com fonte grande, cabe menos numa linha: a frase curta que cabia em 1 linha deixa de caber', () => {
    expect(fraseEmUmaLinha(CURTA, 1)).toBe(true);
    expect(fraseEmUmaLinha(CURTA, 1.3)).toBe(false);
    // escala menor que 1 não aumenta o que cabe (conta por baixo)
    expect(fraseEmUmaLinha('x'.repeat(33), 0.85)).toBe(false);
  });

  it('a mesma tela dá menos espaço com fonte grande: 800 + 48 de navegação tem 2 linhas na 1,0 e nada na 1,3', () => {
    expect(cabeFrase(800, 48, LONGA, 1)).toBe(2);
    expect(cabeFrase(800, 48, LONGA, 1.3)).toBe(0);
    expect(cabeFrase(900, 0, LONGA, 1.3)).toBe(2);
  });

  it('a lista de etapas conta o aviso em 2 linhas e o bloco maior com fonte grande', () => {
    expect(cabeLista(1100, 5, 48, true, false, { aviso: true, linhasFrase: 2 })).toBe(true);
    expect(cabeLista(1100, 5, 48, true, false, { aviso: true, linhasFrase: 2, escala: 1.3 })).toBe(false);
  });

  it('frase medida na tela: só aparece se coube nas linhas dadas; senão o bloco inteiro sai (sem reticências)', () => {
    expect(fraseInteira(null, 2)).toBe(false);
    expect(fraseInteira(0, 2)).toBe(false);
    expect(fraseInteira(1, 2)).toBe(true);
    expect(fraseInteira(2, 2)).toBe(true);
    expect(fraseInteira(3, 2)).toBe(false);
    expect(fraseInteira(1, 1)).toBe(true);
    expect(fraseInteira(2, 1)).toBe(false);
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
