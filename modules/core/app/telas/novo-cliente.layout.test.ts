import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ler = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const tela = ler('./novo-cliente.tsx');

describe('tela Novo cliente (pré-cadastro; RN-CORE-78 e RN-CORE-79)', () => {
  it('RN-CORE-78: o index do app exporta TelaNovoClientePreCadastro com aoConcluir e clienteId', () => {
    expect(ler('../index.ts')).toContain("export { TelaNovoClientePreCadastro, type PropsTelaNovoClientePreCadastro } from './telas/novo-cliente'");
    expect(tela).toMatch(/aoConcluir\?: \(\) => void;/);
    expect(tela).toMatch(/clienteId\?: string;/);
  });
  it('RN-CORE-78: o perfil é revalidado na tela e o promotor não vê o botão da lista', () => {
    expect(tela).toContain('podePreCadastrarCliente(perfil)');
    const lista = ler('./clientes.tsx');
    expect(lista).toContain('podePreCadastrarCliente(dados.perfil) ? aoNovoCliente : undefined');
    expect(lista).toContain('aoNovoCliente ? <Botao');
  });
  it('RN-CORE-79: salva pela fila do sync (lib), com o UUID do aparelho, e lê os obrigatórios do parâmetro local', () => {
    expect(tela).toContain('salvarPreCadastro(motor');
    expect(tela).toContain("motor.linhas<ParametroSync>('parametro')");
    expect(tela).toContain('crypto.randomUUID()');
  });
  it('RN-CORE-78: o recusado mostra "Corrigir e reenviar" na ficha, que reabre o formulário com o mesmo id', () => {
    const ficha = ler('./cliente.tsx');
    expect(ficha).toContain('ACAO_CORRIGIR_E_REENVIAR');
    expect(ficha).toContain('abrirNovoCliente(id)');
  });
});
