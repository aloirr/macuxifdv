import { describe, expect, it } from 'vitest';
import { PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as PADRAO } from '../contracts';
import { NOME_REGRA_PRODUTIVIDADE } from '../contracts/alertas-produtividade';
import { parametrosAlertasDasLinhas, validarParadoMin, validarParametrosAlertasProdutividade } from './alertas-produtividade';
describe('RN-CORE-26 (D6): parâmetros dos alertas de produtividade', () => {
    it('RN-CORE-26: sem linha vale o padrão D6 (almoço 10 min, gestor +30, 10:00, 16:00, 120 min, 4 h, teto 4)', () => {
        const p = parametrosAlertasDasLinhas([]);
        expect(p).toEqual(PADRAO);
        expect(p.fim_almoco).toEqual({ ativa: true, antecedencia_min: 10, vendedor: true });
        expect(p.sem_checkin_inicio.ate_min).toBe(600);
        expect(p.rota_incompleta).toEqual({ ativa: true, as_min: 960, vendedor: true });
        expect(p.visita_aberta.apos_min).toBe(120);
        expect(p.envio_pendente.apos_h).toBe(4);
        expect(p.teto_lembretes_dia).toBe(4);
        expect(JSON.stringify(p)).not.toContain('parado_min');
    });
    it('RN-CORE-26: valor salvo vale; inválido ou apagado volta ao padrão e não altera o objeto do padrão', () => {
        const salvo = { ...PADRAO, teto_lembretes_dia: 2 };
        expect(parametrosAlertasDasLinhas([{ modulo: 'core', chave: 'alertas.produtividade', valor: salvo }]).teto_lembretes_dia).toBe(2);
        expect(parametrosAlertasDasLinhas([{ modulo: 'core', chave: 'alertas.produtividade', valor: { x: 1 } }])).toEqual(PADRAO);
        expect(parametrosAlertasDasLinhas([{ modulo: 'core', chave: 'alertas.produtividade', valor: salvo, deleted_at: 'x' }])).toEqual(PADRAO);
        const copia = parametrosAlertasDasLinhas([]);
        copia.teto_lembretes_dia = 9;
        expect(PADRAO.teto_lembretes_dia).toBe(4);
    });
    it('RN-CORE-26: as faixas são recusadas com a regra e o intervalo', () => {
        const r = validarParametrosAlertasProdutividade({ ...PADRAO, fim_almoco: { ...PADRAO.fim_almoco, antecedencia_min: 31 }, teto_lembretes_dia: 0 });
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.erros.map((e) => e.campo)).toEqual(['fim_almoco', 'teto_lembretes_dia']);
        expect(validarParametrosAlertasProdutividade(PADRAO).ok).toBe(true);
    });
    it('RN-CORE-26: o "parado" é inteiro de 15 a 480 min', () => {
        expect(validarParadoMin(60)).toEqual({ ok: true, valor: 60 });
        expect(validarParadoMin(14).ok).toBe(false);
        expect(validarParadoMin(481).ok).toBe(false);
        expect(validarParadoMin(30.5).ok).toBe(false);
    });
});
describe('RN-CORE-26 (spec §1.3): nomes das regras', () => {
    it('RN-CORE-26: os seis nomes são os da spec e as mensagens de faixa usam o mesmo nome', () => {
        expect(Object.values(NOME_REGRA_PRODUTIVIDADE)).toEqual(['Fim do almoço', 'Parado entre visitas', 'Sem check-in no início do dia', 'Rota do dia incompleta', 'Visita aberta', 'Envio pendente']);
        const r = validarParametrosAlertasProdutividade({ ...PADRAO, visita_aberta: { ...PADRAO.visita_aberta, apos_min: 5 } });
        expect(r.ok ? [] : r.erros.map((e) => e.mensagem)).toEqual([expect.stringContaining('Visita aberta:')]);
    });
});
