import { describe, expect, it } from 'vitest';
import { FAIXA_META_PRODUTIVIDADE, INDICADORES_PRODUTIVIDADE, MetasProdutividadePutSchema, } from '../../contracts/performance';
import { metaProdutividadeVigente, metasPadrao, metasProdutividadeVigentes, validarMetaProdutividade, } from './metas-produtividade';
// Árvore: Norte (raiz) → Norte-1 → Norte-1A. O vendedor V está na Norte-1A.
const [NORTE, NORTE1, NORTE1A, SUL] = ['e-norte', 'e-norte-1', 'e-norte-1a', 'e-sul'];
const EQUIPES = [
    { id: NORTE, equipe_pai_id: null },
    { id: NORTE1, equipe_pai_id: NORTE },
    { id: NORTE1A, equipe_pai_id: NORTE1 },
    { id: SUL, equipe_pai_id: null },
];
const V = 'u-vendedor';
const tenant = (indicador, valor, vigencia_inicio = '2026-01', deleted_at = null) => ({
    escopo: 'tenant',
    equipe_id: null,
    usuario_id: null,
    indicador,
    valor,
    vigencia_inicio,
    deleted_at,
});
const equipe = (equipe_id, indicador, valor, vigencia_inicio = '2026-01') => ({ ...tenant(indicador, valor, vigencia_inicio), escopo: 'equipe', equipe_id });
const usuario = (usuario_id, indicador, valor, vigencia_inicio = '2026-01') => ({
    ...tenant(indicador, valor, vigencia_inicio),
    escopo: 'usuario',
    usuario_id,
});
const vigenteDeV = (linhas, indicador = 'tma', mes = '2026-11') => metaProdutividadeVigente({
    linhas,
    equipes: EQUIPES,
    alvo: { usuario_id: V, equipe_id: NORTE1A },
    indicador,
    mes,
});
describe('RN-CORE-45: qual meta vale (metaProdutividadeVigente, §6.2)', () => {
    it('RN-CORE-45 (D5): sem cadastro, as 12 vêm do padrão do FDV', () => {
        const r = metasProdutividadeVigentes({
            linhas: [],
            equipes: EQUIPES,
            alvo: { usuario_id: V, equipe_id: NORTE1A },
            mes: '2026-11',
        });
        expect(r).toEqual(metasPadrao());
        expect(r.primeiro_checkin).toEqual({ valor: 480, origem: 'padrao_fdv' });
        expect(Object.keys(r)).toEqual([...INDICADORES_PRODUTIVIDADE]);
    });
    it('RN-CORE-45: tenant vence o padrão', () => {
        expect(vigenteDeV([tenant('tma', 35)])).toEqual({ valor: 35, origem: 'tenant' });
    });
    it('RN-CORE-45: a equipe vence o tenant, e a mais próxima subindo a árvore vence as de cima', () => {
        expect(vigenteDeV([tenant('tma', 35), equipe(NORTE, 'tma', 33)])).toEqual({
            valor: 33,
            origem: 'equipe',
        });
        expect(vigenteDeV([tenant('tma', 35), equipe(NORTE, 'tma', 33), equipe(NORTE1, 'tma', 31)])).toEqual({
            valor: 31,
            origem: 'equipe',
        });
        expect(vigenteDeV([equipe(SUL, 'tma', 20)])).toEqual({ valor: 30, origem: 'padrao_fdv' }); // equipe de outro ramo não vale
    });
    it('RN-CORE-45: o usuário vence a equipe; a meta de outro usuário não vale', () => {
        expect(vigenteDeV([equipe(NORTE1A, 'tma', 31), usuario(V, 'tma', 28)])).toEqual({
            valor: 28,
            origem: 'usuario',
        });
        expect(vigenteDeV([usuario('outro', 'tma', 10)])).toEqual({ valor: 30, origem: 'padrao_fdv' });
    });
    it('RN-CORE-45: em cada nível vale a linha de maior vigência até o mês; a do mês seguinte ainda não vale', () => {
        const l = [tenant('tma', 40, '2026-09'), tenant('tma', 35, '2026-11'), tenant('tma', 25, '2026-12')];
        expect(vigenteDeV(l, 'tma', '2026-10')).toEqual({ valor: 40, origem: 'tenant' }); // o mês passado continua com a meta que valia
        expect(vigenteDeV(l, 'tma', '2026-11')).toEqual({ valor: 35, origem: 'tenant' });
        expect(vigenteDeV(l, 'tma', '2026-12')).toEqual({ valor: 25, origem: 'tenant' });
        expect(vigenteDeV(l, 'tma', '2026-08')).toEqual({ valor: 30, origem: 'padrao_fdv' });
    });
    it('RN-CORE-45: "voltar a herdar" (linha removida) passa a valer o nível de cima', () => {
        const removida = { ...usuario(V, 'tma', 28), deleted_at: '2026-11-10T12:00:00Z' };
        expect(vigenteDeV([equipe(NORTE1, 'tma', 31), removida])).toEqual({ valor: 31, origem: 'equipe' });
    });
    it('RN-CORE-45: cada indicador resolve no seu nível', () => {
        const r = metasProdutividadeVigentes({
            linhas: [tenant('tma', 35), usuario(V, 'raio_checkin', 80)],
            equipes: EQUIPES,
            alvo: { usuario_id: V, equipe_id: NORTE1A },
            mes: '2026-11',
        });
        expect([r.tma.origem, r.raio_checkin.origem, r.tmd.origem]).toEqual(['tenant', 'usuario', 'padrao_fdv']);
    });
    it('RN-CORE-45: ciclo na árvore de equipes não trava a subida', () => {
        const ciclo = [
            { id: 'a', equipe_pai_id: 'b' },
            { id: 'b', equipe_pai_id: 'a' },
        ];
        const r = metaProdutividadeVigente({
            linhas: [tenant('tma', 35)],
            equipes: ciclo,
            alvo: { usuario_id: V, equipe_id: 'a' },
            indicador: 'tma',
            mes: '2026-11',
        });
        expect(r).toEqual({ valor: 35, origem: 'tenant' });
    });
    it('RN-CORE-45: usuário sem equipe: usuário > tenant > padrão', () => {
        const r = metaProdutividadeVigente({
            linhas: [equipe(NORTE, 'tma', 33), tenant('tma', 35)],
            equipes: EQUIPES,
            alvo: { usuario_id: V, equipe_id: null },
            indicador: 'tma',
            mes: '2026-11',
        });
        expect(r).toEqual({ valor: 35, origem: 'tenant' });
    });
});
describe('RN-CORE-45: validação da edição no BKO (validarMetaProdutividade, §6.4)', () => {
    const edicao = (e = {}) => ({
        escopo: 'tenant',
        equipe_id: null,
        usuario_id: null,
        vigencia_inicio: '2026-11',
        metas: [{ indicador: 'tma', valor: 30 }],
        ...e,
    });
    const validar = (e = {}, linhas = []) => validarMetaProdutividade({
        edicao: edicao(e),
        mes_hoje: '2026-11',
        linhas,
        equipes: EQUIPES,
        equipe_do_usuario: NORTE1A,
    });
    const erros = (r) => (r.ok ? [] : r.erros);
    it('RN-CORE-45: edição válida passa', () => {
        expect(validar()).toEqual({ ok: true });
        expect(validar({ escopo: 'equipe', equipe_id: NORTE })).toEqual({ ok: true });
        expect(validar({ escopo: 'usuario', usuario_id: V, vigencia_inicio: '2027-01' })).toEqual({ ok: true });
    });
    it('RN-CORE-45: os dois extremos da faixa de cada indicador entram; um a mais ou a menos fica fora', () => {
        // Nos check-ins, o par vai junto para a ordem (último ≥ 1º) não interferir; ela tem testes próprios.
        const com = (indicador, valor) => indicador === 'primeiro_checkin'
            ? [
                { indicador, valor },
                { indicador: 'ultimo_checkin', valor: 1439 },
            ]
            : indicador === 'ultimo_checkin'
                ? [
                    { indicador: 'primeiro_checkin', valor: 0 },
                    { indicador, valor },
                ]
                : [{ indicador, valor }];
        for (const i of INDICADORES_PRODUTIVIDADE) {
            const [min, max] = FAIXA_META_PRODUTIVIDADE[i];
            expect(validar({ metas: com(i, max) }).ok, `${i} máx`).toBe(true);
            expect(validar({ metas: com(i, min) }).ok, `${i} mín`).toBe(true);
            expect(erros(validar({ metas: [{ indicador: i, valor: max + 1 }] }))[0]?.campo, `${i} acima`).toBe(i);
            if (min > 0)
                expect(erros(validar({ metas: [{ indicador: i, valor: min - 1 }] }))[0]?.campo, `${i} abaixo`).toBe(i);
        }
    });
    it('RN-CORE-45: a mensagem mostra a faixa na unidade da tela', () => {
        const msg = (indicador, valor) => erros(validar({ metas: [{ indicador, valor }] }))[0]?.mensagem;
        expect(msg('primeiro_checkin', 1440)).toBe('Meta fora da faixa aceita: de 00:00 a 23:59.');
        expect(msg('tma', 0)).toBe('Meta fora da faixa aceita: de 1 a 480 min.');
        expect(msg('fora_rota', 10_001)).toBe('Meta fora da faixa aceita: de 0% a 100%.');
        expect(msg('visitas_dia', 0)).toBe('Meta fora da faixa aceita: de 0,1 a 100,0.');
        expect(msg('raio_checkin', 0)).toBe('Meta fora da faixa aceita: de 1 a 5000 m.');
        expect(msg('km_dia', 999)).toBe('Meta fora da faixa aceita: de 1,0 a 2000,0 km.');
        expect(msg('km_cliente', 99)).toBe('Meta fora da faixa aceita: de 0,1 a 500,0 km.');
        expect(msg('tma', 30.5)).toBe('Meta fora da faixa aceita: de 1 a 480 min.');
    });
    it('RN-CORE-45: o mês que já começou não muda: vigência a partir do mês de hoje', () => {
        expect(erros(validar({ vigencia_inicio: '2026-10' }))).toEqual([
            {
                campo: 'vigencia_inicio',
                mensagem: 'Escolha o mês de hoje ou um mês seguinte. O mês que já começou não muda.',
            },
        ]);
        expect(erros(validar({ vigencia_inicio: '2026-13' }))[0]?.campo).toBe('vigencia_inicio');
    });
    it('RN-CORE-45: o alvo tem de bater com o escopo', () => {
        expect(erros(validar({ escopo: 'equipe' })).map((e) => e.campo)).toEqual(['equipe_id']);
        expect(erros(validar({ escopo: 'usuario' })).map((e) => e.campo)).toEqual(['usuario_id']);
        expect(erros(validar({ escopo: 'tenant', usuario_id: V })).map((e) => e.campo)).toEqual(['usuario_id']);
        expect(erros(validar({ escopo: 'regional' })).map((e) => e.campo)).toEqual(['escopo']);
    });
    it('RN-CORE-45: lista vazia, indicador repetido ou desconhecido', () => {
        expect(erros(validar({ metas: [] })).map((e) => e.campo)).toEqual(['metas']);
        expect(erros(validar({
            metas: [
                { indicador: 'tma', valor: 30 },
                { indicador: 'tma', valor: 31 },
            ],
        })).map((e) => e.campo)).toEqual(['tma']);
        expect(erros(validar({ metas: [{ indicador: 'ticket_medio', valor: 1 }] })).map((e) => e.campo)).toEqual([
            'metas',
        ]);
    });
    it('RN-CORE-45: último check-in antes do 1º, com o 1º herdado do padrão: erro no campo editado', () => {
        expect(erros(validar({ metas: [{ indicador: 'ultimo_checkin', valor: 450 }] }))).toEqual([
            {
                campo: 'ultimo_checkin',
                mensagem: 'O último check-in (07:30) não pode vir antes do 1º check-in (08:00).',
            },
        ]);
    });
    it('RN-CORE-45: 1º check-in depois do último herdado da equipe do usuário: erro no 1º', () => {
        const r = validar({ escopo: 'usuario', usuario_id: V, metas: [{ indicador: 'primeiro_checkin', valor: 1080 }] }, [equipe(NORTE1, 'ultimo_checkin', 1050)]);
        expect(erros(r).map((e) => e.campo)).toEqual(['primeiro_checkin']);
    });
    it('RN-CORE-45: os dois editados juntos e em ordem passam; iguais também', () => {
        expect(validar({
            metas: [
                { indicador: 'primeiro_checkin', valor: 600 },
                { indicador: 'ultimo_checkin', valor: 700 },
            ],
        }).ok).toBe(true);
        expect(validar({
            metas: [
                { indicador: 'primeiro_checkin', valor: 600 },
                { indicador: 'ultimo_checkin', valor: 600 },
            ],
        }).ok).toBe(true);
    });
    it('RN-CORE-45: a edição de uma equipe confere a ordem com o que ela herda do tenant', () => {
        const r = validar({ escopo: 'equipe', equipe_id: NORTE1, metas: [{ indicador: 'ultimo_checkin', valor: 520 }] }, [tenant('primeiro_checkin', 540)]);
        expect(erros(r)[0]?.campo).toBe('ultimo_checkin');
        // A meta da equipe-filha não pesa na edição da equipe-mãe.
        expect(validar({ escopo: 'equipe', equipe_id: NORTE, metas: [{ indicador: 'ultimo_checkin', valor: 520 }] }, [
            equipe(NORTE1, 'primeiro_checkin', 540),
        ]).ok).toBe(true);
    });
    it('RN-CORE-45: o contrato do PUT recusa as mesmas faixas e o alvo incoerente', () => {
        const ok = { escopo: 'tenant', vigencia_inicio: '2026-11', metas: [{ indicador: 'tma', valor: 30 }] };
        expect(MetasProdutividadePutSchema.safeParse(ok).success).toBe(true);
        expect(MetasProdutividadePutSchema.safeParse({ ...ok, metas: [{ indicador: 'tma', valor: 481 }] }).success).toBe(false);
        expect(MetasProdutividadePutSchema.safeParse({ ...ok, escopo: 'equipe' }).success).toBe(false);
        expect(MetasProdutividadePutSchema.safeParse({ ...ok, metas: [ok.metas[0], ok.metas[0]] }).success).toBe(false);
    });
});
