/**
 * RN-VEN-38 (T-0128): registro do bloqueio de saída do shell. Com o formulário alterado e em foco, a barra inferior e o
 * Voltar do Android (gesto ou botão) não navegam: chamam `aoTentarSair(prosseguir)`, e só `prosseguir()` libera. Sem
 * alteração, sai direto. O `BackHandler` simulado chama o ouvinte mais novo primeiro, como o do React Native.
 */
import { describe, expect, it, vi } from 'vitest';

import { criarBloqueioDeSaida, type AoTentarSair, type FormularioAlterado } from './bloqueio-saida';

function simularAndroid() {
  const ouvintes: (() => boolean)[] = [];
  return {
    ouvintes,
    ouvir(o: () => boolean) {
      ouvintes.push(o);
      return () => {
        const i = ouvintes.indexOf(o);
        if (i >= 0) ouvintes.splice(i, 1);
      };
    },
    /** Aperta o Voltar: devolve `true` se algum ouvinte tratou (senão o sistema sairia do app). */
    voltar(): boolean {
      for (let i = ouvintes.length - 1; i >= 0; i--) if (ouvintes[i]()) return true;
      return false;
    },
  };
}

function montar(opcoes: { emFoco?: boolean } = {}) {
  const android = simularAndroid();
  const foco = { valor: opcoes.emFoco ?? true };
  // o ouvinte do roteador é da raiz: assina antes de qualquer formulário e volta sempre
  const voltarDoRoteador = vi.fn(() => true);
  android.ouvir(voltarDoRoteador);
  const voltar = vi.fn();
  const bloqueio = criarBloqueioDeSaida({ emFoco: () => foco.valor, ouvirVoltarDoAndroid: (o) => android.ouvir(o), voltar });
  return { android, foco, voltar, voltarDoRoteador, bloqueio };
}

/** Formulário com estado mutável: `alterado` é lido na hora da tentativa. A tela guarda o `prosseguir` (folha aberta). */
function formulario(alterado = true) {
  const estado = { alterado, prosseguir: null as (() => void) | null };
  const aoTentarSair = vi.fn<AoTentarSair>((p) => {
    estado.prosseguir = p;
  });
  const f: FormularioAlterado = { alterado: () => estado.alterado, aoTentarSair };
  return { estado, aoTentarSair, f };
}

