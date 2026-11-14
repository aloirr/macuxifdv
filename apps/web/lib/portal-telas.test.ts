/** T-0087/T-0093: partes puras das telas do portal (entrada, formatos, aba Integração); a Nova empresa está em portal-planos.test.ts. */
import { describe, expect, it } from 'vitest';
import { ENTIDADES } from '@macuxi/integracao/contracts';

import { entidadesLivres } from '@/components/portal/aba-integracao';
import { mensagemDoLoginPortal, TEXTOS_ENTRAR } from '@/components/portal/tela-entrar';
import { ErroPortal, MENSAGEM_PORTAL_SEM_SEGREDOS, MENSAGEM_SEM_CONEXAO } from './portal-api';
import { codigoDaLicenca, FUSO_DA_UF, mascararCnpj, rotuloCurtoDoFuso, rotuloDoStatus, tomDaSituacao } from './portal-formato';
import { TEXTOS_ADMIN } from './portal-nova-empresa';

describe('entrada só com e-mail e senha (T-0093; spec portal-entrar §1 e §4)', () => {
  it('401: a mesma frase para e-mail inexistente, senha errada e conta sem empresa (nunca a da API)', () => {
    expect(mensagemDoLoginPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos. Confira e tente de novo.'))).toBe('E-mail ou senha incorretos.');
    expect(mensagemDoLoginPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'qualquer'))).toBe(TEXTOS_ENTRAR.credenciais);
  });
  it('423 (também para e-mail inexistente), 429, 503 e sem rede', () => {
    expect(mensagemDoLoginPortal(new ErroPortal(423, 'BLOQUEADO', 'Acesso bloqueado por tentativas erradas.'))).toBe('Muitas tentativas erradas. Espere 15 minutos e tente de novo.');
    expect(mensagemDoLoginPortal(new ErroPortal(429, 'LIMITE', 'x'))).toBe('Muitas tentativas deste endereço. Espere alguns minutos e tente de novo.');
    expect(mensagemDoLoginPortal(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'))).toBe(MENSAGEM_PORTAL_SEM_SEGREDOS);
    expect(mensagemDoLoginPortal(new ErroPortal(0, 'sem_conexao', MENSAGEM_SEM_CONEXAO))).toBe(MENSAGEM_SEM_CONEXAO);
  });
  it('textos da tela, sem convite, código de verificação, TOTP nem super-admin', () => {
    expect(TEXTOS_ENTRAR.esqueceu).toBe('Esqueceu a senha? Use "Esqueci a senha" no backoffice.');
    expect(TEXTOS_ENTRAR.vazio).toBe('Informe o e-mail e a senha.');
    for (const t of Object.values(TEXTOS_ENTRAR)) expect(t).not.toMatch(/convite|código de|6 dígitos|TOTP|autenticador|super-admin|2º fator/i);
  });
  it('T-0094: 403 SENHA_A_TROCAR manda criar a senha no backoffice (spec ciclo-de-senha §7), nunca a frase da API', () => {
    const e = new ErroPortal(403, 'SENHA_A_TROCAR', 'Antes de entrar no portal, crie a sua senha no backoffice com o código da empresa.');
    // spec portal-config-enxuto §1: sai a 2ª frase (RD-0264)
    expect(mensagemDoLoginPortal(e)).toBe('Crie a sua senha no backoffice antes de entrar aqui.');
    expect(TEXTOS_ADMIN.passeASenha).toBe('Passe esta senha ao administrador.');
  });
});

describe('textos do portal (revisão de UX R-20261106-023316)', () => {
  it('fuso e situação da empresa em rótulo', () => {
    expect(rotuloDoStatus('ativo')).toBe('Ativa');
    expect(rotuloDoStatus('suspenso')).toBe('Suspensa');
    expect(rotuloDoStatus('encerrado')).toBe('Encerrada');
    expect(rotuloDoStatus('novo')).toBe('Novo');
  });
  it('código da licença em maiúsculas, fuso curto e pela UF, tom da situação e máscara do CNPJ (spec portal-config-enxuto §5 e §11.2)', () => {
    expect(codigoDaLicenca('am4821')).toBe('AM4821');
    expect(rotuloCurtoDoFuso('America/Manaus')).toBe('Manaus (UTC−4)');
    expect(rotuloCurtoDoFuso('America/Sao_Paulo')).toBe('São Paulo (UTC−3)');
    expect(rotuloCurtoDoFuso('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(FUSO_DA_UF.AM).toBe('America/Manaus');
    expect(FUSO_DA_UF.RR).toBe('America/Boa_Vista');
    expect([tomDaSituacao('ativo'), tomDaSituacao('suspenso'), tomDaSituacao('encerrado')]).toEqual(['success', 'warning', 'neutral']);
    expect(mascararCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(mascararCnpj('112223')).toBe('11.222.3');
  });
});

describe('aba Integração', () => {
  it('bases livres: as que nenhum outro Conector ativo recebe', () => {
    const conectores = [
      { ativo: true, entidades: ['vendedor', 'cliente'] as const },
      { ativo: false, entidades: ['produto'] as const },
    ].map((c) => ({ ...c, entidades: [...c.entidades] }));
    const livres = entidadesLivres(conectores);
    expect(livres).toEqual(ENTIDADES.filter((e) => e !== 'vendedor' && e !== 'cliente'));
    // T-0089: as bases de pagamento e a escalonada também ficam livres para o Conector do ERP
    for (const e of ['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial', 'produto'] as const) expect(livres).toContain(e);
    expect(entidadesLivres([])).toEqual([...ENTIDADES]);
  });
});
