/**
 * T-0147 (RN-CORE-38): pedido da folha "Tirar foto / Escolher da galeria" da foto do PDV — a origem tocada volta ao Core;
 * fechar = null; sem folha montada, cancela na hora; um novo pedido encerra o anterior como cancelado.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { assinarFolhaFotoPdv, pedirOrigemFotoPdv, responderFolhaFotoPdv, type PedidoFolhaFotoPdv } from './folha-foto-pdv';

let desfazer: (() => void) | null = null;
afterEach(() => {
  desfazer?.();
  desfazer = null;
});

function montarFolha() {
  const vistos: (PedidoFolhaFotoPdv | null)[] = [];
  desfazer = assinarFolhaFotoPdv((p) => vistos.push(p));
  return vistos;
}

describe('folha da foto do PDV', () => {
  it('sem folha montada (navegador), cancela na hora', async () => {
    expect(await pedirOrigemFotoPdv({ titulo: 'Fachada' })).toBeNull();
  });

  it('abre com o tipo no título e devolve a origem tocada; a folha fecha', async () => {
    const vistos = montarFolha();
    const r = pedirOrigemFotoPdv({ titulo: 'Contrato social' });
    expect(vistos.at(-1)).toEqual({ titulo: 'Contrato social' });
    responderFolhaFotoPdv('galeria');
    expect(await r).toBe('galeria');
    expect(vistos.at(-1)).toBeNull();
  });

  it('fechar (✕, Voltar, toque fora) devolve null; resposta sem pedido não faz nada', async () => {
    montarFolha();
    const r = pedirOrigemFotoPdv({ titulo: 'Fachada' });
    responderFolhaFotoPdv(null);
    expect(await r).toBeNull();
    expect(() => responderFolhaFotoPdv('camera')).not.toThrow();
  });

  it('novo pedido com a folha aberta encerra o anterior como cancelado', async () => {
    montarFolha();
    const primeiro = pedirOrigemFotoPdv({ titulo: 'Fachada' });
    const segundo = pedirOrigemFotoPdv({ titulo: 'Alvará' });
    expect(await primeiro).toBeNull();
    responderFolhaFotoPdv('camera');
    expect(await segundo).toBe('camera');
  });

  it('a folha desmontada cancela o pedido aberto', async () => {
    montarFolha();
    const r = pedirOrigemFotoPdv({ titulo: 'Fachada' });
    desfazer?.();
    desfazer = null;
    expect(await r).toBeNull();
  });
});
