/**
 * v1.0.10 — login e senha (PR #329 `nuvem/login-teclado-modulo-core` e `nuvem/senhas-iguais-designer-ux`).
 * Critérios: (a) o teclado não muda a senha nem o código da empresa; (b) `CampoSenha` com olho nas 3 telas do Core (login do
 * app, "Crie sua senha" e redefinição de senha no BKO); (c) "As duas senhas iguais" no checklist de senha.
 * Regras: RF-CORE-01 (login), RN-CORE-32 (regras da senha), RN-CORE-34 (Crie sua senha, redefinição). Spec: docs/design/campo-senha/spec.md.
 * Sem banco: roda local e no CI. Roteiro do aparelho: docs/testes/v1.0.10-roteiro-login-senha.md.
 * Ordem de merge: este teste valida o código dos dois branches acima; entra depois deles.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoginSenhaRequestSchema } from '@macuxi/core/contracts';
import { propsDeTecladoDaSenha } from '@macuxi/ui/mobile/puro';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { entrarComSenha, propsDoCampoCodigoEmpresa } from '../../modules/core/app/lib/login';
import { pedirSenhaTemporaria, trocarSenhaPeloApp } from '../../modules/core/app/lib/senha';
import { itemDaRepeticao, resumoComRepeticao, resumoDaTela } from '../../packages/ui/src/comum/senha';
import { CampoSenha } from '../../packages/ui/src/web/campo-senha';
import { RegrasDaSenha } from '../../packages/ui/src/web/senha';

const RAIZ = join(__dirname, '..', '..');
const fonte = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const U = '0b000000-0000-4000-8000-000000000001';
const SESSAO = {
  access_token: 'a.b.c',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: `${U}.segredo-segredo-segredo`,
  usuario: { id: U, nome: 'Vera', nome_curto: null, email: 'v@x.com', perfil: 'vendedor' },
  tenant: { id: U, codigo: 'AM2808', nome: 'Alfa', fuso: 'America/Manaus' },
};

/** Senhas que um teclado com autocorreção ou maiúscula automática estragaria: maiúscula no meio, acento, espaço no meio, símbolos. */
const SENHAS = ['aBc#1234', 'Açaí 2026!', 'tudo minúsculo 9$', 'MAIÚSCULA-9x', 'çÇãÃ~^`´ 1a!', 'senha.com.ponto1A'];

