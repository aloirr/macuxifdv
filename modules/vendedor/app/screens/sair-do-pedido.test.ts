import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as telas importam react-native e não rodam no Node: confere no fonte (mesmo padrão de telas-t0101.test.ts)
const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8');
const tela = fonte('new-order-screen.tsx');

describe('RN-VEN-38 (T-0128): as saídas do Novo pedido passam pela folha "Sair do pedido?"', () => {
  it('RN-VEN-38: Voltar do cabeçalho usa o VoltarDoFormulario que chama pedirSaida (não o BackLink direto)', () => {
    expect(tela).toContain('<VoltarDoFormulario rotulo="Voltar" onPress={() => pedirSaida(');
  });
  it('RN-VEN-38: botão Voltar do Android na aba Venda (a primeira) com o pedido alterado chama pedirSaida e consome o evento', () => {
    expect(tela).toMatch(/if \(anterior === null\) \{[\s\S]*?if \(!alterado\) return false;[\s\S]*?pedirSaidaRef\.current\([\s\S]*?return true;/);
  });
  it('RN-VEN-38: barra inferior e gesto do Android: a tela se registra no ponto de extensão do shell', () => {
    expect(tela).toContain('useBloquearSaida(alterado, (prosseguir) => pedirSaidaRef.current(prosseguir))');
  });
  it('RN-VEN-38: Cancelar do Resumo abre a folha quando alterado; na edição de pedido salvo abre a mesma folha com as opções da edição', () => {
    expect(tela).toContain('onCancelar={() => (editId ? pedirSaidaDaEdicao() : alterado ? pedirSaida(');
    expect(tela).toContain('edicao={editId ? opcoesDaSaidaEdicao(');
    expect(tela).not.toContain('Descartar este pedido?');
  });
  it('RN-VEN-38: sem alteração a saída é direta (sem pergunta)', () => {
    expect(tela).toMatch(/const pedirSaida = \(prosseguir: \(\) => void\) => \{\s*if \(!alterado\) \{\s*prosseguir\(\);\s*return;/);
  });
  it('RN-VEN-38 (RN-VEN-42): salvar com pendência fecha a folha, cancela a saída e abre o Resumo; os Alertas do topo dizem o que falta', () => {
    expect(tela).toMatch(/destinoDoSalvarDaSaida\(pendencias\.length\) === 'mostrar_pendencias'[\s\S]*?saidaPedida\.current = null;[\s\S]*?setAba\('resumo'\)/);
    expect(tela).not.toContain('anuncioPendencias');
    expect(tela).toContain('<AreaAlertas alertas={alertasDoTopo}');
  });
  it('RN-VEN-38: a folha usa as opções do domain (RN-VEN-13 sem Salvar pedido)', () => {
    expect(tela).toContain('opcoesDaSaida({ cliente: situacaoCliente');
  });
  it('RN-VEN-38: Continuar editando cancela a saída pedida e Descartar só apaga o rascunho pelo descartar()', () => {
    expect(tela).toMatch(/acao === 'continuar'\) \{\s*setSaidaAberta\(false\);\s*saidaPedida\.current = null;/);
    expect(tela).toMatch(/acao === 'descartar'\) \{\s*setSaidaAberta\(false\);\s*void descartar\(\);/);
  });
});

describe('RN-VEN-38 (T-0128): app fechado pelo sistema', () => {
  it('RN-VEN-38: o Início do Campo oferece a retomada (Continuar pedido de <cliente> ou Descartar) pelo card do Vendedor', () => {
    expect(fonte('../components/cards-inicio.tsx')).toContain('<RetomadaDoPedido />');
    const r = fonte('../components/retomada-do-pedido.tsx');
    expect(r).toContain('FolhaRetomarRascunho');
    expect(r).toContain('tituloDaRetomada(');
    expect(r).toContain('rascunhoParaRetomar(dados.rascunhos)');
    expect(r).toContain('limparRascunho(o.chave)');
  });
  it('RN-VEN-38: o rascunho é gravado a cada alteração no SQLite (atualizarRascunho -> guardarRascunho), sem aviso na tela', () => {
    const estado = fonte('../state/use-vendedor.ts');
    expect(estado).toMatch(/await repo\.guardarRascunho\(chave, novo\)/);
  });
});
