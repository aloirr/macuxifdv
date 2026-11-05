import { describe, expect, it } from 'vitest';

import type { RvLocal } from '../../contracts';
import { textoDoGatilho } from '../../web/lib/plano-rv';
import { avisoAoSincronizarRv, dataDoCalculo, montarMinhaRv, textoDoGatilhoRv, validarCopiaRv } from './minha-rv';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const FUSO = 'America/Manaus';

type Ind = RvLocal['painel']['pessoas'][number]['indicadores'][number];
const ind = (o: Partial<Ind>): Ind => ({ indicador: 'venda_cents', meta: 100_000_00, realizado: 80_000_00, atingimento_pbp: 8000, projetado_pbp: 9250, pagamento_pct: 92.5, valor_cents: 92_500, gatilho: false, gatilho_ok: null, sem_meta: false, ...o });
const copia = (pessoa: Partial<RvLocal['painel']['pessoas'][number]> = {}, painel: Partial<RvLocal['painel']> = {}): RvLocal => ({
  recebido_em: '2026-11-05T14:30:00Z',
  painel: {
    periodo: '2026-11',
    situacao: 'parcial',
    fechamento_em: '2026-12-02',
    plano_id: P,
    pessoas: [{ usuario_id: U, nome: 'Ana', equipe_id: null, plano_id: P, rv_cents: 92_500, rv_bruta_cents: 92_500, bloqueada_por: [], indicadores: [ind({})], ...pessoa }],
    ...painel,
  },
});