describe('v1.0.10 (a) — o teclado não muda a senha (RF-CORE-01, RN-CORE-32)', () => {
  it.each(['login', 'criacao'] as const)('A1. teclado de senha (%s): sem autocorreção, sem maiúscula, sem corretor', (finalidade) => {
    for (const visivel of [false, true]) {
      const p = propsDeTecladoDaSenha(visivel, finalidade, 'android');
      expect(p).toMatchObject({ autoCorrect: false, autoCapitalize: 'none', spellCheck: false, secureTextEntry: !visivel });
      expect(p.autoComplete).toBe(finalidade === 'criacao' ? 'new-password' : 'password');
      expect(p.textContentType).toBe(finalidade === 'criacao' ? 'newPassword' : 'password');
      // visível no Android: teclado sem sugestões (Gboard/Samsung não trocam a palavra)
      expect(p.keyboardType).toBe(visivel ? 'visible-password' : 'default');
    }
    expect(propsDeTecladoDaSenha(true, finalidade, 'ios').keyboardType).toBe('default');
  });

  it('A2. o CampoSenha do app aplica as props de teclado por último (a tela não consegue sobrescrever)', () => {
    const f = fonte('packages/ui/src/mobile/campo-senha-rn.tsx');
    const resto = f.indexOf('{...resto}');
    const teclado = f.indexOf('{...teclado}');
    expect(resto).toBeGreaterThan(0);
    expect(teclado).toBeGreaterThan(resto);
    expect(f).toMatch(/onChangeText=\{aoMudar\}/); // o valor digitado vai direto, sem transformação
  });

  it.each(SENHAS)('A3. login: a senha "%s" chega à API exatamente como digitada', async (senha) => {
    let corpo: Record<string, unknown> = {};
    await entrarComSenha(async (_c, b) => ((corpo = b as Record<string, unknown>), SESSAO), { codigo_empresa: 'AM2808', email: 'v@x.com', senha });
    expect(corpo.senha).toBe(senha);
  });

  it.each(SENHAS)('A4. Crie sua senha: senha atual e nova "%s" chegam à API sem mudança', async (senha) => {
    let corpo: Record<string, unknown> = {};
    await trocarSenhaPeloApp(async (_c, b) => ((corpo = b as Record<string, unknown>), SESSAO), { codigo_empresa: 'AM2808', email: 'v@x.com', senha_atual: senha, senha_nova: senha }, 'campo');
    expect(corpo.senha_atual).toBe(senha);
    expect(corpo.senha_nova).toBe(senha);
  });

  it('A5. campo Código da empresa: sem autocorreção nem corretor, no máximo 6 caracteres', () => {
    expect(propsDoCampoCodigoEmpresa).toMatchObject({ autoCorrect: false, spellCheck: false, maxLength: 6, autoCapitalize: 'characters' });
  });

  it.each([' am2808 ', 'aM2808', 'Am2808', 'AM2808', 'am2808 '])('A6. código "%s" chega à API como AM2808 (login e Esqueci a senha)', async (codigo) => {
    let login: Record<string, unknown> = {};
    await entrarComSenha(async (_c, b) => ((login = b as Record<string, unknown>), SESSAO), { codigo_empresa: codigo, email: 'v@x.com', senha: 'x' });
    expect(login.codigo_empresa).toBe('AM2808');
    let esqueci: Record<string, unknown> = {};
    await pedirSenhaTemporaria(async (_c, b) => void (esqueci = b as Record<string, unknown>), { codigo_empresa: codigo, email: 'v@x.com' });
    expect(esqueci.codigo_empresa).toBe('AM2808');
    // a API normaliza do mesmo jeito (APK antigo que mande minúsculas)
    expect(LoginSenhaRequestSchema.parse({ codigo_empresa: codigo, email: 'v@x.com', senha: 'x' }).codigo_empresa).toBe('AM2808');
  });

  it('A7. o contrato não mexe na senha (sem trim nem caixa): espaço no meio e maiúsculas ficam', () => {
    for (const senha of SENHAS) expect(LoginSenhaRequestSchema.parse({ codigo_empresa: 'AM2808', email: 'v@x.com', senha }).senha).toBe(senha);
  });
});

