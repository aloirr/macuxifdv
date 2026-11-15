import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARQUIVOS_LOGO_EMAIL, derivarChaveEmail, descreverConfigEmail, lerConfigEmail, lerRemetente, REMETENTE_PADRAO } from './config';
import { ErroEmail } from './erros';

const SEGREDO_JWT = 'j'.repeat(40);
const USUARIO = 'conta.smtp@macuxifdv.com.br';
const SENHA = 'S3nha-do-SMTP-nao-vaza';

function erroDe(f: () => unknown): ErroEmail {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErroEmail);
    return e as ErroEmail;
  }
  throw new Error('esperava erro');
}

describe('lerConfigEmail — transporte e SMTP', () => {
  it('sem nada: desligado (sem adaptador: disponivel() = false), remetente padrão "Macuxi FDV"', () => {
    const c = lerConfigEmail({});
    expect(c.transporte).toBe('desligado');
    expect(c.remetente).toEqual(lerRemetente(REMETENTE_PADRAO));
    expect(c.remetente.nome).toBe('Macuxi FDV');
    expect(c.avisos.join(' ')).toContain('desligado');
  });

  it('MACUXI_EMAIL_ARQUIVO_DIR liga o adaptador de arquivo; sem segredo do JWT fora de produção, chave efêmera com aviso', () => {
    const c = lerConfigEmail({ MACUXI_EMAIL_ARQUIVO_DIR: '/tmp/caixa' });
    expect(c).toMatchObject({ transporte: 'arquivo', pasta: '/tmp/caixa', origemChave: 'efemera' });
    expect(c.chave).toHaveLength(32);
    expect(c.avisos.join(' ')).toContain('efêmera');
  });

  it('com host: smtp, porta 587, starttls', () => {
    const c = lerConfigEmail({ MACUXI_SMTP_HOST: 'smtp.exemplo.com', MACUXI_JWT_SEGREDO: SEGREDO_JWT });
    expect(c.transporte).toBe('smtp');
    expect(c.smtp).toMatchObject({ host: 'smtp.exemplo.com', porta: 587, tls: 'starttls', timeoutMs: 15_000 });
    expect(c.smtp?.credencial).toBeUndefined();
  });

  it('porta 465 ⇒ TLS implícito; MACUXI_SMTP_TLS=tls sem porta ⇒ 465; explícito vence', () => {
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_PORTA: '465' }).smtp).toMatchObject({ porta: 465, tls: 'tls' });
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_TLS: 'tls' }).smtp).toMatchObject({ porta: 465, tls: 'tls' });
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_PORTA: '2525', MACUXI_SMTP_TLS: 'nenhum' }).smtp).toMatchObject({
      porta: 2525,
      tls: 'nenhum',
    });
  });

  it('transporte explícito desligado/arquivo mesmo com host', () => {
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_EMAIL_TRANSPORTE: 'desligado' }).transporte).toBe('desligado');
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_EMAIL_TRANSPORTE: 'ARQUIVO', MACUXI_EMAIL_ARQUIVO_DIR: '/tmp/x' })).toMatchObject({
      transporte: 'arquivo',
      pasta: '/tmp/x',
    });
  });

  it('erros de configuração listam só nomes de variável', () => {
    const e = erroDe(() =>
      lerConfigEmail({ MACUXI_EMAIL_TRANSPORTE: 'pombo', MACUXI_SMTP_PORTA: 'abc', MACUXI_SMTP_REMETENTE: 'sem email' }),
    );
    expect(e.codigo).toBe('EMAIL_CONFIG_INVALIDA');
    expect(e.retentavel).toBe(false);
    expect(e.message).toContain('MACUXI_EMAIL_TRANSPORTE');
    expect(e.message).toContain('MACUXI_SMTP_REMETENTE');
    expect(erroDe(() => lerConfigEmail({ MACUXI_EMAIL_TRANSPORTE: 'smtp' })).message).toContain('MACUXI_SMTP_HOST obrigatório');
    expect(erroDe(() => lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_PORTA: '70000' })).message).toContain('MACUXI_SMTP_PORTA');
  });

  it('usuário sem senha (ou o contrário): erro sem o usuário', () => {
    const e = erroDe(() => lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_USUARIO: USUARIO }));
    expect(e.message).toContain('MACUXI_SMTP_USUARIO e MACUXI_SMTP_SENHA');
    expect(JSON.stringify(e)).not.toContain(USUARIO);
    const e2 = erroDe(() => lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_SENHA: SENHA }));
    expect(JSON.stringify(e2) + e2.message + e2.stack).not.toContain(SENHA);
  });

  it('credencial com TLS nenhum: recusada em produção, permitida (com aviso) fora', () => {
    const env = { MACUXI_SMTP_HOST: 'h', MACUXI_SMTP_TLS: 'nenhum', MACUXI_SMTP_USUARIO: USUARIO, MACUXI_SMTP_SENHA: SENHA, MACUXI_JWT_SEGREDO: SEGREDO_JWT };
    const e = erroDe(() => lerConfigEmail({ ...env, NODE_ENV: 'production' }));
    expect(e.message).toContain('recusada em produção');
    expect(e.message + JSON.stringify(e)).not.toContain(SENHA);
    expect(e.message + JSON.stringify(e)).not.toContain(USUARIO);
    const c = lerConfigEmail(env);
    expect(c.smtp?.permitirCredencialSemTls).toBe(true);
    expect(c.smtp?.credencial).toEqual({ usuario: USUARIO, senha: SENHA });
    expect(lerConfigEmail({ ...env, MACUXI_SMTP_TLS: 'starttls', NODE_ENV: 'production' }).smtp?.permitirCredencialSemTls).toBe(false);
  });
});

