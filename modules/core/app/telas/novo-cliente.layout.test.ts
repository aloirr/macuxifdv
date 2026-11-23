import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ler = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const tela = ler('./novo-cliente.tsx');

describe('tela Novo cliente (pré-cadastro; RN-CORE-78 e RN-CORE-79)', () => {
  it('RN-CORE-78: o Core registra a página novo-cliente só no Campo, só para o vendedor, com a ação cliente.pre_cadastrar', () => {
    const index = ler('../index.ts');
    expect(index).toMatch(/id: 'novo-cliente', caminho: 'novo-cliente'[^}]*apps: \['campo'\], perfis: \['vendedor'\], acao: 'cliente\.pre_cadastrar'[^}]*PaginaNovoCliente/);
    expect(tela).toContain('PARAM_CLIENTE_ID');
    expect(tela).toMatch(/clienteId\?: string;/);
  });
  it('RN-CORE-78: sem usuário ou sem perfil de vendedor a tela não abre, e a lista decide o botão numa checagem só', () => {
    expect(tela).toContain('if (!perfil || !podePreCadastrarCliente(perfil)) return null;');
    expect(tela).not.toContain("?? 'vendedor'");
    const lista = ler('./clientes.tsx');
    expect(lista.match(/podePreCadastrarCliente\(/g)).toHaveLength(1);
    expect(lista).toContain('aoNovoCliente ? <Botao');
  });
  it('RN-CORE-79: salva pela fila do sync (lib), com o UUID do aparelho, e lê os obrigatórios do parâmetro local', () => {
    expect(tela).toContain('salvarPreCadastro(motor');
    expect(tela).toContain("motor.linhas<ParametroSync>('parametro')");
    expect(tela).toContain('crypto.randomUUID()');
  });
  it('RN-CORE-78: o recusado mostra "Corrigir e reenviar" na ficha, que reabre o formulário (o reenvio gera id novo, idDoReenvio)', () => {
    const ficha = ler('./cliente.tsx');
    expect(ficha).toContain('ACAO_CORRIGIR_E_REENVIAR');
    expect(ficha).toContain('abrirNovoCliente(id)');
    expect(ler('./novo-cliente.tsx')).toContain('idDoReenvio(situacao, clienteId');
  });
  it('RN-CORE-78: depois de salvar a correção volta à lista (replace), sem o id antigo, e sem o cadastro no aparelho a tela não reabre o formulário (spec §4)', () => {
    const salvar = tela.slice(tela.indexOf('salvo.current = true;\n    setAlterado(false);\n    avisarClienteSalvo'));
    expect(salvar).toContain('router.replace(ROTA_CLIENTES as never)');
    expect(salvar.split('\n').slice(0, 5).join('\n')).not.toContain('sair()');
    expect(tela).toContain('} else if (clienteId) {');
    expect(tela.slice(tela.indexOf('} else if (clienteId) {'))).toContain('router.replace(ROTA_CLIENTES as never)');
  });
  it('RN-CORE-78: o "Não enviado" também mostra "Corrigir e reenviar" na ficha, e o aviso do formulário só entra sem campo marcado', () => {
    expect(ler('./cliente.tsx')).toContain('ROTULO_PRE_CADASTRO_NAO_ENVIADO');
    expect(tela).toContain('rolarAtePrimeira(r.erros)) return;');
    expect(tela.match(/scrollTo\(/g)).toHaveLength(1);
    expect(tela).not.toContain('aoConcluir');
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
