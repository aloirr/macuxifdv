import { afterEach, describe, expect, it } from 'vitest';
import { renderizarEmail, type EmailParaEnvio } from '@macuxi/platform-sdk';
import { cargaAcesso, criarSmtpFalso, dadosAcesso, decodificarPartes, destinatario, ID_ENVIO, portaFechada, relogio, TLS_TESTE, vazamentos, type SmtpFalso } from './apoio-teste';
import { ErroEmail } from './erros';
import { criarTransporteSmtp, enviarSmtp, type OpcoesClienteSmtp } from './smtp';

const USUARIO = 'conta.smtp@macuxifdv.com.br';
const SENHA = 'S3nha-do-SMTP-nao-vaza';

const msg: EmailParaEnvio = {
  idEnvio: ID_ENVIO,
  modelo: 'acesso_inicial',
  de: { email: 'nao-responda@macuxifdv.com.br', nome: 'Macuxi' },
  para: destinatario,
  ...renderizarEmail('acesso_inicial', cargaAcesso),
};

let servidor: SmtpFalso | null = null;
afterEach(async () => {
  await servidor?.fechar();
  servidor = null;
});

function opcoes(porta: number, extra: Partial<OpcoesClienteSmtp> = {}): OpcoesClienteSmtp {
  return { host: '127.0.0.1', porta, tls: 'nenhum', timeoutMs: 2_000, permitirCredencialSemTls: true, nomeHelo: 'teste.local', ...extra };
}

async function erroDe(p: Promise<unknown>): Promise<ErroEmail> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroEmail);
    return e as ErroEmail;
  }
  throw new Error('esperava erro');
}

/** Nada sensível (destinatário, senha do e-mail, credencial SMTP) na mensagem, na pilha ou no JSON do erro. */
function erroSeguro(e: ErroEmail): void {
  const texto = `${e.message}\n${e.stack ?? ''}\n${JSON.stringify(e)}`;
  expect(vazamentos(texto, [destinatario.email, destinatario.nome, dadosAcesso.senha, USUARIO, SENHA])).toEqual([]);
}

