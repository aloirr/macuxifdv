/** T-0158 (ADR 0043): contrato do diagnóstico do aparelho (só dado técnico; tenant e usuário só pelo token). */
import { describe, expect, it } from 'vitest';
import { codigoDoMotivoAndroid, DiagnosticoDetalheSchema, DiagnosticoEnvioSchema, DiagnosticoRespostaSchema, DiagnosticoSaidaDaListaSchema, formatarProtocolo, LIMITE_CORPO_DIAGNOSTICO_BYTES, MAX_SAIDAS_DIAGNOSTICO, MOTIVOS_SAIDA_ANDROID, rotuloDoMotivoDiagnostico, } from './diagnostico';
const envio = {
    id: '0d000000-0000-4000-8000-000000000001',
    origem: 'botao',
    ocorrido_em: '2026-11-11T15:30:00.000Z',
    app: 'campo',
    versao_app: '1.0.4',
    build: null,
    aparelho: { fabricante: 'samsung', modelo: 'SM-A155M', android: '14', api: 34 },
    tela: '/m/novo-pedido',
    motivo: null,
    descricao: 'Fechou ao abrir o pedido',
    erro: null,
    saida_android: null,
    sync: { pendentes: 2, ultimo_sync_em: null },
    print_id: null,
};
describe('DiagnosticoEnvioSchema (T-0158)', () => {
    it('aceita o envio do botão com só dado técnico', () => {
        expect(DiagnosticoEnvioSchema.parse(envio)).toEqual(envio);
    });
    it('recusa tenant, usuário ou dado pessoal no corpo (vêm do token)', () => {
        for (const extra of [{ tenant_id: envio.id }, { usuario_id: envio.id }, { email: 'a@b.com' }, { nome: 'Fulano' }])
            expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ...extra }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, aparelho: { ...envio.aparelho, imei: '1' } }).success).toBe(false);
    });
    it('limita o texto livre e exige UUID e data UTC', () => {
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, descricao: 'x'.repeat(1001) }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, id: '42' }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ocorrido_em: '11/11/2026' }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, origem: 'outra' }).success).toBe(false);
    });
    it('as últimas saídas do Android: até 5, com horário UTC e pilha curta; ausente ou nula vale (aditivo)', () => {
        const saida = { quando: '2026-11-11T15:29:00.000Z', motivo: 4, status: 0, importancia: 100, pss_kb: 1, rss_kb: 2, descricao: 'crash', pilha: 'at Foo.bar' };
        expect(DiagnosticoEnvioSchema.parse({ ...envio, ultimas_saidas: Array(MAX_SAIDAS_DIAGNOSTICO).fill(saida) }).ultimas_saidas).toHaveLength(5);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ultimas_saidas: Array(6).fill(saida) }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ultimas_saidas: [{ ...saida, pilha: 'x'.repeat(1001) }] }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ultimas_saidas: [{ ...saida, quando: 1 }] }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ultimas_saidas: [{ ...saida, extra: 1 }] }).success).toBe(false);
        expect(DiagnosticoEnvioSchema.safeParse({ ...envio, ultimas_saidas: null }).success).toBe(true);
        expect(DiagnosticoSaidaDaListaSchema.parse(saida)).toEqual(saida);
    });
    it('o pior caso do envio (todo texto no máximo e só de caractere escapado no JSON) cabe no limite do corpo', () => {
        const c = (n) => '"'.repeat(n); // cada `"` vira 2 bytes no JSON
        const num = { motivo: 4, status: 0, importancia: 100, pss_kb: 2_000_000, rss_kb: 2_000_000 };
        const cheio = DiagnosticoEnvioSchema.parse({
            ...envio,
            build: c(60),
            tela: c(200),
            motivo: c(60),
            descricao: c(1000),
            erro: { mensagem: c(300), pilha: c(2000), origem: c(40) },
            saida_android: { ...num, descricao: c(300), pilha: c(4000) },
            ultimas_saidas: Array(MAX_SAIDAS_DIAGNOSTICO).fill({ ...num, quando: '2026-11-11T15:29:00.000Z', descricao: c(300), pilha: c(1000) }),
            print_id: envio.id,
        });
        expect(new TextEncoder().encode(JSON.stringify(cheio)).length).toBeLessThan(LIMITE_CORPO_DIAGNOSTICO_BYTES);
    });
});
describe('DiagnosticoDetalheSchema (T-0158)', () => {
    it('as últimas saídas do Android chegam ao portal; linha sem a lista = []', () => {
        const base = {
            id: envio.id,
            protocolo: 42,
            recebido_em: '2026-11-11T15:30:01.000Z',
            ocorrido_em: envio.ocorrido_em,
            origem: 'botao',
            app: 'campo',
            versao_app: '1.0.4',
            aparelho_modelo: 'SM-A155M',
            android: '14',
            motivo: null,
            tenant_id: '0a000000-0000-4000-8000-000000000001',
            tenant_nome: null,
            tem_print: false,
            build: null,
            aparelho_fabricante: 'samsung',
            android_api: 34,
            tela: null,
            descricao: null,
            erro: null,
            saida_android: null,
            sync: null,
            usuario_id: '0b000000-0000-4000-8000-000000000001',
            perfil: 'vendedor',
            alerta: { situacao: 'desligado', recado_id: null, em: null },
        };
        expect(DiagnosticoDetalheSchema.parse(base).ultimas_saidas).toEqual([]);
        expect(DiagnosticoDetalheSchema.parse({ ...base, ultimas_saidas: null }).ultimas_saidas).toEqual([]);
        const saida = { quando: '2026-11-11T15:29:00.000Z', motivo: 6, status: 0, importancia: 100, pss_kb: 1, rss_kb: 2, descricao: 'anr', pilha: null };
        expect(DiagnosticoDetalheSchema.parse({ ...base, ultimas_saidas: [saida] }).ultimas_saidas).toEqual([saida]);
    });
});
describe('formatarProtocolo (T-0158)', () => {
    it('mínimo de 4 dígitos, nunca corta', () => {
        expect(formatarProtocolo(42)).toBe('0042');
        expect(formatarProtocolo(1)).toBe('0001');
        expect(formatarProtocolo(123456)).toBe('123456');
    });
    it('protocolo inválido = erro de programação', () => {
        expect(() => formatarProtocolo(0)).toThrow();
        expect(() => formatarProtocolo(1.5)).toThrow();
    });
    it('resposta da rota', () => {
        expect(DiagnosticoRespostaSchema.parse({ id: envio.id, protocolo: 42, criado: true }).protocolo).toBe(42);
    });
});
describe('MOTIVOS_SAIDA_ANDROID (RD-0124): tabela única do app, da API e do portal', () => {
    it('os 17 motivos do Android (0..16), cada um com código, nome REASON_* e rótulo; códigos sem repetição', () => {
        const numeros = Object.keys(MOTIVOS_SAIDA_ANDROID).map(Number);
        expect(numeros).toEqual([...Array(17).keys()]);
        const codigos = Object.values(MOTIVOS_SAIDA_ANDROID).map((m) => m.codigo);
        expect(new Set(codigos).size).toBe(17);
        for (const m of Object.values(MOTIVOS_SAIDA_ANDROID)) {
            expect(m.nome).toMatch(/^REASON_[A-Z_]+$/);
            expect(m.rotulo.length).toBeGreaterThan(0);
        }
        expect(MOTIVOS_SAIDA_ANDROID[5]).toEqual({ codigo: 'crash_nativo', nome: 'REASON_CRASH_NATIVE', rotulo: 'Falha nativa' });
        expect(MOTIVOS_SAIDA_ANDROID[6]).toEqual({ codigo: 'anr', nome: 'REASON_ANR', rotulo: 'App travou (ANR)' });
    });
    it('rótulos finais do designer-ux (R-20261111-062427): 1, 4, 10, 11 e 15 são nomes do mesmo tipo; códigos não mudam', () => {
        expect([1, 4, 10, 11, 15].map((n) => [MOTIVOS_SAIDA_ANDROID[n].codigo, MOTIVOS_SAIDA_ANDROID[n].rotulo])).toEqual([
            ['saida_propria', 'Saída do próprio app'],
            ['crash_java', 'Falha Java'],
            ['fechado_usuario', 'Encerrado a pedido do usuário'],
            ['parado_usuario', 'Forçado a parar pelo usuário'],
            ['pacote', 'App ativado ou desativado'],
        ]);
        expect(rotuloDoMotivoDiagnostico('crash_java')).toBe('Falha Java');
        const rotulos = Object.values(MOTIVOS_SAIDA_ANDROID).map((m) => m.rotulo);
        expect(new Set(rotulos).size).toBe(17);
    });
    it('codigoDoMotivoAndroid: número → código; fora da tabela = motivo_<n> (o mesmo do app)', () => {
        expect([3, 5, 6, 99].map(codigoDoMotivoAndroid)).toEqual(['memoria', 'crash_nativo', 'anr', 'motivo_99']);
        expect(codigoDoMotivoAndroid(Number.NaN)).toBe('motivo_0');
    });
    it('rotuloDoMotivoDiagnostico: código da queda ou do erro de tela → texto; sem rótulo volta como veio', () => {
        expect(rotuloDoMotivoDiagnostico('crash_nativo')).toBe('Falha nativa');
        expect(rotuloDoMotivoDiagnostico('sinal')).toBe('Encerrado pelo sistema');
        expect(rotuloDoMotivoDiagnostico('fatal')).toBe('Erro fatal do app');
        expect(rotuloDoMotivoDiagnostico('motivo_99')).toBe('motivo_99');
        expect(rotuloDoMotivoDiagnostico('toString')).toBe('toString');
        expect(rotuloDoMotivoDiagnostico(null)).toBeNull();
        expect(rotuloDoMotivoDiagnostico('')).toBeNull();
    });
});
