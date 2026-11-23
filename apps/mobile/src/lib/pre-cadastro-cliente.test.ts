/**
 * v1.0.28 — rota do pré-cadastro de cliente no Campo: só vendedor, só variante campo, com `cliente.pre_cadastrar`;
 * o promotor e o Gestão nunca abrem o formulário (shell real do SDK, manifestos reais). O endereço vem do Core; aqui
 * usa um endereço de teste para não repetir o dele.
 */
import { criarShell, definirModuloShell, modulosEfetivos, type ModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';
import { caminhoDaRota, clienteIdDaRota, comPreCadastroCliente } from './pre-cadastro-cliente';

const ROTA = '/m/formulario-teste';
const core = MANIFESTOS_INSTALADOS.find((m) => m.id === 'core')!;
const baseCore = definirModuloShell<string>({
  manifesto: core,
  paginas: [{ id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', apps: ['campo', 'gestao'], componente: 'lista-core' }],
});

const modulos = (m: ModuloShell<string>) => MANIFESTOS_INSTALADOS.map((x) => (x.id === 'core' ? m : definirModuloShell<string>({ manifesto: x, paginas: [] })));

function visao(variante: 'campo' | 'gestao', perfil: Perfil) {
  const shell = criarShell<string>(variante, modulos(comPreCadastroCliente(baseCore, { rota: ROTA, formulario: 'form' })));
  const ids = MANIFESTOS_INSTALADOS.map((m) => m.id);
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant: ids, doPerfil: ids });
  return shell.montar({ perfil, modulosAtivos: ativos });
}

describe('pré-cadastro de cliente no shell', () => {
  it('vendedor no Campo abre o formulário; a lista segue a do Core', () => {
    const v = visao('campo', 'vendedor');
    expect(v.pagina('formulario-teste')?.componente).toBe('form');
    expect(v.pagina('clientes')?.componente).toBe('lista-core');
  });

  it('promotor no Campo e o Gestão não têm a rota', () => {
    expect(visao('campo', 'promotor').pagina('formulario-teste')).toBeNull();
    expect(visao('gestao', 'supervisor').pagina('formulario-teste')).toBeNull();
  });

  it('sem a tela ou a rota do Core o módulo segue igual; a rota não duplica', () => {
    expect(comPreCadastroCliente(baseCore, { rota: ROTA })).toBe(baseCore);
    expect(comPreCadastroCliente(baseCore, { formulario: 'form' })).toBe(baseCore);
    const ligado = comPreCadastroCliente(baseCore, { rota: ROTA, formulario: 'form' });
    expect(comPreCadastroCliente(ligado, { rota: ROTA, formulario: 'outro' })).toBe(ligado);
  });

  it('caminho e id da rota', () => {
    expect(caminhoDaRota(ROTA)).toBe('formulario-teste');
    expect(caminhoDaRota('/x/formulario-teste')).toBeUndefined();
    expect(caminhoDaRota('/m/a/b')).toBeUndefined();
    expect(clienteIdDaRota(['x', 'y'])).toBe('x');
    expect(clienteIdDaRota('')).toBeUndefined();
  });
});
