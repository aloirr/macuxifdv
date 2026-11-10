/**
 * T-0147 (RN-CORE-38): galeria só para as fotos do PDV. A foto escolhida passa pela mesma redução (1600 px) e regravação
 * JPEG 80 da câmera (a regravação descarta o EXIF, inclusive o GPS), vai para `fotos/<uuid>.jpg`; galeria cancelada = null.
 * O registro dá câmera + galeria e o visualizador só ao Core; Promotor e Pesquisa seguem só com a câmera.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  galeria: { canceled: false, assets: [{ uri: 'content://galeria/1', width: 4000, height: 3000 }] } as { canceled: boolean; assets: { uri: string; width: number; height: number }[] },
  camera: { canceled: false, assets: [{ uri: 'file:///cache/camera.jpg', width: 1200, height: 1600 }] } as { canceled: boolean; assets: { uri: string; width: number; height: number }[] },
  opcoesGaleria: [] as unknown[],
  resize: [] as unknown[],
  save: [] as unknown[],
  movidos: [] as string[],
  core: {} as Record<string, ReturnType<typeof vi.fn>>,
  promotor: vi.fn(),
  pesquisa: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: async () => sim.camera,
  launchImageLibraryAsync: async (o: unknown) => {
    sim.opcoesGaleria.push(o);
    return sim.galeria;
  },
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: () => {
      const ctx = {
        resize(r: unknown) {
          sim.resize.push(r);
          return ctx;
        },
        async renderAsync() {
          return {
            async saveAsync(o: unknown) {
              sim.save.push(o);
              return { uri: 'file:///cache/regravada.jpg', width: 1600, height: 1200 };
            },
          };
        },
      };
      return ctx;
    },
  },
}));
vi.mock('expo-file-system', () => {
  class Directory {
    exists = true;
    constructor(..._partes: unknown[]) {}
    create() {}
  }
  class File {
    nome: string;
    constructor(...partes: unknown[]) {
      this.nome = String(partes[partes.length - 1]);
    }
    async move(destino: File) {
      sim.movidos.push(destino.nome);
    }
  }
  return { Directory, File, Paths: { document: 'documentos' } };
});
vi.mock('./device', () => ({ uuid: () => '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70', posicaoAgora: async () => null }));
vi.mock('./foto-pdv', () => ({ abrirFotoPdv: vi.fn() }));
vi.mock('@macuxi/core/app', () => sim.core);
vi.mock('@macuxi/promotor/app', () => ({ definirCapturaFotoPromotor: sim.promotor }));
vi.mock('@macuxi/pesquisa/app', () => ({ definirCapturaFotoPesquisa: sim.pesquisa }));

import { capturarFotoGravada, escolherFotoDaGaleria, registrarCameraNosModulos } from './camera';
import { abrirFotoPdv } from './foto-pdv';

beforeEach(() => {
  sim.opcoesGaleria.length = 0;
  sim.resize.length = 0;
  sim.save.length = 0;
  sim.movidos.length = 0;
  sim.galeria.canceled = false;
});

describe('escolherFotoDaGaleria', () => {
  it('uma foto, sem EXIF na leitura; reduz a 1600 px e regrava JPEG 80 em fotos/<uuid>.jpg', async () => {
    const foto = await escolherFotoDaGaleria();
    expect(sim.opcoesGaleria[0]).toMatchObject({ mediaTypes: ['images'], allowsMultipleSelection: false, exif: false });
    expect(sim.resize).toEqual([{ width: 1600 }]);
    expect(sim.save).toEqual([{ format: 'jpeg', compress: 0.8 }]);
    expect(sim.movidos).toEqual(['0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70.jpg']);
    expect(foto).toEqual({ id: '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70', largura_px: 1600, altura_px: 1200 });
  });

  it('galeria cancelada = null, nada gravado', async () => {
    sim.galeria.canceled = true;
    expect(await escolherFotoDaGaleria()).toBeNull();
    expect(sim.save).toEqual([]);
    expect(sim.movidos).toEqual([]);
  });

  it('a câmera usa a mesma regravação (já no tamanho: sem redução, ainda JPEG 80)', async () => {
    const foto = await capturarFotoGravada();
    expect(sim.resize).toEqual([]);
    expect(sim.save).toEqual([{ format: 'jpeg', compress: 0.8 }]);
    expect(foto?.id).toBe('0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70');
  });
});

describe('registrarCameraNosModulos', () => {
  it('galeria e visualizador só no Core (fotos do PDV); Promotor e Pesquisa só com a câmera', () => {
    sim.core.definirCapturaFoto = vi.fn();
    sim.core.definirCapturaFotoPdv = vi.fn();
    sim.core.definirAbrirFotoPdv = vi.fn();
    expect(registrarCameraNosModulos()).toBe(true);
    expect(sim.core.definirCapturaFotoPdv).toHaveBeenCalledWith({ camera: capturarFotoGravada, galeria: escolherFotoDaGaleria });
    expect(sim.core.definirAbrirFotoPdv).toHaveBeenCalledWith(abrirFotoPdv);
    expect(sim.promotor.mock.calls[0]![0]).not.toBe(escolherFotoDaGaleria);
    expect(sim.pesquisa).toHaveBeenCalledWith(capturarFotoGravada);
  });
});
