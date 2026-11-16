import { describe, expect, it } from 'vitest';
import { CHAVES_REGRA_PRODUTIVIDADE, NOME_REGRA_PRODUTIVIDADE, FAIXAS_ALERTAS_PRODUTIVIDADE, PARADO_MIN_PADRAO, PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, ParametrosAlertasProdutividadeSchema } from '@macuxi/core/contracts';
import { CAMPOS_PRODUTIVIDADE, FRASE_PRODUTIVIDADE, montarSalvamentoProdutividade, montarSalvamentoTeto, REGRAS_COM_DESTINOS } from './produtividade-do-dia';
import { minutoDoTextoHora, textoDoMinuto } from '@macuxi/core/contracts';

const atual = { parametros: PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, paradoMin: PARADO_MIN_PADRAO };
const campo = (k: (typeof CHAVES_REGRA_PRODUTIVIDADE)[number], id: string) => CAMPOS_PRODUTIVIDADE[k].find((c) => c.id === id)!;

describe('Parâmetros › Alertas › Produtividade do dia (T-0180, D1 e D6): o formato é o do Core', () => {
  it('D6: todo campo da tela existe no contrato do Core, com o padrão e a faixa dele (sem espelho local)', () => {
    for (const k of CHAVES_REGRA_PRODUTIVIDADE) {
      for (const c of CAMPOS_PRODUTIVIDADE[k]) {
        if (c.origem === 'core_parado_min') continue;
        expect(PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO[k], `${k}.${c.id}`).toHaveProperty(c.id, c.padrao);
      }
    }
    const f = FAIXAS_ALERTAS_PRODUTIVIDADE;
    expect([campo('fim_almoco', 'antecedencia_min').min, campo('fim_almoco', 'antecedencia_min').max]).toEqual([f.antecedencia_min.min, f.antecedencia_min.max]);
    expect([campo('parado_entre_visitas', 'gestor_depois_min').min, campo('parado_entre_visitas', 'gestor_depois_min').max]).toEqual([5, 240]);
    expect([campo('envio_pendente', 'apos_h').min, campo('envio_pendente', 'apos_h').max]).toEqual([1, 48]);
    expect([campo('visita_aberta', 'apos_min').min, campo('visita_aberta', 'apos_min').max]).toEqual([30, 480]);
    expect(campo('sem_checkin_inicio', 'ate_min').padrao).toBe(600);
    expect(campo('rota_incompleta', 'as_min').padrao).toBe(960);
  });

  it('RN-VEN-42: nome e frase de cada regra são os da spec final, sem número nem horário', () => {
    expect(CHAVES_REGRA_PRODUTIVIDADE.map((k) => [NOME_REGRA_PRODUTIVIDADE[k], FRASE_PRODUTIVIDADE[k]])).toEqual([
      ['Fim do almoço', 'Lembra a volta do almoço.'],
      ['Parado entre visitas', 'Avisa quando passa do tempo sem check-in.'],
      ['Sem check-in no início do dia', 'Avisa quem não fez check-in até o horário.'],
      ['Rota do dia incompleta', 'Lembra os clientes da rota que faltam.'],
      ['Visita aberta', 'Lembra o checkout da visita que ficou aberta.'],
      ['Envio pendente', 'Lembra os registros sem enviar.'],
    ]);
  });

  it('D1/RN-CORE-26: o "parado" de 60 min é o campo inicio.parado_min do core, faixa 15 a 480', () => {
    const c = CAMPOS_PRODUTIVIDADE.parado_entre_visitas.find((x) => x.origem === 'core_parado_min')!;
    expect(c).toMatchObject({ id: 'parado_min', rotulo: 'Depois de', unidade: 'min', min: 15, max: 480, padrao: 60 });
  });

  it('destinos só nas regras que têm dois: Parado e Sem check-in', () => {
    const comDestinos = CHAVES_REGRA_PRODUTIVIDADE.filter((k) => 'vendedor' in PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO[k] && 'gestor' in PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO[k]);
    expect([...REGRAS_COM_DESTINOS]).toEqual(comDestinos);
  });

  it('D1: salvar o Parado grava o parado_min no core e não toca o parâmetro de produtividade quando nada dele mudou', () => {
    const r = montarSalvamentoProdutividade('parado_entre_visitas', { ativa: true, destinos: { vendedor: true, gestor: true }, valores: { parado_min: 45, gestor_depois_min: 30 } }, atual);
    expect(r).toEqual({ ok: true, parametros: null, paradoMin: 45 });
  });

  it('D1: o Parado desligado continua editável e o parâmetro sai no formato que o PUT do Core aceita', () => {
    const r = montarSalvamentoProdutividade('parado_entre_visitas', { ativa: false, destinos: { vendedor: true, gestor: true }, valores: { parado_min: 90, gestor_depois_min: 30 } }, atual);
    expect(r).toMatchObject({ ok: true, paradoMin: 90 });
    if (!r.ok || !r.parametros) throw new Error('esperava parâmetro');
    expect(r.parametros.parado_entre_visitas.ativa).toBe(false);
    expect(ParametrosAlertasProdutividadeSchema.safeParse(r.parametros).success).toBe(true);
  });

  it('RN-GES-03: horário "09:30" vira minuto do dia (ate_min); destino desligado do gestor grava só essa regra', () => {
    const r = montarSalvamentoProdutividade('sem_checkin_inicio', { ativa: true, destinos: { vendedor: true, gestor: false }, valores: { ate_min: '09:30' } }, atual);
    expect(r).toMatchObject({ ok: true, paradoMin: null });
    if (!r.ok || !r.parametros) throw new Error('esperava parâmetro');
    expect(r.parametros.sem_checkin_inicio).toEqual({ ativa: true, vendedor: true, gestor: false, ate_min: 570 });
    expect(r.parametros.visita_aberta).toEqual(PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO.visita_aberta);
    expect(ParametrosAlertasProdutividadeSchema.safeParse(r.parametros).success).toBe(true);
  });

  it('valor fora da faixa do Core ou hora inválida devolve erro do campo em português e não envia nada', () => {
    expect(montarSalvamentoProdutividade('visita_aberta', { ativa: true, destinos: {}, valores: { apos_min: 5 } }, atual)).toEqual({ ok: false, erros: { apos_min: 'Use um valor de 30 a 480.' } });
    expect(montarSalvamentoProdutividade('envio_pendente', { ativa: true, destinos: {}, valores: { apos_h: 49 } }, atual)).toEqual({ ok: false, erros: { apos_h: 'Use um valor de 1 a 48.' } });
    expect(montarSalvamentoProdutividade('sem_checkin_inicio', { ativa: true, destinos: { vendedor: true, gestor: true }, valores: { ate_min: '25:00' } }, atual)).toEqual({ ok: false, erros: { ate_min: 'Use o horário em hh:mm.' } });
  });

  it('teto de lembretes: a faixa é a do Core (1 a 10 por pessoa por dia)', () => {
    expect(montarSalvamentoTeto(3, atual)).toMatchObject({ ok: true, parametros: { teto_lembretes_dia: 3 } });
    expect(montarSalvamentoTeto(4, atual)).toEqual({ ok: true, parametros: null });
    expect(montarSalvamentoTeto(0, atual)).toEqual({ ok: false, erros: { teto: 'Use um valor de 1 a 10.' } });
  });

  it('horário do dia: HH:MM ida e volta; fora de 00:00 a 23:59 é inválido', () => {
    expect(minutoDoTextoHora('10:00')).toBe(600);
    expect(minutoDoTextoHora('7:05')).toBe(425);
    expect(minutoDoTextoHora('24:00')).toBeNull();
    expect(textoDoMinuto(960)).toBe('16:00');
  });
});
