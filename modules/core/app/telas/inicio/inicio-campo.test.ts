import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INDICADORES_PRODUTIVIDADE, type ProdutividadeIndicador, type ResultadoIndicador } from '../../../contracts/performance';
import { cardsDeMetasDoMes, contarSino, fraseDoPainel, indicadoresDoInicio, linhaDaData, primeiroNome, saudacaoComNome, textoUltimaSincronizacao } from './inicio-campo';

const r = (p: Partial<ResultadoIndicador> & Pick<ResultadoIndicador, 'indicador'>): ResultadoIndicador => ({
  situacao: 'a_cumprir', meta: null, realizado: null, atingimento_pb: null, gap: null, meta_dia: null, real_dia: null, ...p,
});
const CTX = { tipoMetaVenda: 'faturamento' as const, perfil: 'vendedor' as const };

describe('T-0170 Início do Campo: painel do topo', () => {
  it('RN-CORE-43: "Quinta, 12 de novembro · DU 9 de 20" e, em dia não útil, "Não é dia útil"', () => {
    expect(linhaDaData('2026-11-12', { du_hoje: 9, du_total: 20 })).toBe('Quinta, 12 de novembro · DU 9 de 20');
    expect(linhaDaData('2026-11-15', { du_hoje: null, du_total: 20 })).toBe('Domingo, 15 de novembro · Não é dia útil');
  });

  it('saudação com o primeiro nome; sem nome, só a saudação', () => {
    expect(saudacaoComNome('Boa tarde', 'Lucas Andrade')).toBe('Boa tarde, Lucas');
    expect(saudacaoComNome('Boa tarde', '')).toBe('Boa tarde');
  });

  it('R-20261114-145000: o primeiro nome vem inteiro, com a primeira letra maiúscula e o resto minúsculo', () => {
    expect(primeiroNome('MARIA EDUARDA')).toBe('Maria');
    expect(primeiroNome('  lucas  andrade ')).toBe('Lucas');
    expect(primeiroNome('ÉRICA')).toBe('Érica');
    expect(primeiroNome('joão')).toBe('João');
    expect(primeiroNome('ANA-CLARA SOUZA')).toBe('Ana-Clara');
    expect(primeiroNome('')).toBe('');
    expect(saudacaoComNome('Boa tarde', 'MARIA EDUARDA SILVA')).toBe('Boa tarde, Maria');
    expect(saudacaoComNome('Boa tarde', 'MAXIMILIANO')).toBe('Boa tarde, Maximiliano');
  });

  it('RN-CORE-41: frase do dia em rodízio pelas 30 padrão quando o aparelho ainda não tem frases do tenant; 12/11/2026 = frase 10', () => {
    expect(fraseDoPainel(null, '2026-11-12')).toBe('Cada cliente atendido é uma relação que cresce.');
    expect(fraseDoPainel([], '2026-11-13')).not.toBe(fraseDoPainel([], '2026-11-12'));
  });

  it('RN-CORE-41: com frases do tenant vale o rodízio delas; todas inativas = sem linha', () => {
    const f = (id: string, texto: string, ordem: number, ativa = true) => ({ id, texto, ordem, ativa, deleted_at: null });
    expect(fraseDoPainel([f('a', 'A', 1), f('b', 'B', 2)], '2026-11-12')).toBe('B');
    expect(fraseDoPainel([f('a', 'A', 1, false)], '2026-11-12')).toBeNull();
  });
});

