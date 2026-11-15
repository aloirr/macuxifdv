/**
 * "Trocar senha" no Perfil do Campo e do Gestão (v1.0.13; R-20261115-104500 e R-20261115-115500; RN-CORE-32 e RN-CORE-34;
 * spec docs/design/trocar-senha/spec.md, branch nuvem/trocar-senha-designer-ux).
 * Premissa: em 15/11/2026 nenhum branch tem a tela; o arquivo previsto segue o padrão das telas de acesso do Core
 * (tela-login, tela-esqueci-senha, tela-crie-sua-senha). O erro da troca no BKO já está em t0140-lote03-troca-senha-bko.test.ts.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROTA_ESQUECI_SENHA, ROTA_TROCAR_SENHA, TEXTOS_ESQUECI, trocaProntaParaEnviar } from '../../../modules/core/contracts';
import { describe, expect, it } from 'vitest';
import { validarSenhaNova } from '../../../modules/core/domain/acesso-senha';
import { existe, ler, RAIZ } from '../apoio/v1013';

const TELA = 'modules/core/app/components/tela-trocar-senha.tsx';
const COM_TELA = existe(TELA);

describe('Trocar senha — Perfil do Campo e do Gestão (RN-CORE-32, RN-CORE-34)', () => {
  if (!COM_TELA) {
    it('antes do PR: a tela não existe, e o que a spec reaproveita já está no Core (rotas, regra da senha, "Esqueci a senha")', () => {
      expect([ROTA_TROCAR_SENHA, ROTA_ESQUECI_SENHA]).toEqual(['/v1/auth/senha/trocar', '/v1/auth/senha/esqueci']);
      expect(trocaProntaParaEnviar('Forte@2026', 'Forte@2026')).toBe(true);
      expect(TEXTOS_ESQUECI).toBeDefined();
    });
    return;
  }

  it('a tela tem Senha atual, o link "Esqueci a senha" logo abaixo dela, Senha nova, Repita a senha e "Salvar senha"', () => {
    const tela = ler(TELA);
    const ordem = ['trocar-senha.atual', 'trocar-senha.esqueci', 'trocar-senha.nova', 'trocar-senha.repita', 'trocar-senha.salvar'].map((id) => tela.indexOf(id));
    expect(ordem.every((i) => i > -1)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(tela).toContain('Esqueci a senha');
  });

  it('antes de enviar, a tela usa a regra do Core (senha forte e repetição iguais), sem regra própria; nada da senha vai para armazenamento', () => {
    const tela = ler(TELA);
    expect(tela).toContain('trocaProntaParaEnviar(');
    expect(tela).toContain('faltasNaSenha(');
    expect(tela).not.toMatch(/AsyncStorage|SecureStore|enfileirar/);
    expect([trocaProntaParaEnviar('fraca', 'fraca'), trocaProntaParaEnviar('Forte@2026', 'Forte@2027')]).toEqual([false, false]);
  });

  it('RN-CORE-34: senha nova igual à atual é recusada com "A senha nova precisa ser diferente da atual."', () => {
    expect(validarSenhaNova('Forte@2026', 'ana@exemplo.com.br', true)?.mensagem).toBe('A senha nova precisa ser diferente da atual.');
  });

  it('os textos da spec §8 estão na tela ou nos contratos do Core (senha atual errada, sem internet, falha e sucesso)', () => {
    const contratos = readdirSync(join(RAIZ, 'modules/core/contracts')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const textos = [ler(TELA), ...contratos.map((f) => ler(`modules/core/contracts/${f}`))].join('\n');
    for (const t of ['Trocar senha', 'Senha atual', 'Salvar senha', 'Salvando…', 'A senha atual está errada. Digite de novo.', 'Conecte-se à internet para trocar a senha.', 'Não foi possível trocar agora. Tente de novo em alguns minutos.', 'Senha trocada.']) {
      expect(textos, t).toContain(t);
    }
  });
});