describe('chave da outbox (HKDF-SHA256 do MACUXI_JWT_SEGREDO, info macuxi.email_saida.v1; sem MACUXI_EMAIL_CHAVE)', () => {
  it('deriva do JWT (determinística, diferente do segredo e de outro segredo)', () => {
    const c = lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_JWT_SEGREDO: SEGREDO_JWT, NODE_ENV: 'production' });
    expect(c.origemChave).toBe('MACUXI_JWT_SEGREDO');
    expect(Buffer.from(c.chave)).toEqual(Buffer.from(derivarChaveEmail(SEGREDO_JWT)));
    expect(Buffer.from(c.chave).toString('utf8')).not.toContain(SEGREDO_JWT.slice(0, 8));
    expect(Buffer.from(derivarChaveEmail('k'.repeat(40)))).not.toEqual(Buffer.from(c.chave));
  });

  it('MACUXI_EMAIL_CHAVE não existe mais: ignorada', () => {
    const c = lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_JWT_SEGREDO: SEGREDO_JWT, MACUXI_EMAIL_CHAVE: randomBytes(32).toString('base64') });
    expect(Buffer.from(c.chave)).toEqual(Buffer.from(derivarChaveEmail(SEGREDO_JWT)));
  });

  it('produção sem JWT (ou JWT curto): falha fechada; desligado não precisa de chave', () => {
    expect(erroDe(() => lerConfigEmail({ NODE_ENV: 'production', MACUXI_SMTP_HOST: 'h' })).message).toContain('falha fechada');
    expect(erroDe(() => lerConfigEmail({ MACUXI_EMAIL_ARQUIVO_DIR: '/x', MACUXI_JWT_SEGREDO: 'curto' }, { producao: true })).message).toContain('falha fechada');
    expect(lerConfigEmail({ NODE_ENV: 'production' }).transporte).toBe('desligado');
  });
});

describe('descreverConfigEmail / toJSON — nunca usuário, senha nem chave', () => {
  it('só autenticado: true', () => {
    const c = lerConfigEmail({
      MACUXI_SMTP_HOST: 'smtp.exemplo.com',
      MACUXI_SMTP_USUARIO: USUARIO,
      MACUXI_SMTP_SENHA: SENHA,
      MACUXI_SMTP_REMETENTE: 'Macuxi <nao-responda@macuxifdv.com.br>',
      MACUXI_JWT_SEGREDO: SEGREDO_JWT,
    });
    const chave = Buffer.from(c.chave);
    const d = descreverConfigEmail(c);
    expect(d).toMatchObject({ transporte: 'smtp', host: 'smtp.exemplo.com', porta: 587, tls: 'starttls', autenticado: true, origem_chave: 'MACUXI_JWT_SEGREDO' });
    expect(d.impressao_chave).toMatch(/^[0-9a-f]{8}$/);
    for (const texto of [JSON.stringify(d), JSON.stringify(c), JSON.stringify({ config: c })]) {
      expect(texto).not.toContain(USUARIO);
      expect(texto).not.toContain(SENHA);
      expect(texto).not.toContain(chave.toString('base64'));
      expect(texto).not.toContain(chave.toString('hex'));
      expect(texto).not.toContain(SEGREDO_JWT);
    }
  });
});