describe('T-0170 Início do Campo: Metas do mês', () => {
  it('faturamento a cumprir: real / meta, % inteiro, barra vermelha, Meta/dia', () => {
    const [c] = cardsDeMetasDoMes([r({ indicador: 'venda_cents', meta: 18_000_000, realizado: 8_460_000, atingimento_pb: 4700, gap: 9_540_000, meta_dia: 870_000 })], CTX);
    expect(c).toMatchObject({ titulo: 'Faturamento', real: 'R$ 84,6 k', meta: '180 k', percentual: '47%', barra: 0.47, tom: 'abaixo', rodape: { rotulo: 'Meta/dia', valor: 'R$ 8.700' } });
  });

  it('positivação e visitas: Meta/dia inteira (o domain arredonda para cima); itens: Meta/pedido', () => {
    const cs = cardsDeMetasDoMes(
      [
        r({ indicador: 'positivacao', meta: 70, realizado: 38, atingimento_pb: 5429, gap: 32, meta_dia: 3 }),
        r({ indicador: 'visitas', meta: 220, realizado: 96, atingimento_pb: 4364, gap: 124, meta_dia: 12 }),
        r({ indicador: 'itens_por_pedido', meta: 800, realizado: 640, atingimento_pb: 8000, gap: 160, meta_dia: 930 }),
      ],
      CTX,
    );
    expect(cs.map((c) => [c.titulo, c.real, c.meta, c.percentual, c.rodape])).toEqual([
      ['Positivação', '38', '70', '54%', { rotulo: 'Meta/dia', valor: '3' }],
      ['Visitas', '96', '220', '44%', { rotulo: 'Meta/dia', valor: '12' }],
      ['Itens/pedido', '6,4', '8,0', '80%', { rotulo: 'Meta/pedido', valor: '9,3' }],
    ]);
  });

  it('100% ou mais: barra cheia em Azul noite e sem Meta/dia', () => {
    const [c] = cardsDeMetasDoMes([r({ indicador: 'visitas', situacao: 'batida', meta: 100, realizado: 120, atingimento_pb: 12_000, gap: 0 })], CTX);
    expect(c).toMatchObject({ percentual: '120%', barra: 1, tom: 'batida', rodape: null });
  });

  it('sem dado: "—"; sem meta: só o realizado, sem barra', () => {
    const [a, b] = cardsDeMetasDoMes([r({ indicador: 'venda_cents', situacao: 'sem_dado' }), r({ indicador: 'visitas', situacao: 'sem_meta', realizado: 30 })], CTX);
    expect(a).toMatchObject({ real: '—', meta: null, percentual: null, rodape: null });
    expect(b).toMatchObject({ real: '30', meta: null, percentual: null, tom: null });
  });

  it('RN-PRO-01: o promotor só recebe Visitas', () => {
    const cs = cardsDeMetasDoMes([r({ indicador: 'venda_cents' }), r({ indicador: 'visitas' })], { ...CTX, perfil: 'promotor' });
    expect(cs.map((c) => c.titulo)).toEqual(['Visitas']);
  });
});

describe('T-0170 Início do Campo: Produtividade', () => {
  const p = (indicador: ProdutividadeIndicador['indicador'], valor: number | null, situacao: ProdutividadeIndicador['situacao']): ProdutividadeIndicador => ({ indicador, valor, meta: null, meta_origem: null, amostra: 0, situacao });
  const todos = INDICADORES_PRODUTIVIDADE.map((i) => p(i, 60, 'dentro'));

  it('mostra os 6 da imagem, na ordem, com nomes curtos', () => {
    expect(indicadoresDoInicio(todos).map((c) => c.titulo)).toEqual(['Jornada', '1º check-in', 'Almoço', 'Últ. check-in', 'Fora de rota', 'TMA']);
  });

  it('ponto verde dentro, laranja fora; sem dado "—" e sem ponto', () => {
    const itens = todos.map((x) => (x.indicador === 'almoco' ? p('almoco', 94, 'fora') : x.indicador === 'tma' ? p('tma', null, 'sem_dado') : x.indicador === 'primeiro_checkin' ? p('primeiro_checkin', 472, 'dentro') : x));
    const c = indicadoresDoInicio(itens);
    expect(c.find((x) => x.indicador === 'almoco')).toMatchObject({ valor: '1h34', ponto: 'fora' });
    expect(c.find((x) => x.indicador === 'primeiro_checkin')).toMatchObject({ valor: '07:52', ponto: 'dentro' });
    expect(c.find((x) => x.indicador === 'tma')).toMatchObject({ valor: '—', ponto: null });
  });
});

describe('T-0170 Início do Campo: sino e sincronização', () => {
  it('conta recados não lidos e tarefas novas', () => {
    const itens = [
      { tipo: 'recado' as const, notificacao: { lida_em: null } },
      { tipo: 'recado' as const, notificacao: { lida_em: '2026-11-12T10:00:00Z' } },
      { tipo: 'tarefa' as const, nova: true },
      { tipo: 'tarefa' as const, nova: false },
    ];
    expect(contarSino(itens)).toEqual({ recados: 1, tarefas: 1, total: 2 });
    expect(contarSino([])).toEqual({ recados: 0, tarefas: 0, total: 0 });
  });

  it('"Últ. sincronização 20:22" no fuso do tenant; sem sincronização, null', () => {
    expect(textoUltimaSincronizacao('2026-11-13T00:22:00Z', 'America/Manaus')).toBe('Últ. sincronização 20:22');
    expect(textoUltimaSincronizacao(null, 'America/Manaus')).toBeNull();
  });
});

describe('Marca no Início do Campo (fonte da tela)', () => {
  const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tela-inicio-campo.tsx'), 'utf8');
  it('MC-0017: valorIndicador usa fonts.displayBold (Archivo Bold, família dos números)', () => {
    expect(fonte).toMatch(/valorIndicador:\s*\{\s*fontFamily:\s*fonts\.displayBold/);
  });
  it('MC-0016: a ProgressBar do CartaoMeta usa color={colors.grafico}', () => {
    expect(fonte).toContain('color={colors.grafico}');
  });
});
