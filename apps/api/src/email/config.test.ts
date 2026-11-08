import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derivarChaveFila, descreverConfigEmail, lerConfigEmail, lerRemetente, REMETENTE_PADRAO } from './config';
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
  it('sem nada: transporte arquivo, remetente padrão, chave efêmera fora de produção', () => {
    const c = lerConfigEmail({});
    expect(c.transporte).toBe('arquivo');
    expect(c.remetente).toEqual(lerRemetente(REMETENTE_PADRAO));
    expect(c.origemChave).toBe('efemera');
    expect(c.chave).toHaveLength(32);
    expect(c.avisos.join(' ')).toContain('efêmera');
    expect(c.pasta).toContain('macuxi-email');
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
    expect(lerConfigEmail({ MACUXI_SMTP_HOST: 'h', MACUXI_EMAIL_TRANSPORTE: 'ARQUIVO', MACUXI_EMAIL_PASTA: '/tmp/x' })).toMatchObject({
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

describe('chave da fila (MACUXI_EMAIL_CHAVE / HKDF do MACUXI_JWT_SEGREDO)', () => {
  it('MACUXI_EMAIL_CHAVE em base64 ou hex (32 bytes)', () => {
    const bruta = randomBytes(32);
    expect(Buffer.from(lerConfigEmail({ MACUXI_EMAIL_CHAVE: bruta.toString('base64') }).chave)).toEqual(bruta);
    expect(Buffer.from(lerConfigEmail({ MACUXI_EMAIL_CHAVE: bruta.toString('hex') }).chave)).toEqual(bruta);
    expect(lerConfigEmail({ MACUXI_EMAIL_CHAVE: bruta.toString('base64') }).origemChave).toBe('MACUXI_EMAIL_CHAVE');
  });

  it('chave inválida: erro sem o valor', () => {
    const ruim = randomBytes(16).toString('base64');
    const e = erroDe(() => lerConfigEmail({ MACUXI_EMAIL_CHAVE: ruim }));
    expect(e.message).toContain('MACUXI_EMAIL_CHAVE');
    expect(e.message + JSON.stringify(e)).not.toContain(ruim);
  });

  it('sem chave: deriva do JWT por HKDF-SHA256 (determinística, diferente do segredo)', () => {
    const c = lerConfigEmail({ MACUXI_JWT_SEGREDO: SEGREDO_JWT, NODE_ENV: 'production' });
    expect(c.origemChave).toBe('MACUXI_JWT_SEGREDO');
    expect(Buffer.from(c.chave)).toEqual(Buffer.from(derivarChaveFila(SEGREDO_JWT)));
    expect(Buffer.from(c.chave).toString('utf8')).not.toContain(SEGREDO_JWT.slice(0, 8));
    expect(Buffer.from(derivarChaveFila('k'.repeat(40)))).not.toEqual(Buffer.from(c.chave));
  });

  it('produção sem chave nem JWT (ou JWT curto): falha fechada', () => {
    expect(erroDe(() => lerConfigEmail({ NODE_ENV: 'production' })).message).toContain('falha fechada');
    expect(erroDe(() => lerConfigEmail({ MACUXI_JWT_SEGREDO: 'curto' }, { producao: true })).message).toContain('falha fechada');
    // desligado não precisa de chave
    expect(lerConfigEmail({ NODE_ENV: 'production', MACUXI_EMAIL_TRANSPORTE: 'desligado' }).transporte).toBe('desligado');
  });
});

describe('descreverConfigEmail / toJSON — nunca usuário, senha nem chave', () => {
  it('só autenticado: true', () => {
    const chave = randomBytes(32);
    const c = lerConfigEmail({
      MACUXI_SMTP_HOST: 'smtp.exemplo.com',
      MACUXI_SMTP_USUARIO: USUARIO,
      MACUXI_SMTP_SENHA: SENHA,
      MACUXI_SMTP_REMETENTE: 'Macuxi <nao-responda@macuxifdv.com.br>',
      MACUXI_EMAIL_CHAVE: chave.toString('base64'),
    });
    const d = descreverConfigEmail(c);
    expect(d).toMatchObject({ transporte: 'smtp', host: 'smtp.exemplo.com', porta: 587, tls: 'starttls', autenticado: true, origem_chave: 'MACUXI_EMAIL_CHAVE' });
    expect(d.impressao_chave).toMatch(/^[0-9a-f]{8}$/);
    for (const texto of [JSON.stringify(d), JSON.stringify(c), JSON.stringify({ config: c })]) {
      expect(texto).not.toContain(USUARIO);
      expect(texto).not.toContain(SENHA);
      expect(texto).not.toContain(chave.toString('base64'));
      expect(texto).not.toContain(chave.toString('hex'));
    }
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
