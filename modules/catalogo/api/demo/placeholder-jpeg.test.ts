import { dimensoesJpeg, ehJpeg } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../../contracts';
import { corDaCategoria, gerarPlaceholderJpeg } from './placeholder-jpeg';

describe('placeholder de foto de produto para a demo (T-0097, sem imagem de marca real)', () => {
  it('RF-CAT-03: gera JPEG válido de 320 x 320 px dentro do teto de bytes da miniatura', () => {
    const jpeg = gerarPlaceholderJpeg({ nome: 'Café torrado e moído 500 g', categoria: 'Mercearia' });
    expect(ehJpeg(jpeg)).toBe(true);
    expect(dimensoesJpeg(jpeg)).toEqual({ largura: LADO_MAX_MINIATURA_PX, altura: LADO_MAX_MINIATURA_PX });
    expect(jpeg.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA);
    expect([...jpeg.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it('RF-CAT-03: é determinístico (mesma entrada, mesmos bytes) e muda com o nome', () => {
    const a = gerarPlaceholderJpeg({ nome: 'Arroz 5 kg', categoria: 'Mercearia' });
    expect(gerarPlaceholderJpeg({ nome: 'Arroz 5 kg', categoria: 'Mercearia' })).toEqual(a);
    expect(gerarPlaceholderJpeg({ nome: 'Feijão 1 kg', categoria: 'Mercearia' })).not.toEqual(a);
  });

  it('RF-CAT-03: cada categoria tem a sua cor, estável, e a categoria vazia tem cor neutra', () => {
    expect(corDaCategoria('Bebidas')).toEqual(corDaCategoria('bebidas '));
    expect(corDaCategoria('Bebidas')).not.toEqual(corDaCategoria('Laticínios'));
    expect(corDaCategoria('')).toEqual([96, 106, 120]);
  });

  it('RF-CAT-03: nome com acento, símbolo e texto longo não quebra o desenho', () => {
    const jpeg = gerarPlaceholderJpeg({ nome: 'Refrigerante de guaraná lata 350 ml (fardo 12) — edição especial promocional', categoria: 'Bebidas' });
    expect(ehJpeg(jpeg)).toBe(true);
    expect(jpeg.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA);
  });
});
