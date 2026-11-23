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
  it('RN-VEN-38: a folha de descarte vale no voltar do Android e da barra (useBloquearSaida), no "Abrir" e depois de salvar não pergunta', () => {
    expect(tela).toContain('useBloquearSaida(alterado, pedirSaida)');
    expect(tela).toContain("pedirSaida(() => abrirCliente(duplicado.id, 'Clientes'))");
    expect(tela.indexOf('setAlterado(false);\n    avisarClienteSalvo()')).toBeGreaterThan(0);
  });
  it('RN-CORE-78: a rolagem mantém o toque com teclado aberto e o Salvar fica acima dele', () => {
    expect(tela).toContain('keyboardShouldPersistTaps="handled"');
    expect(tela.indexOf('<KeyboardAvoidingView')).toBeLessThan(tela.indexOf('novo-cliente-salvar'));
    expect(tela.indexOf('novo-cliente-salvar')).toBeLessThan(tela.indexOf('</KeyboardAvoidingView>'));
  });
  it('RN-CORE-78: o "Próximo" não quebra na UF: a Cidade fecha o teclado e a Inscrição é o último campo', () => {
    expect(tela).toMatch(/'cidade', 'Cidade', \{[^}]*returnKeyType: 'done'/);
    expect(tela).toMatch(/inscricao_estadual, \{ returnKeyType: 'done' \}/);
  });
});
