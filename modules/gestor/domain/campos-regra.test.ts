import { describe, expect, it } from 'vitest';
import { REGRAS_PADRAO } from './alertas';
import { CAMPOS_REGRA, FRASE_REGRA, montarSalvamento, regrasVisiveis, validarCampo } from './campos-regra';
import { TIPOS_REGRA_EQUIPE } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

const parametros = {
  pct_tolerancia_frequencia: PARAMETROS_PADRAO.pct_tolerancia_frequencia,
  dias_sem_visita_padrao: PARAMETROS_PADRAO.dias_sem_visita_padrao,
  dias_carencia_cliente_novo: PARAMETROS_PADRAO.dias_carencia_cliente_novo,
  prazo_aprovacao_dias_uteis: PARAMETROS_PADRAO.prazo_aprovacao_dias_uteis,
};

describe('Parâmetros › Alertas: campos de cada regra (T-0180)', () => {
  it('RN-GES-01: Cliente sem visita mostra tolerância, sem frequência e carência, com o padrão do tenant', () => {
    const c = CAMPOS_REGRA.cliente_sem_visita;
    expect(c.map((x) => x.id)).toEqual(['pct_tolerancia_frequencia', 'dias_sem_visita_padrao', 'dias_carencia_cliente_novo']);
    expect(c.map((x) => x.padrao)).toEqual([50, 30, 15]);
    expect(c.every((x) => x.origem.tipo === 'parametro')).toBe(true);
  });

  it('RN-GES-03: Pedido parado na aprovação edita o prazo em dias úteis, o mesmo parâmetro da fila', () => {
    const [c] = CAMPOS_REGRA.pedido_aguardando_aprovacao;
    expect(c).toMatchObject({ origem: { tipo: 'parametro', chave: 'prazo_aprovacao_dias_uteis' }, padrao: 1, unidade: 'dias úteis' });
  });

  it('RN-PRO-07: Visita curta mostra só o que é do gestor (a janela); a permanência mínima é do Promotor', () => {
    expect(CAMPOS_REGRA.visita_curta).toHaveLength(1);
    expect(CAMPOS_REGRA.visita_curta[0]).toMatchObject({ origem: { tipo: 'regra', campo: 'janela_dias' }, padrao: 3, rotulo: 'Nos últimos', unidade: 'dias' });
  });

  it('todo campo vem com o padrão da regra ou do tenant e toda regra tem frase curta', () => {
    for (const t of TIPOS_REGRA_EQUIPE) {
      expect(FRASE_REGRA[t].length).toBeGreaterThan(10);
      for (const c of CAMPOS_REGRA[t]) {
        const esperado = c.origem.tipo === 'parametro' ? parametros[c.origem.chave] : REGRAS_PADRAO[t][c.origem.campo];
        expect(c.padrao, `${t}.${c.id}`).toBe(esperado);
      }
    }
  });

  it('RN-CORE-03: sem o Promotor somem as 3 regras de trade; sem o Vendedor, ritmo e aprovação', () => {
    expect(regrasVisiveis(new Set(['core', 'vendedor']))).toEqual(['cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao']);
    expect(regrasVisiveis(new Set(['core', 'promotor']))).toEqual(['cliente_sem_visita', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps']);
  });

  it('valida faixa e inteiro com mensagem em português e a ação seguinte', () => {
    const pct = CAMPOS_REGRA.cliente_sem_visita[0]!;
    expect(validarCampo(pct, 50)).toBeNull();
    expect(validarCampo(pct, null)).toBe('Informe um número.');
    expect(validarCampo(pct, 1.5)).toBe('Use um número inteiro.');
    expect(validarCampo(pct, 900)).toBe('Use um valor de 0 a 500.');
  });

  it('RN-GES-01: salvar separa o que é da regra do que é parâmetro do tenant e só envia o que mudou', () => {
    const r = montarSalvamento(
      'cliente_sem_visita',
      { ativa: true, severidade: 'atencao', valores: { pct_tolerancia_frequencia: 60, dias_sem_visita_padrao: 30, dias_carencia_cliente_novo: 15 } },
      { regra: REGRAS_PADRAO.cliente_sem_visita, parametros },
    );
    expect(r).toEqual({ ok: true, ajusteRegra: null, parametros: { ...parametros, pct_tolerancia_frequencia: 60 } });
  });

  it('salvar liga/desliga, severidade e campo da regra envia só o ajuste da regra e não toca nos parâmetros', () => {
    const r = montarSalvamento(
      'ritmo_abaixo_meta',
      { ativa: false, severidade: 'critica', valores: { limiar: 85, amostra_min: 3 } },
      { regra: REGRAS_PADRAO.ritmo_abaixo_meta, parametros },
    );
    expect(r).toEqual({ ok: true, ajusteRegra: { ativa: false, severidade: 'critica', limiar: 85 }, parametros: null });
  });

  it('salvar com valor fora da faixa devolve o erro do campo e não envia nada', () => {
    const r = montarSalvamento('ritmo_abaixo_meta', { ativa: true, severidade: 'atencao', valores: { limiar: 150, amostra_min: 3 } }, { regra: REGRAS_PADRAO.ritmo_abaixo_meta, parametros });
    expect(r).toEqual({ ok: false, erros: { limiar: 'Use um valor de 1 a 100.' } });
  });
});
