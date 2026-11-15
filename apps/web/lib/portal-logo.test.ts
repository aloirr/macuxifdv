/**
 * T-0182 — regras do cartão "Logo" do portal (spec docs/design/telas/logo-cliente.md §2): estados, botões por estado (o admin do
 * cliente não grava, RN-CORE-33), linha de baixo, frases exatas dos erros e a conferência do arquivo antes de enviar.
 */
import { MENSAGENS_LOGO } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { ErroPortal } from './portal-api';
import { altDaLogo, botoesDoCartao, erroDaGravacao, estadoDoCartao, linhaDeBaixo, nomeMudou, recusaDoArquivo, TEXTOS_LOGO } from './portal-logo';
import { ROTAS_PORTAL } from './portal-rotas';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

function pngFalso(largura: number, altura: number, tamanho = 33): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  return b;
}

describe('rotas da marca no portal', () => {
  it('relativas ao /v1, com o tenant no caminho', () => {
    expect(ROTAS_PORTAL.marcaDaEmpresa(TENANT)).toBe(`/plataforma/empresas/${TENANT}/marca`);
    expect(ROTAS_PORTAL.logoDaEmpresa(TENANT)).toBe(`/plataforma/empresas/${TENANT}/logo`);
  });
});

describe('estados e botões (spec §2)', () => {
  it('sem logo → Enviar logo; escolhido → Salvar e Cancelar; salvando → os dois desabilitados; salva → Trocar e Remover', () => {
    expect(botoesDoCartao(estadoDoCartao({ escolhido: false, salvando: false, temLogoSalva: false }), true)).toEqual(['enviar']);
    expect(botoesDoCartao(estadoDoCartao({ escolhido: true, salvando: false, temLogoSalva: false }), true)).toEqual(['salvar', 'cancelar']);
    expect(botoesDoCartao(estadoDoCartao({ escolhido: true, salvando: true, temLogoSalva: true }), true)).toEqual(['salvando', 'cancelar-desabilitado']);
    expect(botoesDoCartao(estadoDoCartao({ escolhido: false, salvando: false, temLogoSalva: true }), true)).toEqual(['trocar', 'remover']);
  });

  it('admin do cliente (só leitura): nenhum botão e sem a linha dos limites', () => {
    for (const temLogoSalva of [true, false]) expect(botoesDoCartao(estadoDoCartao({ escolhido: false, salvando: false, temLogoSalva }), false)).toEqual([]);
    expect(linhaDeBaixo(null, false)).toBeNull();
  });

  it('linha de baixo: os limites; com erro, o erro no lugar deles', () => {
    expect(linhaDeBaixo(null, true)).toEqual({ tipo: 'limites', texto: 'PNG ou JPG · até 1 MB · pelo menos 200 px de altura' });
    expect(linhaDeBaixo('Use um arquivo PNG ou JPG.', true)).toEqual({ tipo: 'erro', texto: 'Use um arquivo PNG ou JPG.' });
  });
});

describe('arquivo escolhido: a mesma conferência da API', () => {
  it('PNG de 600 × 240 passa', () => {
    expect(recusaDoArquivo(pngFalso(600, 240), 'image/png')).toBeNull();
  });
  it('frases exatas da spec', () => {
    expect(recusaDoArquivo(pngFalso(600, 240), 'image/svg+xml')).toBe('Use um arquivo PNG ou JPG.');
    expect(recusaDoArquivo(pngFalso(600, 240, 1_048_577), 'image/png')).toBe('O arquivo passa de 1 MB. Envie um menor.');
    expect(recusaDoArquivo(pngFalso(600, 199), 'image/png')).toBe('A imagem tem menos de 200 px de altura. Envie uma maior.');
    expect(recusaDoArquivo(pngFalso(5000, 300), 'image/png')).toBe(MENSAGENS_LOGO.LOGO_LADO_MAXIMO);
    // extensão .png com bytes de outra coisa
    expect(recusaDoArquivo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'image/png')).toBe('Use um arquivo PNG ou JPG.');
  });
});

describe('erro da gravação', () => {
  it('código da logo → a frase da spec e o arquivo sai (volta ao anterior)', () => {
    expect(erroDaGravacao(new ErroPortal(422, 'LOGO_ALTURA_MINIMA', 'x'))).toEqual({ mensagem: 'A imagem tem menos de 200 px de altura. Envie uma maior.', doArquivo: true });
    expect(erroDaGravacao(new ErroPortal(413, 'http_413', 'x'))).toEqual({ mensagem: 'O arquivo passa de 1 MB. Envie um menor.', doArquivo: true });
    expect(erroDaGravacao(new ErroPortal(415, 'http_415', 'x'))).toEqual({ mensagem: 'Use um arquivo PNG ou JPG.', doArquivo: true });
  });
  it('rota ausente → "Ainda não disponível neste servidor."', () => {
    expect(erroDaGravacao(new ErroPortal(404, 'NAO_ENCONTRADO', 'Route not found'))).toEqual({ mensagem: 'Ainda não disponível neste servidor.', doArquivo: false });
  });
  it('rede, 5xx, 503 e outros → "Não foi possível salvar. Tente de novo." (nunca o texto do servidor)', () => {
    for (const e of [new ErroPortal(0, 'sem_conexao', 'x'), new ErroPortal(500, 'ERRO', 'Internal'), new ErroPortal(503, 'ARMAZENAMENTO_INDISPONIVEL', 'x'), new Error('boom')])
      expect(erroDaGravacao(e)).toEqual({ mensagem: TEXTOS_LOGO.falhaSalvar, doArquivo: false });
  });
});

describe('textos de apoio', () => {
  it('alt "Logo da <nome fantasia>"; sem nome fantasia, a razão social', () => {
    expect(altDaLogo({ nome_fantasia: 'Exemplo Norte', razao_social: 'Distribuidora Exemplo Norte Ltda' })).toBe('Logo da Exemplo Norte');
    expect(altDaLogo({ nome_fantasia: null, razao_social: 'Distribuidora Exemplo Norte Ltda' })).toBe('Logo da Distribuidora Exemplo Norte Ltda');
  });
  it('nome fantasia mudou: espaços nas pontas não contam; vazio = apagar', () => {
    expect(nomeMudou('  Exemplo Norte ', 'Exemplo Norte')).toBe(false);
    expect(nomeMudou('', null)).toBe(false);
    expect(nomeMudou('', 'Exemplo Norte')).toBe(true);
    expect(nomeMudou('Norte', null)).toBe(true);
  });
});
