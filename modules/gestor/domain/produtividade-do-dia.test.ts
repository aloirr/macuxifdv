import { describe, expect, it } from 'vitest';
import {
  CAMPOS_PRODUTIVIDADE,
  FRASE_PRODUTIVIDADE,
  montarSalvamentoProdutividade,
  montarSalvamentoTeto,
  PARADO_MIN_PADRAO_CORE,
  PARAMETROS_PRODUTIVIDADE_PADRAO,
  REGRAS_PRODUTIVIDADE,
  validarHora,
} from './produtividade-do-dia';

const atual = { parametros: PARAMETROS_PRODUTIVIDADE_PADRAO, paradoMin: PARADO_MIN_PADRAO_CORE };

describe('Parâmetros › Alertas › Produtividade do dia (T-0180, D1 e D6)', () => {
  it('D6: os padrões são almoço 10 min antes, gestor 30 min depois, 10:00, 16:00, 120 min, 4 h e teto 4', () => {
    const r = PARAMETROS_PRODUTIVIDADE_PADRAO.regras;
    expect(r.fim_almoco.aviso_antes_min).toBe(10);
    expect(r.parado_entre_visitas.gestor_depois_min).toBe(30);
    expect(r.sem_checkin_inicio.ate).toBe('10:00');
    expect(r.rota_incompleta.lembrete_as).toBe('16:00');
    expect(r.visita_aberta.depois_min).toBe(120);
    expect(r.envio_pendente.depois_horas).toBe(4);
    expect(PARAMETROS_PRODUTIVIDADE_PADRAO.teto_lembretes_dia).toBe(4);
    expect(PARADO_MIN_PADRAO_CORE).toBe(60);
    for (const k of REGRAS_PRODUTIVIDADE) expect(r[k].ativa).toBe(true);
  });

  it('RN-VEN-42: todo campo vem preenchido e cada regra tem frase curta', () => {
    for (const k of REGRAS_PRODUTIVIDADE) {
      expect(FRASE_PRODUTIVIDADE[k].length).toBeGreaterThan(10);
      expect(CAMPOS_PRODUTIVIDADE[k].length).toBeGreaterThan(0);
      for (const c of CAMPOS_PRODUTIVIDADE[k]) expect(c.padrao, `${k}.${c.id}`).not.toBeNull();
    }
  });

  it('D1/RN-CORE-26: o "parado" de 60 min é o campo inicio.parado_min do core, faixa 15 a 480', () => {
    const c = CAMPOS_PRODUTIVIDADE.parado_entre_visitas.find((x) => x.origem === 'core_parado_min')!;
    expect(c).toMatchObject({ rotulo: 'Depois de', unidade: 'min', min: 15, max: 480, padrao: 60 });
  });

  it('destinos só nas regras que têm dois: Parado e Sem check-in; as outras não mostram Vendedor/Gestor', () => {
    const comDestinos = REGRAS_PRODUTIVIDADE.filter((k) => 'vendedor' in PARAMETROS_PRODUTIVIDADE_PADRAO.regras[k]);
    expect(comDestinos).toEqual(['parado_entre_visitas', 'sem_checkin_inicio']);
  });

  it('D1: salvar o Parado grava o parado_min no core e a regra no parâmetro de produtividade, só o que mudou', () => {
    const r = montarSalvamentoProdutividade('parado_entre_visitas', { ativa: true, destinos: { vendedor: true, gestor: true }, valores: { parado_min: 45, gestor_depois_min: 30 } }, atual);
    expect(r).toEqual({ ok: true, parametros: null, paradoMin: 45 });
  });

  it('D1: o Parado desligado continua editável e salvar mantém a regra desligada', () => {
    const r = montarSalvamentoProdutividade('parado_entre_visitas', { ativa: false, destinos: { vendedor: true, gestor: true }, valores: { parado_min: 90, gestor_depois_min: 30 } }, atual);
    expect(r).toMatchObject({ ok: true, paradoMin: 90 });
    if (r.ok) expect(r.parametros?.regras.parado_entre_visitas.ativa).toBe(false);
  });

  it('RN-GES-03: destino desligado do gestor grava no parâmetro de produtividade, sem mexer nas outras regras', () => {
    const r = montarSalvamentoProdutividade('sem_checkin_inicio', { ativa: true, destinos: { vendedor: true, gestor: false }, valores: { ate: '09:30' } }, atual);
    expect(r).toMatchObject({ ok: true, paradoMin: null });
    if (r.ok) {
      expect(r.parametros?.regras.sem_checkin_inicio).toEqual({ ativa: true, vendedor: true, gestor: false, ate: '09:30' });
      expect(r.parametros?.regras.visita_aberta).toEqual(PARAMETROS_PRODUTIVIDADE_PADRAO.regras.visita_aberta);
    }
  });

  it('valor fora da faixa ou hora inválida devolve erro do campo em português e não envia nada', () => {
    expect(montarSalvamentoProdutividade('visita_aberta', { ativa: true, destinos: {}, valores: { depois_min: 5 } }, atual)).toEqual({ ok: false, erros: { depois_min: 'Use um valor de 30 a 480.' } });
    expect(montarSalvamentoProdutividade('sem_checkin_inicio', { ativa: true, destinos: { vendedor: true, gestor: true }, valores: { ate: '25:00' } }, atual)).toEqual({ ok: false, erros: { ate: 'Use o horário no formato HH:MM, por exemplo 10:00.' } });
    expect(validarHora('10:00')).toBeNull();
  });

  it('teto de lembretes: 1 a 10 por pessoa por dia', () => {
    expect(montarSalvamentoTeto(3, atual)).toMatchObject({ ok: true, parametros: { teto_lembretes_dia: 3 } });
    expect(montarSalvamentoTeto(4, atual)).toEqual({ ok: true, parametros: null });
    expect(montarSalvamentoTeto(0, atual)).toEqual({ ok: false, erros: { teto: 'Use um valor de 1 a 10.' } });
  });
});
