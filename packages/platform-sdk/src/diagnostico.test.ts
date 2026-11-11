/** T-0158 (ADR 0043): contrato do diagnóstico do aparelho (só dado técnico; tenant e usuário só pelo token). */
import { describe, expect, it } from 'vitest';
import { DiagnosticoEnvioSchema, DiagnosticoRespostaSchema, formatarProtocolo } from './diagnostico';

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
