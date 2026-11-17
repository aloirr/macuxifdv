/**
 * T-0089 A1 (R-20261106-073350): lugar de "Formas de pagamento e prazos" no menu do BKO: grupo Cadastros (ADR 0060),
 * só para admin, analista e gerente (RN-VEN-24; a API decide a escrita). Registro REAL do Vendedor.
 */
import { criarShell, type ModuloShell } from '@macuxi/platform-sdk';
import * as webVendedor from '@macuxi/vendedor/web';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';

const vendedor = (webVendedor as { moduloWeb: ModuloShell<unknown> }).moduloWeb;
const modulos: ModuloShell<unknown>[] = MANIFESTOS_INSTALADOS.map((m) => (m.id === 'vendedor' ? vendedor : { manifesto: m }));
const ATIVOS = ['core', 'catalogo', 'vendedor'] as const;

const itemDoMenu = (perfil: 'admin' | 'analista' | 'gerente' | 'supervisor' | 'vendedor') =>
  criarShell('web', modulos)
    .montar({ perfil, modulosAtivos: [...ATIVOS] })
    .navegacao.find((n) => n.testID === 'nav-vendedor-formas-pagamento');

describe('menu do BKO: Formas de pagamento e prazos (T-0089 A1)', () => {
  it.each(['admin', 'analista', 'gerente'] as const)('%s vê o item em Cadastros, com o rótulo da ficha', (perfil) => {
    const item = itemDoMenu(perfil);
    expect(item?.rotulo).toBe('Formas de pagamento e prazos');
    expect(item?.grupoMenu).toBe('cadastros');
    expect(item?.rotuloGrupo).toBe('Cadastros');
    expect(item?.caminho).toBe('formas-pagamento');
  });

  it.each(['supervisor', 'vendedor'] as const)('%s não vê o item', (perfil) => {
    expect(itemDoMenu(perfil)).toBeUndefined();
  });
});