describe('cliente SMTP contra servidor falso (127.0.0.1)', () => {
  it('fluxo feliz com AUTH PLAIN em tls "nenhum" fora de produção', async () => {
    servidor = await criarSmtpFalso();
    const t = criarTransporteSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA } }), { agora: relogio });
    const r = await t.entregar(msg);
    expect(r.idMensagem).toBe(`<${ID_ENVIO}@macuxifdv.com.br>`);
    expect(servidor.comandos).toEqual([
      'EHLO teste.local',
      'AUTH PLAIN ***',
      'MAIL FROM:<nao-responda@macuxifdv.com.br>',
      `RCPT TO:<${destinatario.email}>`,
      'DATA',
      '<dados>',
      'QUIT',
    ]);
    expect(servidor.auths).toEqual([{ usuario: USUARIO, senha: SENHA }]);
    const recebida = servidor.mensagens[0]!;
    expect(recebida).toContain('Subject: Seu acesso ao Macuxi');
    expect(recebida).toContain('Date: Sat, 07 Nov 2026 12:00:00 +0000');
    expect(decodificarPartes(recebida).texto).toContain('Senha temporária: Prov1sor1a-Xq7');
  });

  it('AUTH LOGIN quando o servidor só anuncia LOGIN', async () => {
    servidor = await criarSmtpFalso({ extensoes: ['AUTH LOGIN'] });
    await enviarSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA } }), { de: 'a@b.com', para: 'c@d.com' }, 'Subject: x\r\n\r\ncorpo\r\n');
    expect(servidor.comandos.slice(0, 4)).toEqual(['EHLO teste.local', 'AUTH LOGIN', '***', '***']);
    expect(servidor.auths).toEqual([{ usuario: USUARIO, senha: SENHA }]);
  });

  it('sem credencial: não manda AUTH', async () => {
    servidor = await criarSmtpFalso();
    await enviarSmtp(opcoes(servidor.porta), { de: 'a@b.com', para: 'c@d.com' }, 'Subject: x\r\n\r\n.linha com ponto\r\n');
    expect(servidor.comandos.some((c) => c.startsWith('AUTH'))).toBe(false);
    expect(servidor.mensagens[0]).toContain('\r\n.linha com ponto\r\n');
  });

  it('5xx no RCPT (servidor ecoa o destinatário): não retentável e a mensagem não traz o destinatário', async () => {
    servidor = await criarSmtpFalso({ respostas: { RCPT: `550 5.1.1 <${destinatario.email}> (${destinatario.nome}): usuário desconhecido` } });
    const e = await erroDe(criarTransporteSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA } }), { agora: relogio }).entregar(msg));
    expect(e).toMatchObject({ codigo: 'EMAIL_RECUSA_DEFINITIVA', retentavel: false, codigoSmtp: 550, etapa: 'rcpt_to' });
    expect(e.message).toBe('SMTP rcpt_to: resposta 550');
    erroSeguro(e);
  });

  it('4xx (greylisting no MAIL FROM): retentável', async () => {
    servidor = await criarSmtpFalso({ respostas: { MAIL: '451 4.7.1 tente mais tarde' } });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_RECUSA_TEMPORARIA', retentavel: true, codigoSmtp: 451, etapa: 'mail_from' });
  });

  it('535 no AUTH: autenticação recusada, não retentável, sem a credencial no erro', async () => {
    servidor = await criarSmtpFalso({ respostas: { AUTH: '535 5.7.8 credencial inválida' } });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA } }), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_AUTENTICACAO', retentavel: false, codigoSmtp: 535 });
    erroSeguro(e);
    expect(servidor.comandos.some((c) => c.startsWith('MAIL'))).toBe(false);
  });

  it('STARTTLS exigido e não anunciado: recusa ANTES do AUTH (credencial nunca vai em claro)', async () => {
    servidor = await criarSmtpFalso({ extensoes: ['AUTH PLAIN LOGIN'] });
    const e = await erroDe(
      enviarSmtp(opcoes(servidor.porta, { tls: 'starttls', credencial: { usuario: USUARIO, senha: SENHA }, permitirCredencialSemTls: false }), { de: 'a@b.com', para: 'c@d.com' }, 'x'),
    );
    expect(e).toMatchObject({ codigo: 'EMAIL_TLS_INDISPONIVEL', retentavel: false, etapa: 'starttls' });
    expect(servidor.comandos).toEqual(['EHLO teste.local']);
    expect(servidor.auths).toEqual([]);
    erroSeguro(e);
  });

  it('STARTTLS com dados injetados antes do TLS: derruba a conexão', async () => {
    servidor = await criarSmtpFalso({ extensoes: ['STARTTLS', 'AUTH PLAIN'], respostas: { STARTTLS: '220 vai\r\n250 injetado' } });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta, { tls: 'starttls', credencial: { usuario: USUARIO, senha: SENHA } }), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_PROTOCOLO', retentavel: false });
    expect(servidor.auths).toEqual([]);
  });

  it('STARTTLS recusado pelo servidor (454): retentável, sem AUTH', async () => {
    servidor = await criarSmtpFalso({ extensoes: ['STARTTLS', 'AUTH PLAIN'] });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta, { tls: 'starttls', credencial: { usuario: USUARIO, senha: SENHA } }), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_TLS_INDISPONIVEL', retentavel: true, codigoSmtp: 454 });
    expect(servidor.auths).toEqual([]);
  });

  it('credencial sem TLS com permitirCredencialSemTls=false (produção): recusa sem mandar AUTH', async () => {
    servidor = await criarSmtpFalso();
    const e = await erroDe(
      enviarSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA }, permitirCredencialSemTls: false }), { de: 'a@b.com', para: 'c@d.com' }, 'x'),
    );
    expect(e).toMatchObject({ codigo: 'EMAIL_TLS_INDISPONIVEL', retentavel: false, etapa: 'auth' });
    expect(servidor.comandos.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('servidor sem AUTH PLAIN/LOGIN: não retentável', async () => {
    servidor = await criarSmtpFalso({ extensoes: ['AUTH CRAM-MD5'] });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta, { credencial: { usuario: USUARIO, senha: SENHA } }), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_AUTENTICACAO', retentavel: false });
  });

  it('EHLO recusado (5xx): cai para HELO', async () => {
    servidor = await criarSmtpFalso({ respostas: { EHLO: '502 não sei' } });
    await enviarSmtp(opcoes(servidor.porta), { de: 'a@b.com', para: 'c@d.com' }, 'x');
    expect(servidor.comandos.slice(0, 2)).toEqual(['EHLO teste.local', 'HELO teste.local']);
  });

  it('servidor mudo: tempo esgotado, retentável', async () => {
    servidor = await criarSmtpFalso({ mudo: true });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta, { timeoutMs: 200 }), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_TEMPO_ESGOTADO', retentavel: true, etapa: 'saudacao' });
  });

  it('saudação 554: não retentável', async () => {
    servidor = await criarSmtpFalso({ saudacao: '554 sem serviço' });
    const e = await erroDe(enviarSmtp(opcoes(servidor.porta), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_RECUSA_DEFINITIVA', retentavel: false, etapa: 'saudacao' });
  });

  it('conexão recusada: falha de rede retentável, só com o código do sistema', async () => {
    const e = await erroDe(enviarSmtp(opcoes(await portaFechada()), { de: 'a@b.com', para: 'c@d.com' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_CONEXAO', retentavel: true, etapa: 'conexao' });
    expect(e.message).toBe('SMTP conexao: falha de rede (ECONNREFUSED)');
  });

  it('endereço de envelope com quebra de linha: recusado sem conectar', async () => {
    const e = await erroDe(enviarSmtp(opcoes(1), { de: 'a@b.com', para: 'c@d.com>\r\nRCPT TO:<x@y.z' }, 'x'));
    expect(e).toMatchObject({ codigo: 'EMAIL_DADOS_INVALIDOS', retentavel: false });
  });
});

describe('porta 465: TLS implícito desde a conexão (T-0094 fatia S)', () => {
  it('entrega com AUTH dentro do TLS, conferindo o certificado pela CA dada', async () => {
    servidor = await criarSmtpFalso({ tlsImplicito: true });
    const t = criarTransporteSmtp(
      opcoes(servidor.porta, { tls: 'tls', permitirCredencialSemTls: false, credencial: { usuario: USUARIO, senha: SENHA }, tlsOpcoes: { ca: TLS_TESTE.cert, servername: 'localhost' } }),
      { agora: relogio },
    );
    const r = await t.entregar(msg);
    expect(r.idMensagem).toBe(`<${ID_ENVIO}@macuxifdv.com.br>`);
    // sem STARTTLS: o canal já nasce cifrado
    expect(servidor.comandos).toEqual(['EHLO teste.local', 'AUTH PLAIN ***', 'MAIL FROM:<nao-responda@macuxifdv.com.br>', `RCPT TO:<${destinatario.email}>`, 'DATA', '<dados>', 'QUIT']);
    expect(servidor.auths).toEqual([{ usuario: USUARIO, senha: SENHA }]);
    expect(decodificarPartes(servidor.mensagens[0]!).texto).toContain('Senha temporária: Prov1sor1a-Xq7');
  });

  it('certificado não confiável: EMAIL_TLS_INDISPONIVEL antes de qualquer comando (credencial nunca sai)', async () => {
    servidor = await criarSmtpFalso({ tlsImplicito: true });
    const e = await erroDe(
      criarTransporteSmtp(opcoes(servidor.porta, { tls: 'tls', permitirCredencialSemTls: false, credencial: { usuario: USUARIO, senha: SENHA } }), { agora: relogio }).entregar(msg),
    );
    expect(e.codigo).toBe('EMAIL_TLS_INDISPONIVEL');
    expect(servidor.comandos).toEqual([]);
    expect(servidor.auths).toEqual([]);
    erroSeguro(e);
  });
});
