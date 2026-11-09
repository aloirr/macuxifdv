/**
 * T-0094 (RN-CORE-32/33/34; spec docs/design/ciclo-de-senha.md §1 a §3): ciclo de senha no login do BKO. RD-0019/RD-0020: as
 * peças puras e os textos são os da fonte única do Core (`@macuxi/core/contracts`); aqui se confere que servem ao erro do SDK
 * web (`code`/`details` do `ApiRequestError`) e o que é só do BKO.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  detalhesDaTroca,
  MENSAGEM_ESQUECI_SENHA,
  repeticaoDaSenha,
  subtituloDaTroca,
  TEXTOS_CRIE_SENHA,
  TEXTOS_ESQUECI,
  TEXTOS_LOGIN_SENHA,
  textoDeMuitosPedidos,
  trocaProntaParaEnviar,
  validarEsqueci,
} from '@macuxi/core/contracts';
import { ApiRequestError } from '@macuxi/platform-sdk/web';

import {
  aoPerfilSemBko,
  avisarSePerfilSemBko,
  consumirAvisoDoLogin,
  ehPerfilSemBko,
  guardarAvisoDoLogin,
  mensagemDoEsqueci,
  mensagemSemBko,
  resultadoDoErroDaTroca,
  TEXTOS_LINK_ANTIGO,
} from './ciclo-senha';
import { mensagemDoLogin } from './login';

const erro = (status: number, code: string, details?: Record<string, unknown>, message = 'x') => new ApiRequestError(status, code, message, details);

describe('login: 403 SENHA_A_TROCAR leva à "Crie sua senha" (nada abre antes)', () => {
  it('lê o motivo; outro erro = null (fica no login)', () => {
    expect(detalhesDaTroca(erro(403, 'SENHA_A_TROCAR', { motivo: 'primeiro_acesso', expira_em: null }))).toEqual({ motivo: 'primeiro_acesso', expira_em: null });
    expect(detalhesDaTroca(erro(403, 'SENHA_A_TROCAR', { motivo: 'senha_temporaria', expira_em: '2026-11-10T12:00:00.000Z' }))?.motivo).toBe('senha_temporaria');
    // detalhe estranho: ainda é troca (motivo genérico)
    expect(detalhesDaTroca(erro(403, 'SENHA_A_TROCAR', { lixo: 1 }))).toEqual({ motivo: 'senha_temporaria', expira_em: null });
    expect(detalhesDaTroca(erro(403, 'PERFIL_FORA_DO_APP'))).toBeNull();
    expect(detalhesDaTroca(erro(401, 'CREDENCIAIS_INVALIDAS'))).toBeNull();
    expect(detalhesDaTroca(null)).toBeNull();
  });
  it('subtítulo pelo motivo (§2)', () => {
    expect(subtituloDaTroca('primeiro_acesso')).toBe('É o seu primeiro acesso. Crie uma senha só sua para continuar.');
    expect(subtituloDaTroca('senha_temporaria')).toBe('Você entrou com uma senha temporária. Crie uma senha nova para continuar.');
  });
  it('410 vencida e 403 PERFIL_FORA_DO_APP com os textos do §1 (o do perfil vem da API)', () => {
    expect(mensagemDoLogin(erro(410, 'SENHA_TEMPORARIA_VENCIDA'))).toBe(TEXTOS_LOGIN_SENHA.senhaVencida);
    expect(TEXTOS_LOGIN_SENHA.senhaVencida).toBe('Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.');
    const fora = 'O perfil supervisor não usa o backoffice (web). Entre pelo app Macuxi Gestão.';
    expect(mensagemDoLogin(erro(403, 'PERFIL_FORA_DO_APP', undefined, fora))).toBe(fora);
    expect(mensagemDoLogin(erro(403, 'PERFIL_FORA_DO_APP', undefined, '{"x":1}'))).toBe('Seu perfil não tem acesso ao backoffice.');
  });
});

describe('"Crie sua senha" (§2)', () => {
  it('repetição comparada na tela; só envia com a regra cumprida e as duas iguais', () => {
    expect(repeticaoDaSenha('Abc#1234', '')).toBe('vazia');
    expect(repeticaoDaSenha('Abc#1234', 'Abc#1234')).toBe('igual');
    expect(repeticaoDaSenha('Abc#1234', 'Abc#123')).toBe('diferente');
    expect(trocaProntaParaEnviar('Abc#1234', 'Abc#1234')).toBe(true);
    expect(trocaProntaParaEnviar('Abc#1234', 'Abc#12345')).toBe(false);
    expect(trocaProntaParaEnviar('abc12345', 'abc12345')).toBe(false);
    expect(trocaProntaParaEnviar('', '')).toBe(false);
  });
  it('tabela de erros da API', () => {
    expect(resultadoDoErroDaTroca(erro(422, 'RN-CORE-32', { faltas: ['numero'] }), 'Abcdef#g')).toEqual({ acao: 'destacar', mensagem: 'Falta um número.' });
    expect(resultadoDoErroDaTroca(erro(422, 'RN-CORE-32'), 'ana@x.com.br1#')).toEqual({ acao: 'destacar', mensagem: 'A senha não pode ser igual ao e-mail.' });
    expect(resultadoDoErroDaTroca(erro(422, 'RN-CORE-34'), 'x')).toEqual({ acao: 'limpar', mensagem: 'A senha nova precisa ser diferente da senha que você recebeu.' });
    expect(resultadoDoErroDaTroca(erro(401, 'CREDENCIAIS_INVALIDAS'), 'x')).toEqual({ acao: 'login', mensagem: 'Esta senha não vale mais. Entre de novo.' });
    expect(resultadoDoErroDaTroca(erro(410, 'SENHA_TEMPORARIA_VENCIDA'), 'x')).toEqual({ acao: 'login', mensagem: TEXTOS_LOGIN_SENHA.senhaVencida });
    expect(resultadoDoErroDaTroca(erro(423, 'USUARIO_BLOQUEADO'), 'x')).toEqual({ acao: 'login', mensagem: mensagemDoLogin(erro(423, 'USUARIO_BLOQUEADO')) });
    expect(resultadoDoErroDaTroca(erro(429, 'MUITAS_TENTATIVAS'), 'x').acao).toBe('login');
    expect(resultadoDoErroDaTroca(erro(403, 'PERFIL_FORA_DO_APP', undefined, 'O perfil vendedor não usa o backoffice (web).'), 'x')).toEqual({ acao: 'login', mensagem: 'O perfil vendedor não usa o backoffice (web).' });
    expect(resultadoDoErroDaTroca(erro(0, 'network'), 'x')).toEqual({ acao: 'fica', mensagem: 'Conecte-se à internet para criar a sua senha.' });
    expect(resultadoDoErroDaTroca(erro(500, 'ERRO_INTERNO'), 'x').acao).toBe('fica');
  });
  it('textos sem variação; nunca "token", "convite", "hash" nem "sessão revogada"', () => {
    expect(TEXTOS_CRIE_SENHA).toMatchObject({ titulo: 'Crie sua senha', salvar: 'Salvar e entrar', salvando: 'Salvando…', voltar: 'Voltar ao login', criada: 'Senha criada.' });
    const todos = [...Object.values(TEXTOS_CRIE_SENHA), ...Object.values(TEXTOS_ESQUECI), ...Object.values(TEXTOS_LOGIN_SENHA), ...Object.values(TEXTOS_LINK_ANTIGO)];
    for (const t of todos) expect(t).not.toMatch(/token|convite|hash|sess(ão|ões) revogad|TOTP|superfície/i);
  });
});

describe('"Esqueci a senha" (§3)', () => {
  it('confirmação sempre igual (a mesma frase do Core), sem o e-mail digitado', () => {
    expect(TEXTOS_ESQUECI.confirmacao).toBe(MENSAGEM_ESQUECI_SENHA);
    expect(TEXTOS_ESQUECI.confirmacao).not.toMatch(/@|Enviamos para/);
  });
  it('validação antes de enviar (validarEsqueci do Core, por campo; a tela mostra a do primeiro campo)', () => {
    expect(validarEsqueci({ codigo_empresa: '', email: 'a@b.com' })).toEqual({ codigo_empresa: 'Informe o código da empresa e o e-mail.' });
    expect(validarEsqueci({ codigo_empresa: 'alfa', email: ' ' })).toEqual({ email: 'Informe o código da empresa e o e-mail.' });
    expect(validarEsqueci({ codigo_empresa: 'alfa', email: 'ab.com' })).toEqual({ email: 'Informe um e-mail válido, como nome@empresa.com.br.' });
    expect(validarEsqueci({ codigo_empresa: 'alfa', email: 'a@b.com' })).toEqual({});
  });
  it('erros: 429 em minutos (mínimo 1), sem rede, 5xx; 400 = a mesma confirmação (não revela nada)', () => {
    expect(mensagemDoEsqueci(erro(429, 'MUITAS_TENTATIVAS', { retry_after_s: 61 }))).toBe('Muitos pedidos seguidos. Tente de novo em 2 minutos.');
    expect(mensagemDoEsqueci(erro(429, 'MUITAS_TENTATIVAS', { retry_after_s: 5 }))).toBe('Muitos pedidos seguidos. Tente de novo em 1 minuto.');
    expect(textoDeMuitosPedidos(undefined)).toBe('Muitos pedidos seguidos. Tente de novo em 1 minuto.');
    expect(mensagemDoEsqueci(erro(0, 'network'))).toBe('Conecte-se à internet para pedir uma senha temporária.');
    expect(mensagemDoEsqueci(erro(503, 'x'))).toBe('Não foi possível pedir agora. Tente de novo em alguns minutos.');
    expect(mensagemDoEsqueci(erro(400, 'VALIDACAO'))).toBeNull();
  });
});

describe('RN-CORE-33: 403 PERFIL_SEM_BKO durante o uso encerra a sessão', () => {
  it('reconhece só o 403 com o código do SDK', () => {
    expect(ehPerfilSemBko(erro(403, 'PERFIL_SEM_BKO'))).toBe(true);
    expect(ehPerfilSemBko(erro(403, 'PERFIL_SEM_ACESSO'))).toBe(false);
    expect(ehPerfilSemBko(erro(401, 'PERFIL_SEM_BKO'))).toBe(false);
  });
  it('o ouvinte do shell é chamado uma vez por erro; cancelado, não é mais', () => {
    const f = vi.fn();
    const cancelar = aoPerfilSemBko(f);
    expect(avisarSePerfilSemBko(erro(500, 'x'))).toBe(false);
    expect(avisarSePerfilSemBko(erro(403, 'PERFIL_SEM_BKO'))).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    cancelar();
    avisarSePerfilSemBko(erro(403, 'PERFIL_SEM_BKO'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('aviso do Entrar: o texto do SDK pelo perfil da sessão; sem perfil, a frase da spec; aparece uma vez', () => {
    expect(mensagemSemBko('vendedor')).toBe('O perfil vendedor não usa o backoffice (web). Entre pelo app Macuxi Campo.');
    expect(mensagemSemBko(null)).toBe('Seu perfil não tem acesso ao backoffice.');
    guardarAvisoDoLogin('x');
    expect(consumirAvisoDoLogin()).toBe('x');
    expect(consumirAvisoDoLogin()).toBeNull();
  });
});

describe('a senha nunca vai a storage, URL ou log (conferência do código das telas)', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const telas = { login: fonte('../components/login-screen.tsx'), ciclo: fonte('../components/ciclo-senha.tsx'), lib: fonte('./ciclo-senha.ts') };
  it('só o código da empresa vai ao localStorage; nada vai ao sessionStorage; nada de console', () => {
    for (const [nome, t] of Object.entries(telas)) {
      expect({ nome, sessionStorage: /sessionStorage\s*\./.test(t) }).toEqual({ nome, sessionStorage: false });
      expect({ nome, console: /\bconsole\s*\./.test(t) }).toEqual({ nome, console: false });
      const gravacoes = [...t.matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1]?.trim());
      expect(gravacoes.every((k) => k === 'CHAVE_CODIGO_EMPRESA')).toBe(true);
    }
  });
  it('a troca leva a senha atual só no corpo do POST (nunca em query nem no endereço)', () => {
    expect(telas.login).toMatch(/senha_atual: troca\.senha/);
    expect(telas.login).not.toMatch(/router\.(push|replace)\([^)]*senha/);
    expect(telas.login).not.toMatch(/query:\s*\{[^}]*senha/);
  });
});

describe('RD-0019/RD-0020: sem cópia das peças do Core no BKO', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('lib/ciclo-senha.ts e lib/login.ts não definem textos, validações nem a regex de e-mail; importam do Core', () => {
    for (const rel of ['./ciclo-senha.ts', './login.ts']) {
      const t = fonte(rel);
      expect(t).not.toMatch(/EMAIL_RE|CODIGO_RE|export const TEXTOS_(CRIE_SENHA|ESQUECI|LOGIN_SENHA)|export function (detalhesDaTroca|validarEsqueci|validarCampos|textoDeMuitosPedidos)/);
      expect(t).toContain("from '@macuxi/core/contracts'");
    }
    expect(fonte('../components/login-screen.tsx')).toMatch(/validarLogin\(campos\)/);
  });
});
