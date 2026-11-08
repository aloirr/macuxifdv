/**
 * T-0094 (RN-CORE-33/34; spec docs/design/ciclo-de-senha.md §1 a §3; desenho docs/desenho/T-0094.md §7 e §11): o que o shell do
 * app garante no ciclo de senha. As telas são do Core (`TelaCrieSuaSenha`, `TelaEsqueciSenha`); aqui, a ligação do shell.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { consumirAvisoPosLogin, guardarAvisoPosLogin } from './aviso-pos-login';

const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const login = fonte('../app/login.tsx');
const plataforma = fonte('../state/plataforma.tsx');

describe('"Senha criada." no Início, uma vez', () => {
  it('guardado na memória e lido uma vez só', () => {
    expect(consumirAvisoPosLogin()).toBeNull();
    guardarAvisoPosLogin('Senha criada.');
    expect(consumirAvisoPosLogin()).toBe('Senha criada.');
    expect(consumirAvisoPosLogin()).toBeNull();
  });
});

describe('nada abre antes da troca e a senha usada fica só na memória da tela', () => {
  it('"Crie sua senha" e "Esqueci a senha" moram na rota /login (sem rota nova do app) e só a troca concluída vai ao /sync', () => {
    expect(login).toMatch(/<TelaCrieSuaSenha/);
    expect(login).toMatch(/<TelaEsqueciSenha/);
    // a única navegação para dentro do app depois da troca é depois de `trocarSenha` resolver
    expect(login).toMatch(/await trocarSenha\([^)]*\);\s*guardarAvisoPosLogin\(AVISO_SENHA_CRIADA\);\s*router\.replace\('\/sync'\)/);
    expect(login).not.toMatch(/router\.(push|navigate)\(/);
  });
  it('a senha atual nunca vai a SecureStore, AsyncStorage, URL ou log', () => {
    for (const t of [login]) {
      expect(t).not.toMatch(/SecureStore\.|AsyncStorage\.|writeJson\(|gravarTokens\(/);
      expect(t).not.toMatch(/\bconsole\s*\./);
      expect(t).not.toMatch(/router\.\w+\([^)]*senha/);
    }
    // o shell só guarda os tokens da sessão que a troca devolve (como no login)
    expect(plataforma).not.toMatch(/writeJson\([^)]*senha/);
  });
  it('login e troca mandam o app da variante (RN-CORE-33)', () => {
    expect(plataforma).toMatch(/entrarComSenha\(post, campos, await aparelhoDoLogin\(\), variante\)/);
    expect(plataforma).toMatch(/trocarSenhaPeloApp\(post, dados, variante, await aparelhoDoLogin\(\)\)/);
  });
});

describe('401 depois de troca ou redefinição: volta ao login sem apagar a fila nem os dados locais (§7)', () => {
  it('refresh recusado chama o logout (que fecha o arquivo do usuário sem apagar), nunca a limpeza do aparelho', () => {
    const bloco = plataforma.slice(plataforma.indexOf('renovarRef.current = () =>'), plataforma.indexOf('const setApiUrl = useCallback('));
    expect(bloco).toMatch(/await logout\(\)/);
    expect(bloco).not.toMatch(/apagarBancosDoAparelho|apagarFotosLocais/);
    const sair = plataforma.slice(plataforma.indexOf('const logout = useCallback('), plataforma.indexOf('/** T-0088: "Tentar de novo"'));
    expect(sair).toMatch(/fecharArmazenamentoDoUsuario/);
    expect(sair).not.toMatch(/apagarBancosDoAparelho|apagarFotosLocais/);
  });
});
