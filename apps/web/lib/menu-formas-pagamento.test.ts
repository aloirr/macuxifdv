/**
 * T-0089 A1 (R-20261106-073350): "Formas de pagamento e prazos" no menu do BKO, só para admin, analista e gerente
 * (RN-VEN-24; a API decide a escrita). Registro REAL do Vendedor. O grupo (Cadastros desde R-20261115-122000; antes
 * Comercial, ADR 0050) é dado do manifesto do módulo e é testado em modules/vendedor; aqui o shell só confere que o
 * item cai num grupo existente, com o rótulo desse grupo.
 */
import { criarShell, GRUPOS_MENU, ROTULO_GRUPO_MENU, type ModuloShell } from '@macuxi/platform-sdk';
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
  it.each(['admin', 'analista', 'gerente'] as const)('%s vê o item num grupo existente, com o rótulo da ficha', (perfil) => {
    const item = itemDoMenu(perfil);
    expect(item?.rotulo).toBe('Formas de pagamento e prazos');
    expect(GRUPOS_MENU).toContain(item?.grupoMenu);
    expect(item?.rotuloGrupo).toBe(item && ROTULO_GRUPO_MENU[item.grupoMenu]);
    expect(item?.caminho).toBe('formas-pagamento');
  });

  it.each(['supervisor', 'vendedor'] as const)('%s não vê o item', (perfil) => {
    expect(itemDoMenu(perfil)).toBeUndefined();
  });
});
