/**
 * ADR 0054 (desenho T-catalogo-pacote §1, §1.5, §1.6, §3): contratos do pacote da primeira carga. Só tipos e Zod; o
 * comportamento (motor, importação, gerador, rotas) vem nas tarefas A2/A3.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { definirModuloApi, } from './api';
import { defineModule } from './manifesto';
import { CODIGOS_FALHA_PACOTE, ErroPacoteSync, FORMATO_PACOTE_SYNC, MAX_PARTICOES_PACOTE, MetaPacoteSchema, PacoteSyncSchema, PacotesSyncRespostaSchema, ROTA_SYNC_PACOTES, filialDaParticao, particaoDeFilial, } from './pacotes-sync';
import { codificarCursor, definirEntidadeSync } from './sync';
import { UUID_NIL } from './novidades';
import { z } from 'zod';
const ID = '0b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4';
const TENANT = '1c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5';
const FILIAL = '2d8b3f40-5e6c-4d7e-8f80-91a2b3c4d5e6';
const HORIZONTE = '2026-11-15T10:00:00.000Z';
const pacote = (extra = {}) => ({
    id: ID,
    modulo: 'catalogo',
    particao: `filial:${FILIAL}`,
    horizonte: HORIZONTE,
    bytes: 18_000_000,
    md5: '9e107d9d372bb6826bd81d3542a419d6',
    url: 'https://bucket.s3.amazonaws.com/sync-pacotes/x.sqlite.gz?X-Amz-Signature=abc',
    expira_em: '2026-11-15T10:15:00.000Z',
    entidades: [
        {
            nome: 'tabela_preco_item',
            linhas: 150_000,
            cursor: codificarCursor({ updated_at: HORIZONTE, id: UUID_NIL }),
            versao_escopo: 'abc123',
        },
    ],
    ...extra,
});
describe('PacoteSyncSchema (ADR 0054 §1.6)', () => {
    it('aceita o pacote do manifesto e a partição tenant', () => {
        expect(PacoteSyncSchema.parse(pacote())).toMatchObject({ particao: `filial:${FILIAL}` });
        expect(PacoteSyncSchema.parse(pacote({ particao: 'tenant' })).particao).toBe('tenant');
    });
    it('aceita url relativa da rota de disco (dev/CI)', () => {
        expect(PacoteSyncSchema.safeParse(pacote({ url: `/v1/sync/pacotes/${ID}/arquivo` })).success).toBe(true);
    });
    it('versao_escopo é opcional (escopo tenant sem variação)', () => {
        const p = pacote();
        const e = { ...p.entidades[0] };
        delete e.versao_escopo;
        expect(PacoteSyncSchema.safeParse({ ...p, entidades: [e] }).success).toBe(true);
    });
    it.each([
        ['partição desconhecida', { particao: 'carteira' }],
        ['filial sem uuid', { particao: 'filial:abc' }],
        ['módulo fora da lista', { modulo: 'erp' }],
        ['md5 inválido', { md5: 'xyz' }],
        ['bytes zero', { bytes: 0 }],
        ['horizonte sem data', { horizonte: 'ontem' }],
        ['sem entidades', { entidades: [] }],
        ['cursor ilegível', { entidades: [{ nome: 'produto', linhas: 1, cursor: 'x' }] }],
        ['nome de entidade inválido', { entidades: [{ nome: 'Produto;drop', linhas: 1, cursor: codificarCursor({ updated_at: HORIZONTE, id: UUID_NIL }) }] }],
        ['linhas negativas', { entidades: [{ nome: 'produto', linhas: -1, cursor: codificarCursor({ updated_at: HORIZONTE, id: UUID_NIL }) }] }],
        ['entidade repetida', { entidades: [pacote().entidades[0], pacote().entidades[0]] }],
    ])('recusa %s', (_, extra) => {
        expect(PacoteSyncSchema.safeParse(pacote(extra)).success).toBe(false);
    });
});
describe('PacotesSyncRespostaSchema', () => {
    it('lista vazia = o aparelho segue no pull paginado; geracao_base opcional', () => {
        expect(PacotesSyncRespostaSchema.parse({ pacotes: [] })).toEqual({ pacotes: [] });
        expect(PacotesSyncRespostaSchema.parse({ geracao_base: 'g1', pacotes: [pacote()] }).pacotes).toHaveLength(1);
    });
    it('é tolerante a campos novos (servidor mais novo que o app)', () => {
        const r = PacotesSyncRespostaSchema.parse({ pacotes: [{ ...pacote(), novo: 1 }], extra: true });
        expect(r.pacotes[0]?.id).toBe(ID);
    });
    it('recusa o mesmo id duas vezes', () => {
        expect(PacotesSyncRespostaSchema.safeParse({ pacotes: [pacote(), pacote()] }).success).toBe(false);
    });
    it('tipo exportado', () => {
        expectTypeOf().toHaveProperty('cursor');
    });
});
describe('MetaPacoteSchema (tabela _pacote do arquivo)', () => {
    const meta = {
        formato: '1',
        tenant_id: TENANT,
        modulo: 'core',
        particao: 'tenant',
        horizonte: HORIZONTE,
        geracao_base: 'g1',
        entidades: JSON.stringify({ produto: 10, medida: 3 }),
    };
    it('lê as linhas chave/valor (texto) e converte formato e entidades', () => {
        expect(MetaPacoteSchema.parse(meta)).toEqual({ ...meta, formato: FORMATO_PACOTE_SYNC, entidades: { produto: 10, medida: 3 } });
    });
    it('recusa formato diferente do atual', () => {
        expect(MetaPacoteSchema.safeParse({ ...meta, formato: '2' }).success).toBe(false);
    });
    it('recusa entidades que não são JSON de contagens', () => {
        expect(MetaPacoteSchema.safeParse({ ...meta, entidades: '{' }).success).toBe(false);
        expect(MetaPacoteSchema.safeParse({ ...meta, entidades: '{"produto":-1}' }).success).toBe(false);
    });
});
describe('constantes e partições', () => {
    it('valores fixados no desenho', () => {
        expect(FORMATO_PACOTE_SYNC).toBe(1);
        expect(MAX_PARTICOES_PACOTE).toBe(8);
        expect(ROTA_SYNC_PACOTES).toBe('/v1/sync/pacotes');
    });
    it('particaoDeFilial e filialDaParticao são inversas', () => {
        expect(particaoDeFilial(FILIAL)).toBe(`filial:${FILIAL}`);
        expect(filialDaParticao(`filial:${FILIAL}`)).toBe(FILIAL);
        expect(filialDaParticao('tenant')).toBeNull();
        expect(() => particaoDeFilial('abc')).toThrow();
    });
    it('erro do pacote carrega um código da lista (Diagnóstico, sem dado pessoal)', () => {
        const e = new ErroPacoteSync('md5');
        expect(e.codigo).toBe('md5');
        expect(e).toBeInstanceOf(Error);
        expect(CODIGOS_FALHA_PACOTE).toContain('contagem');
    });
});
describe('ProvedorSync.pacote e ModuloApi.particoesPacote (definirModuloApi)', () => {
    const manifesto = defineModule({
        id: 'catalogo',
        versao: '1.0.0',
        depende: ['core'],
        perfis: ['vendedor'],
        sync: ['tabela_preco_item', 'cliente_tabela_preco'],
    });
    const entidade = definirEntidadeSync({
        nome: 'tabela_preco_item',
        modulo: 'catalogo',
        direcao: 'pull',
        conflito: 'servidor_vence',
        schema: z.object({ id: z.string() }),
    });
    const entidadeCarteira = { ...entidade, nome: 'cliente_tabela_preco' };
    const puxar = async () => [];
    const comPacote = (p, extra = {}) => ({
        manifesto,
        sync: [{ entidade, escopo: 'tenant', puxar, ...p }],
        ...extra,
    });
    const particoesPacote = {
        filiaisDoUsuario: async () => [FILIAL],
        filiaisDoTenant: async () => [FILIAL],
    };
    it('aceita pacote de partição tenant e de filial com particoesPacote', () => {
        expect(() => definirModuloApi(comPacote({ pacote: { particao: 'tenant', puxar } }))).not.toThrow();
        expect(() => definirModuloApi(comPacote({ pacote: { particao: 'filial', permitido: () => true, puxar } }, { particoesPacote }))).not.toThrow();
    });
    it('partição filial exige particoesPacote no módulo', () => {
        expect(() => definirModuloApi(comPacote({ pacote: { particao: 'filial', puxar } }))).toThrow(/particoesPacote/);
    });
    it('pacote só em provedor de escopo tenant (o arquivo é o mesmo para todos)', () => {
        expect(() => definirModuloApi({
            manifesto,
            sync: [{ entidade: entidadeCarteira, escopo: 'carteira', puxar, pacote: { particao: 'tenant', puxar } }],
        })).toThrow(/escopo tenant/);
    });
    it('pacote exige o pull normal (o incremental continua pelo puxar)', () => {
        expect(() => definirModuloApi({ manifesto, sync: [{ entidade, escopo: 'tenant', pacote: { particao: 'tenant', puxar } }] })).toThrow(/puxar/);
    });
    it('partição inválida é recusada', () => {
        expect(() => definirModuloApi(comPacote({ pacote: { particao: 'carteira', puxar } }))).toThrow(/partição/);
    });
    it('contrato do puxar do pacote: ContextoPacote e filial no pedido', () => {
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
    });
});
describe('peças opcionais do aparelho (aditivas)', () => {
    it('são todas opcionais: o motor de hoje compila sem elas', () => {
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
        expectTypeOf().toMatchTypeOf();
    });
});