describe('barra inferior (tentarSair)', () => {
  it('sem formulário registrado, a aba abre direto', () => {
    const { bloqueio } = montar();
    const seguir = vi.fn();
    expect(bloqueio.tentarSair(seguir)).toBe(false);
    expect(seguir).toHaveBeenCalledTimes(1);
  });

  it('formulário sem alteração: sai direto, sem chamar a tela', () => {
    const { bloqueio } = montar();
    const { f, aoTentarSair } = formulario(false);
    bloqueio.registrar(f);
    const seguir = vi.fn();
    expect(bloqueio.tentarSair(seguir)).toBe(false);
    expect(seguir).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
    expect(bloqueio.bloqueando()).toBe(false);
  });

  it('formulário alterado: não navega, pergunta à tela, e só o prosseguir abre a aba (uma vez só)', () => {
    const { bloqueio } = montar();
    const { f, aoTentarSair, estado } = formulario(true);
    bloqueio.registrar(f);
    const seguir = vi.fn();
    expect(bloqueio.bloqueando()).toBe(true);
    expect(bloqueio.tentarSair(seguir)).toBe(true);
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(seguir).not.toHaveBeenCalled();
    estado.prosseguir?.();
    estado.prosseguir?.();
    expect(seguir).toHaveBeenCalledTimes(1);
  });

  it('"Continuar editando" (a tela não chama prosseguir) cancela a saída', () => {
    const { bloqueio } = montar();
    const { f } = formulario(true);
    bloqueio.registrar(f);
    const seguir = vi.fn();
    bloqueio.tentarSair(seguir);
    expect(seguir).not.toHaveBeenCalled();
    // um novo toque pergunta de novo
    bloqueio.tentarSair(seguir);
    expect(f.aoTentarSair).toHaveBeenCalledTimes(2);
    expect(seguir).not.toHaveBeenCalled();
  });

  it('a alteração é lida na hora do toque (alterar depois de montar passa a bloquear; salvar libera)', () => {
    const { bloqueio } = montar();
    const { f, estado } = formulario(false);
    bloqueio.registrar(f);
    estado.alterado = true;
    const seguir = vi.fn();
    expect(bloqueio.tentarSair(seguir)).toBe(true);
    estado.alterado = false;
    expect(bloqueio.tentarSair(seguir)).toBe(false);
    expect(seguir).toHaveBeenCalledTimes(1);
  });

  it('com as telas de módulo fora de foco (Início, Mais, Perfil), o formulário montado por baixo não segura a saída', () => {
    const { bloqueio, foco } = montar({ emFoco: false });
    const { f, aoTentarSair } = formulario(true);
    bloqueio.registrar(f);
    const seguir = vi.fn();
    expect(bloqueio.tentarSair(seguir)).toBe(false);
    expect(seguir).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
    foco.valor = true;
    expect(bloqueio.tentarSair(seguir)).toBe(true);
  });

  it('desmontar a tela retira o bloqueio (e retirar duas vezes não quebra)', () => {
    const { bloqueio } = montar();
    const { f, aoTentarSair } = formulario(true);
    const retirar = bloqueio.registrar(f);
    retirar();
    retirar();
    const seguir = vi.fn();
    expect(bloqueio.tentarSair(seguir)).toBe(false);
    expect(seguir).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('dois formulários montados: vale o último', () => {
    const { bloqueio } = montar();
    const a = formulario(true);
    const b = formulario(true);
    bloqueio.registrar(a.f);
    const retirarB = bloqueio.registrar(b.f);
    bloqueio.tentarSair(vi.fn());
    expect(b.aoTentarSair).toHaveBeenCalledTimes(1);
    expect(a.aoTentarSair).not.toHaveBeenCalled();
    retirarB();
    bloqueio.tentarSair(vi.fn());
    expect(a.aoTentarSair).toHaveBeenCalledTimes(1);
  });
});

describe('Voltar do Android (gesto e botão)', () => {
  it('formulário alterado: o shell trata antes do roteador, pergunta, e só volta no prosseguir', () => {
    const { bloqueio, android, voltar, voltarDoRoteador } = montar();
    const { f, aoTentarSair, estado } = formulario(true);
    bloqueio.registrar(f);
    expect(android.voltar()).toBe(true);
    expect(aoTentarSair).toHaveBeenCalledTimes(1);
    expect(voltarDoRoteador).not.toHaveBeenCalled();
    expect(voltar).not.toHaveBeenCalled();
    estado.prosseguir?.();
    estado.prosseguir?.();
    expect(voltar).toHaveBeenCalledTimes(1);
  });

  it('sem alteração: o shell não trata e o roteador volta direto, sem chamar a tela', () => {
    const { bloqueio, android, voltar, voltarDoRoteador } = montar();
    const { f, aoTentarSair } = formulario(false);
    bloqueio.registrar(f);
    expect(android.voltar()).toBe(true);
    expect(voltarDoRoteador).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
    expect(voltar).not.toHaveBeenCalled();
  });

  it('fora de foco, o Voltar segue o roteador', () => {
    const { bloqueio, android, voltarDoRoteador } = montar({ emFoco: false });
    const { f, aoTentarSair } = formulario(true);
    bloqueio.registrar(f);
    android.voltar();
    expect(voltarDoRoteador).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('um ouvinte da própria tela assinado depois (ex.: voltar uma aba interna) continua valendo antes do shell', () => {
    const { bloqueio, android } = montar();
    const { f, aoTentarSair } = formulario(true);
    bloqueio.registrar(f);
    const abaInterna = vi.fn(() => true);
    android.ouvir(abaInterna);
    android.voltar();
    expect(abaInterna).toHaveBeenCalledTimes(1);
    expect(aoTentarSair).not.toHaveBeenCalled();
  });

  it('desmontar retira o ouvinte do Voltar', () => {
    const { bloqueio, android } = montar();
    const antes = android.ouvintes.length;
    const retirar = bloqueio.registrar(formulario(true).f);
    expect(android.ouvintes.length).toBe(antes + 1);
    retirar();
    expect(android.ouvintes.length).toBe(antes);
  });

  it('dois formulários: só o último trata o Voltar', () => {
    const { bloqueio, android } = montar();
    const a = formulario(true);
    const b = formulario(true);
    bloqueio.registrar(b.f);
    bloqueio.registrar(a.f);
    android.voltar();
    expect(a.aoTentarSair).toHaveBeenCalledTimes(1);
    expect(b.aoTentarSair).not.toHaveBeenCalled();
  });
});
