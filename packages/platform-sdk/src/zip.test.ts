import { describe, expect, it } from 'vitest';
import { classificarEntradaZip, LIMITES_ZIP_TETO, type EntradaZip } from './zip';

const MB = 1024 * 1024;
const entrada = (caminho: string, e: Partial<EntradaZip> = {}): EntradaZip => ({
  indice: 0,
  caminho,
  pasta: caminho.endsWith('/'),
  metodo: 8,
  criptografada: false,
  compactado: 100_000,
  descompactado: 120_000,
  crc32: 0,
  ...e,
});
const classificar = (caminho: string, e: Partial<EntradaZip> = {}) => classificarEntradaZip(entrada(caminho, e), LIMITES_ZIP_TETO);

describe('RN-CAT-14 / ADR 0054 §3: classificação de cada entrada do ZIP', () => {
  it('foto comum é aceita pelo nome-base, mesmo dentro de pastas (nada é escrito a partir do nome)', () => {
    expect(classificar('A1.jpg')).toEqual({ acao: 'aceitar', nomeBase: 'A1.jpg' });
    expect(classificar('fotos/novas/A1_2.jpg')).toEqual({ acao: 'aceitar', nomeBase: 'A1_2.jpg' });
    expect(classificar('fotos\\win\\a1_3.webp')).toEqual({ acao: 'aceitar', nomeBase: 'a1_3.webp' });
  });

  it('path traversal: segmento .., caminho absoluto ou letra de unidade → recusado caminho_invalido', () => {
    for (const c of ['../x.jpg', 'a/../../x.jpg', '..\\x.jpg', '/etc/x.jpg', '\\x.jpg', 'C:/x.jpg', 'c:x.jpg'])
      expect(classificar(c)).toEqual({ acao: 'recusar', motivo: 'caminho_invalido' });
  });

  it('pastas, __MACOSX, ocultos, Thumbs.db e desktop.ini são ignorados (fora do relatório)', () => {
    for (const c of ['fotos/', '__MACOSX/._A1.jpg', '__macosx/x.jpg', '.DS_Store', 'fotos/.oculto/A1.jpg', 'fotos/._A1.jpg', 'THUMBS.DB', 'x/Desktop.ini'])
      expect(classificar(c)).toEqual({ acao: 'ignorar' });
  });

  it('caractere de controle no nome → caminho_invalido', () => {
    expect(classificar('A1\u0000.jpg')).toEqual({ acao: 'recusar', motivo: 'caminho_invalido' });
    expect(classificar('A1\n.jpg')).toEqual({ acao: 'recusar', motivo: 'caminho_invalido' });
  });

  it('criptografada e método diferente de stored/deflate são recusados', () => {
    expect(classificar('A1.jpg', { criptografada: true })).toEqual({ acao: 'recusar', motivo: 'criptografado' });
    expect(classificar('A1.jpg', { metodo: 12 })).toEqual({ acao: 'recusar', motivo: 'compressao_nao_suportada' });
    expect(classificar('A1.jpg', { metodo: 0, compactado: 500, descompactado: 500 }).acao).toBe('aceitar');
  });

  it('vazio, acima de 8 MB e razão de compressão acima de 20 (zip bomb) são recusados', () => {
    expect(classificar('A1.jpg', { descompactado: 0, compactado: 0 })).toEqual({ acao: 'recusar', motivo: 'arquivo_vazio' });
    expect(classificar('A1.jpg', { descompactado: 8 * MB + 1, compactado: 8 * MB })).toEqual({ acao: 'recusar', motivo: 'foto_grande' });
    expect(classificar('A1.jpg', { descompactado: 8 * MB, compactado: 8 * MB }).acao).toBe('aceitar');
    expect(classificar('A1.jpg', { descompactado: 2_100_000, compactado: 100_000 })).toEqual({ acao: 'recusar', motivo: 'compressao_suspeita' });
    expect(classificar('A1.jpg', { descompactado: 2_000_000, compactado: 100_000 }).acao).toBe('aceitar');
    expect(classificar('A1.jpg', { descompactado: 30, compactado: 0 })).toEqual({ acao: 'recusar', motivo: 'compressao_suspeita' });
  });

  it('os limites do tenant só baixam o teto (foto de 3 MB com teto de 2 MB → foto_grande)', () => {
    const r = classificarEntradaZip(entrada('A1.jpg', { descompactado: 3 * MB, compactado: 3 * MB }), { ...LIMITES_ZIP_TETO, bytesEntradaMax: 2 * MB });
    expect(r).toEqual({ acao: 'recusar', motivo: 'foto_grande' });
  });

  it('o teto da plataforma é o da RN-CAT-14: 500 MiB, 10 mil arquivos, 8 MiB por foto', () => {
    expect(LIMITES_ZIP_TETO).toMatchObject({ bytesZipMax: 500 * MB, arquivosMax: 10_000, bytesEntradaMax: 8 * MB, razaoMax: 20 });
  });
});