describe('endereços públicos do e-mail (MACUXI_EMAIL_URL_ATIVOS, MACUXI_EMAIL_URL_BKO; ADR 0032, adendo de 15/11/2026)', () => {
  const ARQ = { MACUXI_EMAIL_ARQUIVO_DIR: '/tmp/caixa', MACUXI_JWT_SEGREDO: SEGREDO_JWT };

  it('sem as duas: apresentação vazia (e-mail sem logo, só o texto alternativo, e sem botão) e aviso do logo', () => {
    const c = lerConfigEmail(ARQ);
    expect(c.apresentacao).toEqual({});
    expect(c.avisos.join(' ')).toContain('MACUXI_EMAIL_URL_ATIVOS');
    expect(lerConfigEmail({}).avisos.join(' ')).not.toContain('MACUXI_EMAIL_URL_ATIVOS');
  });

  it('base dos ativos (com ou sem barra no fim) vira as URLs dos dois PNG; o endereço do BKO vai como veio', () => {
    expect(ARQUIVOS_LOGO_EMAIL).toEqual({ claro: 'macuxi-logo-positivo-email.png', escuro: 'macuxi-logo-negativo-email.png' });
    for (const base of ['https://bko.exemplo.com.br/email', 'https://bko.exemplo.com.br/email/']) {
      const c = lerConfigEmail({ ...ARQ, MACUXI_EMAIL_URL_ATIVOS: base, MACUXI_EMAIL_URL_BKO: 'https://bko.exemplo.com.br/' }, { producao: true });
      expect(c.apresentacao).toEqual({
        urlLogo: 'https://bko.exemplo.com.br/email/macuxi-logo-positivo-email.png',
        urlLogoEscuro: 'https://bko.exemplo.com.br/email/macuxi-logo-negativo-email.png',
        urlBackoffice: 'https://bko.exemplo.com.br/',
      });
      expect(c.avisos.join(' ')).not.toContain('MACUXI_EMAIL_URL_ATIVOS');
      expect(descreverConfigEmail(c)).toMatchObject({ url_ativos: 'https://bko.exemplo.com.br/email', url_bko: 'https://bko.exemplo.com.br/' });
    }
  });

  it('recusa endereço inválido, com credencial, fora de http(s) e http em produção', () => {
    const casos: [Record<string, string>, boolean, string][] = [
      [{ MACUXI_EMAIL_URL_ATIVOS: 'não é url' }, false, 'MACUXI_EMAIL_URL_ATIVOS'],
      [{ MACUXI_EMAIL_URL_BKO: 'ftp://bko.exemplo.com.br/' }, false, 'MACUXI_EMAIL_URL_BKO'],
      [{ MACUXI_EMAIL_URL_BKO: 'https://u:p@bko.exemplo.com.br/' }, false, 'MACUXI_EMAIL_URL_BKO'],
      [{ MACUXI_EMAIL_URL_ATIVOS: 'http://bko.exemplo.com.br/email' }, true, 'MACUXI_EMAIL_URL_ATIVOS'],
    ];
    for (const [env, producao, nome] of casos) {
      const e = erroDe(() => lerConfigEmail({ ...ARQ, ...env }, { producao }));
      expect(e.message, JSON.stringify(env)).toContain(nome);
      expect(e.message).not.toContain('u:p@');
    }
  });

  it('http fora de produção: aceito com aviso (demo local)', () => {
    const c = lerConfigEmail({ ...ARQ, MACUXI_EMAIL_URL_BKO: 'http://localhost:3000/' });
    expect(c.apresentacao.urlBackoffice).toBe('http://localhost:3000/');
    expect(c.avisos.join(' ')).toContain('MACUXI_EMAIL_URL_BKO sem https');
  });
});

describe('lerRemetente', () => {
  it('Nome <email>, "Nome" <email> e só o e-mail; CR/LF recusado', () => {
    expect(lerRemetente('Macuxi <Nao-Responda@Macuxifdv.com.br>')).toEqual({ nome: 'Macuxi', email: 'nao-responda@macuxifdv.com.br' });
    expect(lerRemetente('"Macuxi FDV" <x@y.com>')).toEqual({ nome: 'Macuxi FDV', email: 'x@y.com' });
    expect(lerRemetente('x@y.com')).toEqual({ email: 'x@y.com' });
    expect(lerRemetente('Macuxi <x@y.com>\r\nBcc: z@w.com')).toBeNull();
    expect(lerRemetente('não é e-mail')).toBeNull();
  });
});