describe('v1.0.10 (b) — CampoSenha com olho nas 3 telas do Core', () => {
  it('B1. login do app: a senha usa o CampoSenha do kit, com olho e finalidade login; nada de TextInput de senha próprio', () => {
    const f = fonte('modules/core/app/components/tela-login.tsx');
    expect(f).toMatch(/<CampoSenha[\s\S]*?testIDOlho="login\.senha-olho"[\s\S]*?aoAlternar=/);
    expect(f).not.toMatch(/secureTextEntry/);
    expect(f).not.toMatch(/finalidade="criacao"/);
  });

  it('B2. Crie sua senha (app): os dois campos são CampoSenha de criação; um olho só, no campo de cima, e o mesmo estado para os dois', () => {
    const f = fonte('modules/core/app/components/tela-crie-sua-senha.tsx');
    const campos = f.match(/<CampoSenha[\s\S]*?\/>/g) ?? [];
    expect(campos).toHaveLength(2);
    for (const c of campos) {
      expect(c).toContain('finalidade="criacao"');
      expect(c).toContain('visivel={visivel}');
    }
    expect(campos[0]).toContain('testIDOlho="crie-senha.olho"');
    expect(campos[0]).toContain('aoAlternar=');
    expect(campos[1]).not.toContain('aoAlternar=');
    expect(f).not.toMatch(/secureTextEntry/);
  });

  it('B3. redefinição de senha no BKO: CampoSenha de criação com olho; o botão de texto "Mostrar senha" saiu', () => {
    const f = fonte('modules/core/web/components/usuarios/usuarios-page.tsx');
    expect(f).toMatch(/<CampoSenha[\s\S]*?finalidade="criacao"[\s\S]*?onAlternar=[\s\S]*?testId="usuarios\.senha-campo"/);
    expect(f).not.toContain('usuarios.senha-mostrar');
    expect(f).not.toMatch(/type=\{senhaVisivel \? 'text' : 'password'\}/);
  });

  it('B4. CampoSenha web: oculto = password + "Mostrar senha"; visível = text + "Ocultar senha"; sem corretor nem maiúscula', () => {
    const oculto = renderToStaticMarkup(CampoSenha({ id: 's', rotulo: 'Senha nova', visivel: false, onAlternar: () => {}, finalidade: 'criacao', testId: 'usuarios.senha-campo' }));
    expect(oculto).toContain('type="password"');
    expect(oculto).toContain('autoComplete="new-password"');
    expect(oculto).toContain('spellCheck="false"');
    expect(oculto).toContain('autoCapitalize="none"');
    expect(oculto).toContain('autoCorrect="off"');
    expect(oculto).toContain('aria-label="Mostrar senha"');
    const visivel = renderToStaticMarkup(CampoSenha({ id: 's', rotulo: 'Senha nova', visivel: true, onAlternar: () => {}, finalidade: 'criacao' }));
    expect(visivel).toContain('type="text"');
    expect(visivel).toContain('aria-label="Ocultar senha"');
    expect(visivel).not.toContain('Esconder');
  });
});

describe('v1.0.10 (c) — "As duas senhas iguais" no checklist (R-20261115-080000-alexandre)', () => {
  it('C1. o item tem o mesmo texto em todos os estados e a marca diz o estado', () => {
    expect(itemDaRepeticao('vazia')).toMatchObject({ texto: 'As duas senhas iguais', estado: 'falta' });
    expect(itemDaRepeticao('diferente')).toMatchObject({ texto: 'As duas senhas iguais', estado: 'falta' });
    expect(itemDaRepeticao('igual')).toMatchObject({ texto: 'As duas senhas iguais', estado: 'ok' });
    expect(itemDaRepeticao('diferente', true)?.estado).toBe('erro');
    expect(itemDaRepeticao('vazia', true)?.estado).toBe('erro');
    expect(itemDaRepeticao('igual', true)?.estado).toBe('ok');
    expect(itemDaRepeticao(undefined)).toBeNull();
  });

  it('C2. a frase falada usa ok/falta como as regras; os textos antigos sumiram', () => {
    expect(resumoComRepeticao(resumoDaTela(null), 'igual')).toBe('A senha atende às regras. As duas senhas iguais: ok.');
    expect(resumoComRepeticao(resumoDaTela('Falta um número.'), 'diferente')).toBe('Falta um número. As duas senhas iguais: falta.');
    const html = ['vazia', 'igual', 'diferente']
      .flatMap((r) => [false, true].map((d) => renderToStaticMarkup(RegrasDaSenha({ faltas: [], resumo: null, minimo: 8, repeticao: r as 'vazia', destacar: d, id: 'regras' }))))
      .join('\n');
    expect(html).toContain('As duas senhas iguais');
    expect(html).not.toMatch(/conferem|Repita a senha nova/);
  });

  it('C3. sem "Repita a senha" (redefinição no BKO, portal) o item não aparece', () => {
    const html = renderToStaticMarkup(RegrasDaSenha({ faltas: [], resumo: null, minimo: 8, id: 'regras' }));
    expect(html).not.toContain('As duas senhas iguais');
  });

  it('C4. Crie sua senha (app) passa a repetição ao checklist', () => {
    expect(fonte('modules/core/app/components/tela-crie-sua-senha.tsx')).toMatch(/<RegrasDaSenha[^>]*repeticao=\{repeticaoDaSenha\(nova, repetida\)\}/);
  });
});
