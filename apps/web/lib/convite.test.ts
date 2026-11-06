/** T-0087 fatia E: regras puras da Equipe por CSV no portal e do aceite do convite de 1º acesso (RN-CORE-31). */
import { describe, expect, it } from 'vitest';

import {
  conferirFormularioDoConvite,
  ehPaginaDeConvite,
  lerArquivoDaEquipe,
  linkDoConvite,
  MAX_LINHAS_EQUIPE,
  MENSAGEM_CONVITE_INVALIDO,
  origemDoBko,
  resultadoDoErroDeAceite,
  textoDoResumo,
  tokenDaUrl,
  tokenDoConvite,
} from './convite';

const TOKEN = `0b5f8f1e-3c55-4a0f-9a77-2f1d7c0c8b11.${'A'.repeat(43)}`;

describe('link do convite aponta para o BKO', () => {
  it('troca o host config. por bko. (produção e PC), mantendo esquema e porta', () => {
    expect(origemDoBko('https://config.macuxifdv.com.br')).toBe('https://bko.macuxifdv.com.br');
    expect(origemDoBko('http://config.localhost:3000')).toBe('http://bko.localhost:3000');
  });
  it('no próprio BKO usa a origem em uso', () => {
    expect(origemDoBko('https://bko-demo.macuxifdv.com.br')).toBe('https://bko-demo.macuxifdv.com.br');
    expect(origemDoBko('http://localhost:3000')).toBe('http://localhost:3000');
  });
  it('origem inválida ou de outro esquema: null (a API devolve só o caminho)', () => {
    expect(origemDoBko('')).toBeNull();
    expect(origemDoBko(null)).toBeNull();
    expect(origemDoBko('nada')).toBeNull();
    expect(origemDoBko('file:///c:/x')).toBeNull();
  });
  it('usa o link da API; sem ele, origem + caminho; sem origem, só o caminho', () => {
    expect(linkDoConvite({ link: 'https://bko.x/convite/a', caminho: '/convite/a' }, 'https://outro')).toBe('https://bko.x/convite/a');
    expect(linkDoConvite({ link: null, caminho: '/convite/a' }, 'https://bko.x')).toBe('https://bko.x/convite/a');
    expect(linkDoConvite({ link: null, caminho: '/convite/a' }, null)).toBe('/convite/a');
  });
});

describe('página pública /convite/<token>', () => {
  it('reconhece o caminho (o proxy manda no-referrer, no-store e noindex)', () => {
    expect(ehPaginaDeConvite('/convite')).toBe(true);
    expect(ehPaginaDeConvite(`/convite/${TOKEN}`)).toBe(true);
    expect(ehPaginaDeConvite('/Convite/x')).toBe(true);
    expect(ehPaginaDeConvite('/convites')).toBe(false);
    expect(ehPaginaDeConvite('/login')).toBe(false);
  });
  it('aceita o token no formato da API e recusa lixo', () => {
    expect(tokenDaUrl(TOKEN)).toBe(TOKEN);
    expect(tokenDaUrl(` ${TOKEN} `)).toBe(TOKEN);
    expect(tokenDaUrl('curto')).toBeNull();
    expect(tokenDaUrl(`${TOKEN}/x`)).toBeNull();
    expect(tokenDaUrl(`${TOKEN} x`)).toBeNull();
    expect(tokenDaUrl('a'.repeat(101))).toBeNull();
    expect(tokenDaUrl(undefined)).toBeNull();
  });
  it('confere só vazio e confirmação (a força é do Core)', () => {
    expect(conferirFormularioDoConvite('', '')).toEqual({ senha: 'Crie a sua senha.', confirmar: 'Digite a senha de novo para confirmar.' });
    expect(conferirFormularioDoConvite('abc12345', 'abc1234')).toEqual({ confirmar: 'As duas senhas não são iguais. Digite de novo.' });
    expect(conferirFormularioDoConvite('a', 'a')).toEqual({});
  });
  it('410 = convite inválido, mensagem única; 422 = motivo do Core', () => {
    expect(resultadoDoErroDeAceite(410, { codigo: 'CONVITE_INVALIDO', mensagem: 'qualquer' })).toEqual({ tipo: 'invalido' });
    expect(resultadoDoErroDeAceite(400, null)).toEqual({ tipo: 'invalido' });
    expect(resultadoDoErroDeAceite(422, { codigo: 'CONVITE_SENHA_FRACA', mensagem: 'A senha precisa ter letras e números.' })).toEqual({ tipo: 'senha', mensagem: 'A senha precisa ter letras e números.' });
    expect(resultadoDoErroDeAceite(422, { codigo: 'CONVITE_SENHA_FRACA', mensagem: '{"x":1}' }).tipo).toBe('senha');
    expect(resultadoDoErroDeAceite(429, null)).toMatchObject({ tipo: 'erro' });
    expect(resultadoDoErroDeAceite(0, null)).toMatchObject({ tipo: 'erro', mensagem: expect.stringContaining('Sem conexão') });
    expect(resultadoDoErroDeAceite(500, { mensagem: 'pilha' })).toMatchObject({ tipo: 'erro' });
    expect(MENSAGEM_CONVITE_INVALIDO).toMatch(/usado, venceu ou o link chegou incompleto/);
  });
});

