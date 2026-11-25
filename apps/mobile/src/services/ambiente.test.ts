/**
 * ADR 0076 D6 (T-0196): o shell (Campo e Gestão, app aberto e tarefa sem tela) entrega aos módulos `ambiente.fracaoLiberada()`
 * lido da última versão publicada guardada; sem o valor (nunca respondeu, rede, fora do contrato), a trava fica fechada.
 */
import { completarAmbiente } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./device', () => ({ uuid: () => '00000000-0000-4000-8000-000000000000', posicaoAgora: async () => null }));

import { fracaoLiberadaDa, guardadaDaResposta, type VersaoPublicadaGuardada } from '@/lib/versao-app';

import { criarAmbienteDoAparelho } from './ambiente';
import type { ApiClient } from './api';

const fontes = { api: () => ({}) as ApiClient, online: () => true, usuario: () => null };
const AGORA = new Date('2026-11-25T15:00:00.000Z');
const resposta = (fracao_liberada: boolean) => ({ variante: 'campo', versao: '1.0.36', publicada_em: null, fracao_liberada });

describe('ambiente.fracaoLiberada (ADR 0076 D6)', () => {
  it('segue a versão guardada a cada leitura (a resposta nova vale sem recriar o ambiente)', () => {
    let guardada: VersaoPublicadaGuardada | null = null;
    const amb = completarAmbiente(criarAmbienteDoAparelho({ ...fontes, fracaoLiberada: () => fracaoLiberadaDa(guardada) }));
    expect(amb.fracaoLiberada()).toBe(false);
    guardada = guardadaDaResposta(resposta(true), 'campo', AGORA);
    expect(amb.fracaoLiberada()).toBe(true);
    guardada = guardadaDaResposta(resposta(false), 'campo', AGORA);
    expect(amb.fracaoLiberada()).toBe(false);
  });

  it('sem a fonte no shell: o padrão do SDK, false', () => {
    const amb = criarAmbienteDoAparelho(fontes);
    expect('fracaoLiberada' in amb).toBe(false);
    expect(completarAmbiente(amb).fracaoLiberada()).toBe(false);
  });
});
