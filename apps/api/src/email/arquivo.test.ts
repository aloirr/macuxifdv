import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderizarEmail, renderizarEmailParaLog, renderizarEmailSemSenha, type EmailParaEnvio } from '@macuxi/platform-sdk';
import { capturarLog, cargaAcesso, decodificarPartes, destinatario, ID_ENVIO, relogio, vazamentos } from './apoio-teste';
import { carimboArquivo, criarTransporteArquivo } from './arquivo';

let pasta = '';
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'macuxi-email-teste-'));
});
afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

const msg: EmailParaEnvio = {
  idEnvio: ID_ENVIO,
  modelo: 'acesso_inicial',
  de: { email: 'nao-responda@macuxifdv.com.br', nome: 'Macuxi FDV' },
  para: destinatario,
  ...renderizarEmail('acesso_inicial', cargaAcesso),
  paraLog: renderizarEmailParaLog('acesso_inicial', cargaAcesso),
  semSenha: renderizarEmailSemSenha('acesso_inicial', cargaAcesso),
};

describe('transporte arquivo (caixa da demo)', () => {
  it('grava o .eml completo com nome <data>-<idEnvio>.eml e permissão 0600; log sem valor sensível', async () => {
    const cap = capturarLog();
    const pastaFilha = join(pasta, 'caixa');
    const r = await criarTransporteArquivo({ pasta: pastaFilha, log: cap.log, agora: relogio }).entregar(msg);
    expect(r.idMensagem).toBe(`<${ID_ENVIO}@macuxifdv.com.br>`);
    const arquivos = await readdir(pastaFilha);
    expect(arquivos).toEqual([`20261107T120000Z-${ID_ENVIO}.eml`]);
    const caminho = join(pastaFilha, arquivos[0]!);
    if (process.platform !== 'win32') {
      expect((await stat(caminho)).mode & 0o777).toBe(0o600);
      expect((await stat(pastaFilha)).mode & 0o777).toBe(0o700);
    }
    const eml = await readFile(caminho, 'utf8');
    expect(eml).toContain('Subject: Seu acesso ao Macuxi');
    expect(decodificarPartes(eml).texto).toContain('Senha temporária: Prov1sor1a-Xq7');

    expect(cap.linhas).toHaveLength(1);
    const linha = cap.linhas[0]!;
    expect(linha.obj).toMatchObject({ email_id: ID_ENVIO, modelo: 'acesso_inicial', arquivo: caminho, transporte: 'arquivo' });
    expect(String(linha.obj.corpo)).toContain('Senha temporária: ********');
    expect(String(linha.obj.corpo)).toContain('E-mail: [e-mail]');
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('mascararSenha: o arquivo sai sem a senha, com nome e login reais', async () => {
    const cap = capturarLog();
    await criarTransporteArquivo({ pasta, log: cap.log, agora: relogio, mascararSenha: true }).entregar(msg);
    const [arquivo] = await readdir(pasta);
    const eml = await readFile(join(pasta, arquivo!), 'utf8');
    const { texto, html } = decodificarPartes(eml);
    expect(texto).toContain('Senha temporária: ********');
    expect(texto).toContain('E-mail: joaquina.teste@exemplo.com.br');
    expect(texto + html + eml).not.toContain('Prov1sor1a-Xq7');
    expect(cap.linhas[0]!.obj.senha_mascarada_no_arquivo).toBe(true);
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('carimbo do arquivo sem ":" (Windows)', () => {
    expect(carimboArquivo(new Date('2026-11-07T03:04:05.678Z'))).toBe('20261107T030405Z');
  });
});