describe('arquivo da Equipe', () => {
  const cab = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos';
  it('conta as pessoas sem o cabeçalho, ignorando BOM e linhas vazias', () => {
    expect(lerArquivoDaEquipe(`\uFEFF${cab}\r\nAna,ana@x.com,,supervisor,,,\r\n\r\nBia,bia@x.com,,vendedor,ana@x.com,,\r\n`)).toMatchObject({ ok: true, linhas: 2 });
  });
  it('recusa vazio, só cabeçalho e acima de 5.000 pessoas', () => {
    expect(lerArquivoDaEquipe('  ').ok).toBe(false);
    expect(lerArquivoDaEquipe(`${cab}\n`).ok).toBe(false);
    const grande = [cab, ...Array.from({ length: MAX_LINHAS_EQUIPE + 1 }, (_, i) => `P${i},p${i}@x.com,,vendedor,,,`)].join('\n');
    const r = lerArquivoDaEquipe(grande);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/5\.000/);
  });
  it('recusa acima de 2 MB', () => {
    const r = lerArquivoDaEquipe(`${cab}\n${'x'.repeat(2_000_001)}`);
    expect(r).toMatchObject({ ok: false, mensagem: expect.stringContaining('2 MB') });
  });
  it('resumo em uma frase, com singular e plural', () => {
    expect(textoDoResumo({ novos: 1, atualizados: 2, sem_mudanca: 0, com_erro: 0 })).toBe('1 nova · 2 atualizadas · 0 sem mudança · 0 com erro');
  });
});

describe('token do convite: fragmento, caminho ou aba (R-20261106-044125)', () => {
  it('o fragmento vale primeiro e o endereço é limpo', () => {
    expect(tokenDoConvite({ hash: `#${TOKEN}`, caminho: null, guardado: null })).toEqual({ token: TOKEN, limparEndereco: true });
    expect(tokenDoConvite({ hash: `#${encodeURIComponent(TOKEN)}`, caminho: 'outro', guardado: 'x' })).toEqual({ token: TOKEN, limparEndereco: true });
  });
  it('o caminho antigo continua aceito e também sai do endereço', () => {
    expect(tokenDoConvite({ hash: '', caminho: TOKEN, guardado: null })).toEqual({ token: TOKEN, limparEndereco: true });
  });
  it('F5 depois da limpeza: o token guardado na aba', () => {
    expect(tokenDoConvite({ hash: '', caminho: null, guardado: TOKEN })).toEqual({ token: TOKEN, limparEndereco: false });
  });
  it('sem token válido em lugar nenhum: null (tela de convite inválido)', () => {
    expect(tokenDoConvite({ hash: '#lixo', caminho: null, guardado: null })).toEqual({ token: null, limparEndereco: true });
    expect(tokenDoConvite({ hash: '', caminho: null, guardado: null })).toEqual({ token: null, limparEndereco: false });
  });
});
