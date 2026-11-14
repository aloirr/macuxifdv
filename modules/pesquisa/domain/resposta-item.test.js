import { describe, expect, it } from 'vitest';
import { avisarItem, codigoDeBarrasValido, dimensoesDaFoto, gs1Confere, itemRespondido, validarItem } from './resposta-item';
import { codigo, data, escala, foto, item, multipla, numero, sim_nao, texto, u, unica } from './util-teste';
const codigos = (es) => es.map((e) => e.codigo);
describe('RF-PES-01: validação da resposta por tipo', () => {
    it('RF-PES-01: sim/não aceita o booleano', () => {
        expect(validarItem(sim_nao(1), item.simNao(1, true))).toEqual([]);
        expect(validarItem(sim_nao(1), item.simNao(1, false))).toEqual([]);
    });
    it('RF-PES-01: item de outro tipo que a pergunta é recusado (TIPO_DIFERENTE)', () => {
        const e = validarItem(sim_nao(1), item.texto(1, 'oi'));
        expect(codigos(e)).toEqual(['TIPO_DIFERENTE']);
        expect(e[0].mensagem).toMatch(/sim ou não/i);
    });
    it('RF-PES-01: item de outra pergunta é recusado', () => {
        expect(codigos(validarItem(sim_nao(1), item.simNao(2, true)))).toEqual(['PERGUNTA_DESCONHECIDA']);
    });
    it('RF-PES-01: única escolha só aceita opção da própria pergunta', () => {
        const p = unica(1, [101, 102]);
        expect(validarItem(p, item.unica(1, 102))).toEqual([]);
        expect(codigos(validarItem(p, item.unica(1, 999)))).toEqual(['OPCAO_INVALIDA']);
    });
    it('RF-PES-01: múltipla escolha — opções válidas, sem repetir, padrão de 1 até todas', () => {
        const p = multipla(1, [201, 202, 203]);
        expect(validarItem(p, item.multipla(1, [201, 203]))).toEqual([]);
        expect(codigos(validarItem(p, item.multipla(1, [201, 999])))).toEqual(['OPCAO_INVALIDA']);
        expect(codigos(validarItem(p, item.multipla(1, [201, 201])))).toEqual(['OPCAO_REPETIDA']);
    });
    it('RF-PES-01: múltipla escolha respeita min_selecoes e max_selecoes', () => {
        const p = multipla(1, [201, 202, 203], { min_selecoes: 2, max_selecoes: 2 });
        expect(codigos(validarItem(p, item.multipla(1, [201])))).toEqual(['SELECOES_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.multipla(1, [201, 202, 203])))).toEqual(['SELECOES_FORA_DO_LIMITE']);
        expect(validarItem(p, item.multipla(1, [201, 202]))).toEqual([]);
        expect(validarItem(p, item.multipla(1, [203, 202]))).toEqual([]);
    });
    it('RF-PES-01: número respeita mínimo, máximo (inclusivos) e inteiro', () => {
        const p = numero(1, { minimo: 0, maximo: 100 });
        expect(validarItem(p, item.numero(1, 0))).toEqual([]);
        expect(validarItem(p, item.numero(1, 100))).toEqual([]);
        expect(codigos(validarItem(p, item.numero(1, -0.01)))).toEqual(['VALOR_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.numero(1, 100.5)))).toEqual(['VALOR_FORA_DO_LIMITE']);
        const q = numero(2, { inteiro: true });
        expect(codigos(validarItem(q, item.numero(2, 3.5)))).toEqual(['VALOR_INVALIDO']);
        expect(validarItem(q, item.numero(2, 3))).toEqual([]);
        expect(codigos(validarItem(q, item.numero(2, Number.NaN)))).toEqual(['VALOR_INVALIDO']);
    });
    it('RF-PES-01: texto respeita mínimo e máximo de caracteres (padrão do tenant: 2000)', () => {
        const p = texto(1, { min_caracteres: 3, max_caracteres: 10 });
        expect(validarItem(p, item.texto(1, 'abc'))).toEqual([]);
        expect(codigos(validarItem(p, item.texto(1, 'ab')))).toEqual(['TEXTO_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.texto(1, 'x'.repeat(11))))).toEqual(['TEXTO_FORA_DO_LIMITE']);
        expect(validarItem(texto(2), item.texto(2, 'x'.repeat(2000)))).toEqual([]);
        expect(codigos(validarItem(texto(2), item.texto(2, 'x'.repeat(2001))))).toEqual(['TEXTO_FORA_DO_LIMITE']);
    });
    it('RF-PES-01: escala aceita só inteiros de mínimo a máximo', () => {
        const p = escala(1, { minimo: 1, maximo: 5 });
        expect(validarItem(p, item.escala(1, 1))).toEqual([]);
        expect(validarItem(p, item.escala(1, 5))).toEqual([]);
        expect(codigos(validarItem(p, item.escala(1, 0)))).toEqual(['VALOR_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.escala(1, 6)))).toEqual(['VALOR_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.escala(1, 2.5)))).toEqual(['VALOR_INVALIDO']);
    });
    it('RF-PES-01: data precisa existir no calendário e respeitar mínima/máxima', () => {
        const p = data(1, { minima: '2026-01-01', maxima: '2026-12-31' });
        expect(validarItem(p, item.data(1, '2026-10-31'))).toEqual([]);
        expect(codigos(validarItem(p, item.data(1, '2026-02-30')))).toEqual(['VALOR_INVALIDO']);
        expect(codigos(validarItem(p, item.data(1, '2025-12-31')))).toEqual(['VALOR_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.data(1, '2027-01-01')))).toEqual(['VALOR_FORA_DO_LIMITE']);
    });
    it('RF-PES-01: foto exige referência, respeita a quantidade e não repete foto', () => {
        const p = foto(1, { min_fotos: 1, max_fotos: 2 });
        expect(validarItem(p, item.foto(1, [10]))).toEqual([]);
        expect(codigos(validarItem(p, item.foto(1, [10, 11, 12])))).toEqual(['FOTOS_FORA_DO_LIMITE']);
        expect(codigos(validarItem(p, item.foto(1, [10, 10])))).toEqual(['FOTO_REPETIDA']);
        const semRef = { pergunta_id: u(1), tipo: 'foto', fotos: [{ id: u(10), referencia: '  ', capturada_em: '2026-10-31T13:00:00Z' }] };
        expect(codigos(validarItem(p, semRef))).toEqual(['FOTO_SEM_REFERENCIA']);
    });
    it('RN-PES-07: máximo de fotos do tenant (10) limita o configurado na pergunta', () => {
        const p = foto(1, { min_fotos: 1, max_fotos: 20 });
        expect(codigos(validarItem(p, item.foto(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])))).toEqual(['FOTOS_FORA_DO_LIMITE']);
    });
    it('RN-PES-06: código de barras com dígito GS1 inválido gera AVISO, não bloqueio', () => {
        expect(validarItem(codigo(1), item.codigo(1, '4006381333931'))).toEqual([]);
        expect(avisarItem(codigo(1), item.codigo(1, '4006381333931'))).toEqual([]);
        expect(validarItem(codigo(1), item.codigo(1, '4006381333932'))).toEqual([]);
        expect(avisarItem(codigo(1), item.codigo(1, '4006381333932')).map((a) => a.codigo)).toEqual(['CODIGO_GS1_INVALIDO']);
    });
    it('RN-PES-06: código fora do formato (curto ou com espaço) continua sendo erro', () => {
        expect(codigos(validarItem(codigo(1), item.codigo(1, 'AB')))).toEqual(['CODIGO_INVALIDO']);
    });
    it('RN-PES-06: foto com maior lado acima de 1600 px é recusada; até 1600 passa', () => {
        const p = foto(1);
        const com = (largura_px, altura_px) => ({ pergunta_id: u(1), tipo: 'foto', fotos: [{ id: u(10), referencia: 'f.jpg', capturada_em: '2026-10-31T13:00:00Z', largura_px, altura_px }] });
        expect(validarItem(p, com(1600, 1200))).toEqual([]);
        expect(codigos(validarItem(p, com(1200, 1601)))).toEqual(['FOTO_GRANDE_DEMAIS']);
    });
    it('RN-PES-06: dimensoesDaFoto reduz o maior lado para 1600 mantendo a proporção e não amplia', () => {
        expect(dimensoesDaFoto(4000, 3000, 1600)).toEqual({ largura: 1600, altura: 1200 });
        expect(dimensoesDaFoto(3000, 4000, 1600)).toEqual({ largura: 1200, altura: 1600 });
        expect(dimensoesDaFoto(800, 600, 1600)).toEqual({ largura: 800, altura: 600 });
    });
});
describe('RN-PES-06: código de barras', () => {
    it('RN-PES-06: EAN-8, UPC-A (12), EAN-13 e DUN-14 têm o dígito GS1 conferido (gs1Confere)', () => {
        expect(gs1Confere('96385074')).toBe(true);
        expect(gs1Confere('96385075')).toBe(false);
        expect(gs1Confere('036000291452')).toBe(true);
        expect(gs1Confere('036000291453')).toBe(false);
        expect(gs1Confere('4006381333931')).toBe(true);
        expect(gs1Confere('14006381333938')).toBe(true);
        expect(gs1Confere('LOJA-0042')).toBe(true);
    });
    it('código que não é EAN (ex.: Code 128 interno) vale se tiver de 3 a 48 caracteres sem espaço', () => {
        expect(codigoDeBarrasValido('LOJA-0042')).toBe(true);
        expect(codigoDeBarrasValido('AB')).toBe(false);
        expect(codigoDeBarrasValido('tem espaço')).toBe(false);
    });
});
describe('RF-PES-04: item em branco conta como não respondido', () => {
    it('texto só com espaços, múltipla sem opção e foto sem arquivo não são resposta', () => {
        expect(itemRespondido(item.texto(1, '   '))).toBe(false);
        expect(itemRespondido(item.multipla(1, []))).toBe(false);
        expect(itemRespondido(item.foto(1, []))).toBe(false);
        expect(itemRespondido(item.texto(1, 'ok'))).toBe(true);
        expect(itemRespondido(item.simNao(1, false))).toBe(true);
        expect(itemRespondido(item.numero(1, 0))).toBe(true);
    });
});