describe('RN-CORE-29: minha RV no app', () => {
  it('RN-CORE-29: sem cálculo recebido mostra vazio com a ação seguinte', () => {
    const v = montarMinhaRv(null, U, FUSO);
    expect(v.tipo).toBe('sem_calculo');
    if (v.tipo === 'sem_calculo') expect(v.texto).toContain('Sincronizar');
  });
  it('RN-CORE-30: cálculo recebido sem a pessoa (plano não vale para o perfil) mostra "sem plano" com a data', () => {
    const v = montarMinhaRv(copia({ usuario_id: P }), U, FUSO);
    expect(v).toMatchObject({ tipo: 'sem_plano', calculado_em: '05/11 às 10:30' });
  });
  it('RN-CORE-29: mês aberto com RV > 0 e sem gatilho barrando = "No ritmo", valor projetado e parcial', () => {
    const v = montarMinhaRv(copia(), U, FUSO);
    expect(v).toMatchObject({ tipo: 'ok', parcial: true, rotulo: 'RV projetada', estado: 'No ritmo', tom: 'sucesso', aviso_gatilho: null });
    if (v.tipo === 'ok') {
      expect(v.valor).toContain('925');
      expect(v.nota).toContain('parcial até o fechamento (02/12/2026)');
      expect(v.linhas[0]).toMatchObject({ atingimento: '92,5% projetado', faixa: 'Faixa atingida: paga 92,5%', progresso_pct: 92.5 });
    }
  });
  it('RN-CORE-29: mês aberto usa o atingimento projetado; fechado usa o realizado', () => {
    const p = copia({}, { situacao: 'fechado' });
    const v = montarMinhaRv(p, U, FUSO);
    expect(v).toMatchObject({ parcial: false, rotulo: 'RV do mês', estado: 'Atingida' });
    if (v.tipo === 'ok') expect(v.linhas[0]!.atingimento).toBe('80,0%');
  });
  it('RN-CORE-29: RV zero = "Ainda não atingido" e faixa "abaixo da primeira faixa"', () => {
    const v = montarMinhaRv(copia({ rv_cents: 0, rv_bruta_cents: 0, indicadores: [ind({ pagamento_pct: 0, valor_cents: 0, projetado_pbp: 4000 })] }), U, FUSO);
    expect(v).toMatchObject({ estado: 'Ainda não atingido', tom: 'aviso' });
    if (v.tipo === 'ok') expect(v.linhas[0]!.faixa).toBe('Abaixo da primeira faixa: não paga');
  });
  it('RN-CORE-29: gatilho não atingido zera a RV, avisa e mostra quanto seria sem ele', () => {
    const v = montarMinhaRv(
      copia({ rv_cents: 0, rv_bruta_cents: 150_000, bloqueada_por: ['visitas'], indicadores: [ind({}), ind({ indicador: 'visitas', gatilho: true, gatilho_ok: false, meta: 100, realizado: 40, projetado_pbp: 4000, pagamento_pct: 0, valor_cents: 0 })] }),
      U,
      FUSO,
    );
    expect(v).toMatchObject({ estado: 'Ainda não atingido', aviso_gatilho: 'Gatilho de Visitas ainda não atingido: se o mês fechar assim, a RV zera.', explicacao_estado: null });
    if (v.tipo === 'ok') {
      expect(v.bruta).toContain('1.500');
      expect(v.linhas[1]).toMatchObject({ gatilho: true, gatilho_texto: 'Ainda não atingido: se o mês fechar assim, a RV zera', tom: 'aviso', valor: '', faixa: '' });
    }
  });
  it('RN-CORE-29: gatilho sem meta não bloqueia e indicador sem meta paga 0', () => {
    const v = montarMinhaRv(copia({ indicadores: [ind({ indicador: 'positivacao', meta: null, sem_meta: true, pagamento_pct: 0, valor_cents: 0 }), ind({ indicador: 'visitas', gatilho: true, gatilho_ok: null, sem_meta: true, meta: null })] }), U, FUSO);
    if (v.tipo !== 'ok') throw new Error('esperava ok');
    expect(v.linhas[0]).toMatchObject({ detalhe: 'Sem meta definida', atingimento: '—', faixa: 'Sem meta: não paga', progresso_pct: 0 });
    expect(v.linhas[1]!.gatilho_texto).toBe('Sem meta: não bloqueia a RV');
    expect(v.linhas[1]!.tom).toBe('neutro');
  });
  it('RN-CORE-29: mês aberto explica o chip; mês fechado com gatilho barrando diz "a RV está zerada"', () => {
    const aberto = montarMinhaRv(copia(), U, FUSO);
    if (aberto.tipo === 'ok') expect(aberto.explicacao_estado).toBe('Mantém a RV se o mês fechar assim');
    const zero = montarMinhaRv(copia({ rv_cents: 0, rv_bruta_cents: 0, indicadores: [ind({ pagamento_pct: 0, valor_cents: 0 })] }), U, FUSO);
    if (zero.tipo === 'ok') expect(zero.explicacao_estado).toBe('Se o mês fechar assim, a RV zera');
    const f = montarMinhaRv(copia({ rv_cents: 0, rv_bruta_cents: 5000, bloqueada_por: ['visitas'], indicadores: [ind({ indicador: 'visitas', gatilho: true, gatilho_ok: false })] }, { situacao: 'fechado' }), U, FUSO);
    if (f.tipo !== 'ok') throw new Error('esperava ok');
    expect(f.aviso_gatilho).toBe('Gatilho não atingido em Visitas: a RV está zerada.');
    expect(f.explicacao_estado).toBeNull();
    expect(f.linhas[0]!.gatilho_texto).toBe('Não atingido (RV zerada)');
  });
  it('RN-CORE-29: os textos do gatilho no app são os mesmos do BKO (textoDoGatilho)', () => {
    for (const ok of [true, false]) {
      for (const bloqueado of [true, false]) {
        expect(textoDoGatilhoRv(ok, bloqueado, true)).toBe(textoDoGatilho(ok, bloqueado, 'parcial'));
        expect(textoDoGatilhoRv(ok, bloqueado, false)).toBe(textoDoGatilho(ok, bloqueado, 'fechado'));
      }
    }
  });
  it('RN-CORE-29: atingimento acima de 100% mostra o percentual real e limita a barra em 100', () => {
    const v = montarMinhaRv(copia({ indicadores: [ind({ projetado_pbp: 12000 })] }), U, FUSO);
    if (v.tipo === 'ok') expect(v.linhas[0]).toMatchObject({ atingimento: '120,0% projetado', progresso_pct: 100 });
  });
  it('data do cálculo no fuso do tenant; data inválida não quebra', () => {
    expect(dataDoCalculo('2026-11-05T03:05:00Z', FUSO)).toBe('04/11 às 23:05');
    expect(dataDoCalculo('lixo', FUSO)).toBe('data desconhecida');
  });
});

describe('RN-CORE-23: Sincronizar do cartão Minha RV sem sinal', () => {
  it('RN-CORE-23: sem sinal devolve o aviso padrão do botão Sincronizar (não chama o motor); com sinal não há aviso', () => {
    expect(avisoAoSincronizarRv(true)).toBe('Desligue o modo sem sinal para sincronizar');
    expect(avisoAoSincronizarRv(false)).toBeNull();
  });
});

describe('RN-CORE-29: cópia da RV inválida no aparelho', () => {
  it('RN-CORE-29: cópia de outra versão ou corrompida vira sem cálculo, sem quebrar a tela', () => {
    for (const ruim of [undefined, null, 'x', {}, { recebido_em: 'a' }, { recebido_em: 'a', painel: { pessoas: 3 } }]) {
      expect(validarCopiaRv(ruim)).toBeNull();
      expect(montarMinhaRv(validarCopiaRv(ruim), U, FUSO).tipo).toBe('sem_calculo');
    }
  });
  it('RN-CORE-29: cópia válida passa intacta', () => {
    const c = copia();
    expect(validarCopiaRv(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
});
