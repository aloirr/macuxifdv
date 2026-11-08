/** T-0087 fatia E e T-0094 (sem convite, RN-CORE-34): regras puras da Equipe por CSV no portal. */
import { describe, expect, it } from 'vitest';

import { ehEmailIndisponivel, lerArquivoDaEquipe, MAX_LINHAS_EQUIPE, MENSAGEM_EQUIPE_SEM_EMAIL, textoDoResumo, textoDosAcessos } from './equipe-csv';
import { ErroPortal } from './portal-api';

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

describe('acessos enviados por e-mail (T-0094, spec ciclo-de-senha §6)', () => {
  it('singular, plural e nada com 0', () => {
    expect(textoDosAcessos(1)).toBe('1 acesso enviado por e-mail.');
    expect(textoDosAcessos(3)).toBe('3 acessos enviados por e-mail.');
    expect(textoDosAcessos(1200)).toBe('1.200 acessos enviados por e-mail.');
    expect(textoDosAcessos(0)).toBeNull();
  });
  it('503 EMAIL_INDISPONIVEL: reconhece o código e o texto diz que nada foi gravado', () => {
    expect(ehEmailIndisponivel(new ErroPortal(503, 'EMAIL_INDISPONIVEL', 'x'))).toBe(true);
    expect(ehEmailIndisponivel(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'))).toBe(false);
    expect(ehEmailIndisponivel(null)).toBe(false);
    expect(MENSAGEM_EQUIPE_SEM_EMAIL).toContain('nada foi gravado');
  });
});
