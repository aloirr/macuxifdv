/**
 * Botão Sincronizar (R-20261115-100000; RN-CORE-23 revista, ADR 0057): toque = parcial (fila + pedidos e clientes), segurar
 * 10 000 ms = completa com o popup. Aceite do gesto (kit) ligado ao que cada modo pede ao motor (shell) e às entidades que os
 * módulos marcam como parciais. Os unitários do kit e do shell ficam em packages/ui e apps/mobile.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RAIZ, existe, importar, ler } from '../apoio/v1013';

const KIT = 'packages/ui/src/mobile/sincronizacao-completa.ts';
const SHELL = 'apps/mobile/src/lib/sync-completa.ts';
const COM_KIT = existe(KIT);
const COM_SHELL = existe(SHELL);

type Modo = 'segurar' | 'toque' | 'nenhum';
interface Kit {
  SEGURAR_COMPLETA_MS: number;
  desenhoSegurar(ms: number | null): { completa: boolean };
  criarControleSegurar(o: {
    modo: () => Modo;
    parcial: () => void;
    completa: () => void;
    aoMudar: (ms: number | null) => void;
    agora: () => number;
    definirIntervalo: (fn: () => void, ms: number) => unknown;
    limparIntervalo: (id: unknown) => void;
  }): { pressionar(): void; soltar(): void; tocar(): void };
}
interface Motor {
  enviar(o?: { incluirFalhos?: boolean }): Promise<unknown>;
  sincronizar(): Promise<boolean>;
  sincronizarNovidades(o?: { entidades?: readonly string[] }): Promise<boolean>;
}
interface Shell {
  ENTIDADES_SYNC_PARCIAL: readonly string[];
  pedidoDoAgendador(motivo: string): { tipo: string };
  rodarSync(p: { tipo: 'parcial' | 'completa' }, m: Motor, c: { modo: string; offline: boolean; atualizarModulos: () => Promise<void> }): Promise<boolean>;
}
type Entidade = { nome: string; parcial?: boolean };

/** Arquivos do Sincronizar no app e no kit (nome com "sinc" ou "sync"), sem testes. */
function arquivosDoSincronizar(): string[] {
  const saida: string[] = [];
  const andar = (rel: string) => {
    for (const nome of readdirSync(join(RAIZ, rel))) {
      const r = `${rel}/${nome}`;
      if (statSync(join(RAIZ, r)).isDirectory()) andar(r);
      else if (/(sinc|sync)/i.test(nome) && /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(r);
    }
  };
  andar('apps/mobile/src');
  andar('packages/ui/src/mobile');
  return [...saida, 'apps/mobile/src/state/plataforma.tsx'];
}

describe('Sincronizar — nenhum "rápida" sobra nas telas e arquivos do botão (os dois estados)', () => {
  it('"parcial" no lugar de "rápida"', () => {
    const com = arquivosDoSincronizar().filter((r) => /r[aá]pida/i.test(ler(r)));
    expect(com).toEqual([]);
  });
});

describe('Sincronizar — segurar 10 000 ms = completa; soltar antes = parcial (kit)', () => {
  if (!COM_KIT) {
    it('antes do PR do designer-ux: o botão só tem o toque (sem o segurar)', () => {
      expect(ler('packages/ui/src/mobile/sincronizacao.tsx')).not.toContain('onPressIn');
    });
    return;
  }

  async function gesto(segurarMs: number) {
    const kit = await importar<Kit>(KIT);
    let t = 0;
    const intervalo: { passo: (() => void) | null } = { passo: null };
    const parcial = vi.fn();
    const completa = vi.fn();
    const c = kit.criarControleSegurar({
      modo: () => 'segurar',
      parcial,
      completa,
      aoMudar: () => undefined,
      agora: () => t,
      definirIntervalo: (fn) => {
        intervalo.passo = fn;
        return 1;
      },
      limparIntervalo: () => {
        intervalo.passo = null;
      },
    });
    c.pressionar();
    t = segurarMs;
    intervalo.passo?.();
    c.soltar();
    c.tocar();
    return { parcial: parcial.mock.calls.length, completa: completa.mock.calls.length, kit };
  }

  it('o limiar é 10 000 ms exatos: 9 999 não marca a completa, 10 000 marca', async () => {
    const { kit } = await gesto(0);
    expect(kit.SEGURAR_COMPLETA_MS).toBe(10_000);
    expect(kit.desenhoSegurar(9_999).completa).toBe(false);
    expect(kit.desenhoSegurar(10_000).completa).toBe(true);
  });

  it('soltar aos 9 999 ms = uma parcial e nenhuma completa', async () => {
    expect(await gesto(9_999)).toMatchObject({ parcial: 1, completa: 0 });
  });

  it('chegar aos 10 000 ms = uma completa; o toque que vem ao soltar não faz a parcial', async () => {
    expect(await gesto(10_000)).toMatchObject({ parcial: 0, completa: 1 });
  });
});

describe('Sincronizar — o que cada modo pede ao motor (shell; RN-CORE-23, ADR 0057)', () => {
  if (!COM_SHELL) {
    it('antes do PR do engenheiro-apps: o toque faz a sincronização de sempre (sem modo parcial no shell)', () => {
      expect(ler('apps/mobile/src/state/plataforma.tsx')).not.toContain('rodarSync');
    });
    return;
  }
  const motor = () => ({
    enviar: vi.fn(async () => undefined),
    sincronizar: vi.fn(async () => true),
    sincronizarNovidades: vi.fn(async () => true),
  });
  const ctx = (atualizarModulos = vi.fn(async () => undefined)) => ({ modo: 'v1', offline: false, atualizarModulos });

  it('toque (motivo manual) = parcial: envia a fila com os falhos e puxa só pedidos e clientes, sem estoque nem catálogo', async () => {
    const s = await importar<Shell>(SHELL);
    const m = motor();
    const c = ctx();
    expect(s.pedidoDoAgendador('manual')).toEqual({ tipo: 'parcial' });
    await s.rodarSync({ tipo: 'parcial' }, m, c);
    expect(m.enviar).toHaveBeenCalledWith({ incluirFalhos: true });
    expect(m.sincronizarNovidades).toHaveBeenCalledWith({ entidades: s.ENTIDADES_SYNC_PARCIAL });
    expect(m.sincronizar).not.toHaveBeenCalled();
    expect(c.atualizarModulos).not.toHaveBeenCalled();
    expect([...s.ENTIDADES_SYNC_PARCIAL].sort()).toEqual(['carteira', 'cliente', 'cliente_contato', 'cliente_endereco', 'pedido', 'pedido_evento', 'pedido_item']);
  });

  it('segurar 10 s = completa: envia a fila, atualiza os módulos e roda a sincronização inteira (estoque inclusive)', async () => {
    const s = await importar<Shell>(SHELL);
    const m = motor();
    const c = ctx();
    await s.rodarSync({ tipo: 'completa' }, m, c);
    expect(m.enviar).toHaveBeenCalledWith({ incluirFalhos: true });
    expect(c.atualizarModulos).toHaveBeenCalledTimes(1);
    expect(m.sincronizar).toHaveBeenCalledTimes(1);
    expect(m.sincronizarNovidades).not.toHaveBeenCalled();
  });

  const MARCAS = ler('modules/core/app/lib/entidades-cliente.ts').includes('parcial') && ler('modules/vendedor/contracts/entidades.ts').includes('parcial');
  it.skipIf(!MARCAS)('a lista da parcial do shell é a mesma das entidades que o Core e o Vendedor marcam como parciais', async () => {
    const s = await importar<Shell>(SHELL);
    const { entidadesCliente } = await importar<{ entidadesCliente: readonly Entidade[] }>('modules/core/app/lib/entidades-cliente.ts');
    const { ENTIDADES_VENDEDOR } = await importar<{ ENTIDADES_VENDEDOR: readonly Entidade[] }>('modules/vendedor/contracts/entidades.ts');
    const marcadas = [...entidadesCliente, ...ENTIDADES_VENDEDOR].filter((e) => e.parcial === true).map((e) => e.nome);
    expect(marcadas.sort()).toEqual([...s.ENTIDADES_SYNC_PARCIAL].sort());
  });
});
