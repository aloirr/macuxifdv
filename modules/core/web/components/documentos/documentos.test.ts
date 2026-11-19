/**
 * Parâmetros › Documentos (T-0186, RN-CORE-40): a matriz e as exceções, com a API simulada (cache preenchido).
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { criarApiSimulada, novoQueryClient, renderizar } from '../tarefas/api-simulada';
import { CHAVE_DOCUMENTOS, criarApiDocumentos } from './api';
import { DocumentosExcecoesPanel } from './excecoes-panel';
import { DocumentosPermissoesPanel } from './permissoes-panel';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const resposta = {
  tipos: [
    { id: T1, nome: 'Alvará de funcionamento', grupo: 'Cadastro', ordem: 1, origem: 'erp', permite_envio: false, ativo: true },
    { id: T2, nome: 'Fotos do PDV', grupo: 'Fotos', ordem: 2, origem: 'app', permite_envio: true, ativo: true },
  ],
  matriz: [{ tipo_id: T1, perfil: 'vendedor', nivel: 've' }],
  excecoes: [{ documento_id: D1, documento_nome: 'Contrato nº 112', cliente_id: C1, cliente_nome: 'Mercado Bom Preço', perfis: ['vendedor'] }],
};
const perfis = {
  itens: [
    { codigo: 'vendedor', nome: 'Vendedor', descricao: null, base: 'vendedor', fabrica: true, ativo: true, usuarios: 3, onde_entra: ['campo'], cargo: 'vendedor' },
    { codigo: 'admin', nome: 'Administrador', descricao: null, base: 'admin', fabrica: true, ativo: true, usuarios: 1, onde_entra: ['bko'], cargo: 'administrativo' },
  ],
};

function cache() {
  const qc = novoQueryClient();
  qc.setQueryData(CHAVE_DOCUMENTOS, resposta);
  qc.setQueryData(['core', 'documentos', 'colunas'], [{ codigo: 'vendedor', nome: 'Vendedor' }]);
  return qc;
}

describe('RN-CORE-40: Parâmetros › Documentos no BKO', () => {
  it('RN-CORE-40: a matriz mostra tipo, origem e "Vê e envia" só no tipo do app; salvar começa desligado', () => {
    const html = renderizar(createElement(DocumentosPermissoesPanel), ['documento.permissoes'], cache());
    expect(html).toContain('Alvará de funcionamento');
    expect(html).toContain('Origem: ERP');
    expect(html).toContain('Origem: App');
    expect(html.match(/Vê e envia/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="documentos.salvar"/);
    expect(html).not.toContain('Administrador');
  });

  it('RN-CORE-40: sem a ação documento.permissoes a matriz e as exceções não aparecem', () => {
    expect(renderizar(createElement(DocumentosPermissoesPanel), [], cache())).toBe('');
    expect(renderizar(createElement(DocumentosExcecoesPanel), [], cache())).toBe('');
  });

  it('RN-CORE-40/P11: a exceção mostra documento, cliente e quem vê (as colunas menos a exceção)', () => {
    const qc = cache();
    qc.setQueryData(['core', 'documentos', 'colunas'], [{ codigo: 'vendedor', nome: 'Vendedor' }, { codigo: 'gerente', nome: 'Gerente' }]);
    const html = renderizar(createElement(DocumentosExcecoesPanel), ['documento.permissoes'], qc);
    expect(html).toContain('A exceção só tira acesso do que o tipo libera.');
    expect(html).toContain('Contrato nº 112');
    expect(html).toContain('Mercado Bom Preço');
    expect(html).toContain('>Gerente<');
  });

  it('RN-CORE-40: as chamadas vão às rotas de permissões e exceções, e as colunas saem dos perfis do app', async () => {
    const api = criarApiSimulada({ 'GET /core/documentos/permissoes': resposta, 'PUT /core/documentos/permissoes': resposta, 'PUT /core/documentos/excecoes': {}, 'GET /core/perfis': perfis });
    const c = criarApiDocumentos(api.chamar);
    await c.ler();
    await c.salvarMatriz({ matriz: [{ tipo_id: T1, perfil: 'vendedor', nivel: 've' }] });
    await c.salvarExcecao({ documento_id: D1, perfis: [] });
    expect(await c.colunas()).toEqual([{ codigo: 'vendedor', nome: 'Vendedor' }]);
    expect(api.chamadas.map((x) => `${x.metodo} ${x.caminho}`)).toEqual(['GET /core/documentos/permissoes', 'PUT /core/documentos/permissoes', 'PUT /core/documentos/excecoes', 'GET /core/perfis']);
  });
});
