import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClienteFotoPushSchema } from '../../contracts';
import { enviarFotoPdv, MSG_SEM_CAMERA_PDV } from './enviar-foto-pdv';
import { definirCapturaFotoPdv, type CapturaFotoPdv } from './foto-fachada';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function motorFalso() {
  const enfileirar = vi.fn(async (_i: unknown) => ({}));
  const enfileirarArquivo = vi.fn(async (_a: unknown) => ({}));
  const enviar = vi.fn(async () => undefined);
  return { motor: { enfileirar, enfileirarArquivo, enviar, ambiente: { novoId: () => U(100) } } as never, enfileirar, enfileirarArquivo, enviar };
}
const FACHADA = { id: U(3), nome: 'Fachada', sensivel: false };
const CNH = { id: U(4), nome: 'CNH do sócio', sensivel: true };

const captura = (f: { id: string; origem: 'camera' | 'galeria' } | null): CapturaFotoPdv => ({
  escolher: async () => (f ? { ...f, largura_px: 1600, altura_px: 1200 } : null),
  camera: async () => null,
  galeria: async () => null,
});

afterEach(() => definirCapturaFotoPdv(null));

describe('RN-CORE-38: o aparelho envia a foto do PDV offline primeiro', () => {
  it('RN-CORE-38: câmera -> comando cliente_foto e depois o arquivo na fila, sem apagar a fachada local', async () => {
    definirCapturaFotoPdv(captura({ id: U(7), origem: 'camera' }));
    const m = motorFalso();
    const r = await enviarFotoPdv(m, { clienteId: U(2), nomeCliente: 'Mercado Um', tipo: FACHADA });
    expect(r).toEqual({ kind: 'enviada' });
    const payload = m.enfileirar.mock.calls[0]![0] as { entidade: string; payload: unknown };
    expect(payload.entidade).toBe('cliente_foto');
    expect(ClienteFotoPushSchema.safeParse(payload.payload).success).toBe(true);
    expect(payload.payload).toMatchObject({ id: U(100), cliente_id: U(2), foto_tipo_id: U(3), arquivo_id: U(7), origem: 'camera' });
    expect(m.enfileirarArquivo).toHaveBeenCalledWith(expect.objectContaining({ id: U(7), modulo: 'core', apagarAoEnviar: false }));
    expect(m.enfileirar.mock.invocationCallOrder[0]!).toBeLessThan(m.enfileirarArquivo.mock.invocationCallOrder[0]!);
    expect(m.enviar).toHaveBeenCalled();
  });
  it('RN-CORE-38: galeria no tipo sensível apaga o arquivo local ao enviar', async () => {
    definirCapturaFotoPdv(captura({ id: U(8), origem: 'galeria' }));
    const m = motorFalso();
    await enviarFotoPdv(m, { clienteId: U(2), nomeCliente: 'Mercado Um', tipo: CNH });
    expect(m.enfileirarArquivo).toHaveBeenCalledWith(expect.objectContaining({ id: U(8), apagarAoEnviar: true }));
    expect(m.enfileirar.mock.calls[0]![0]).toMatchObject({ payload: { origem: 'galeria' } });
  });
  it('RN-CORE-38: captura cancelada não grava nada', async () => {
    definirCapturaFotoPdv(captura(null));
    const m = motorFalso();
    expect(await enviarFotoPdv(m, { clienteId: U(2), nomeCliente: 'x', tipo: FACHADA })).toEqual({ kind: 'cancelada' });
    expect(m.enfileirar).not.toHaveBeenCalled();
    expect(m.enfileirarArquivo).not.toHaveBeenCalled();
  });
  it('RN-CORE-38: sem porta do shell a tela recebe a mensagem em português', async () => {
    const m = motorFalso();
    expect(await enviarFotoPdv(m, { clienteId: U(2), nomeCliente: 'x', tipo: FACHADA })).toEqual({ kind: 'erro', mensagem: MSG_SEM_CAMERA_PDV });
    expect(m.enfileirar).not.toHaveBeenCalled();
  });
});
