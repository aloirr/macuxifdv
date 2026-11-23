/**
 * v1.0.28 — rota do pré-cadastro de cliente no Campo: só vendedor, só variante campo, com `cliente.pre_cadastrar`;
 * o promotor e o Gestão nunca veem "Novo cliente" nem abrem o formulário (shell real do SDK, manifestos reais).
 */
import { criarShell, definirModuloShell, modulosEfetivos, type ModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';
import { CAMINHO_NOVO_CLIENTE, clienteIdDaRota, comPreCadastroCliente, hrefNovoCliente, podeNovoCliente } from './pre-cadastro-cliente';

const core = MANIFESTOS_INSTALADOS.find((m) => m.id === 'core')!;
const baseCore = definirModuloShell<string>({
  manifesto: core,
  paginas: [{ id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', apps: ['campo', 'gestao'], componente: 'lista-core' }],
});

const modulos = (m: ModuloShell<string>) => MANIFESTOS_INSTALADOS.map((x) => (x.id === 'core' ? m : definirModuloShell<string>({ manifesto: x, paginas: [] })));

function visao(variante: 'campo' | 'gestao', perfil: Perfil) {
  const shell = criarShell<string>(variante, modulos(comPreCadastroCliente(baseCore, { lista: 'lista-shell', formulario: 'form' })));
  const ids = MANIFESTOS_INSTALADOS.map((m) => m.id);
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant: ids, doPerfil: ids });
  return shell.montar({ perfil, modulosAtivos: ativos });
}

describe('pré-cadastro de cliente no shell', () => {
  it('vendedor no Campo abre o formulário e vê "Novo cliente"', () => {
    const v = visao('campo', 'vendedor');
    expect(v.pagina(CAMINHO_NOVO_CLIENTE)?.componente).toBe('form');
    expect(v.pagina('clientes')?.componente).toBe('lista-shell');
    expect(podeNovoCliente(v)).toBe(true);
  });

  it('promotor no Campo não abre o formulário nem vê "Novo cliente"', () => {
    const v = visao('campo', 'promotor');
    expect(v.pagina(CAMINHO_NOVO_CLIENTE)).toBeNull();
    expect(podeNovoCliente(v)).toBe(false);
  });

  it('Gestão não tem a rota nem o botão', () => {
    const v = visao('gestao', 'supervisor');
    expect(v.pagina(CAMINHO_NOVO_CLIENTE)).toBeNull();
    expect(podeNovoCliente(v)).toBe(false);
  });

  it('sem a tela do Core o módulo segue igual; a rota não duplica', () => {
    expect(comPreCadastroCliente(baseCore, {})).toBe(baseCore);
    const ligado = comPreCadastroCliente(baseCore, { formulario: 'form' });
    expect(comPreCadastroCliente(ligado, { formulario: 'outro' })).toBe(ligado);
    expect(ligado.paginas?.find((p) => p.id === 'clientes')?.componente).toBe('lista-core');
  });

  it('endereços e id da rota', () => {
    expect(hrefNovoCliente()).toBe('/m/cliente-novo');
    expect(hrefNovoCliente('a b')).toBe('/m/cliente-novo?id=a%20b');
    expect(clienteIdDaRota(['x', 'y'])).toBe('x');
    expect(clienteIdDaRota('')).toBeUndefined();
  });
});
