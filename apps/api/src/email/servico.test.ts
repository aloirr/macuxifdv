import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODIGOS_EMAIL, ResultadoEnvioEmailSchema, type MensagemEmail, type TransporteEmail } from '@macuxi/platform-sdk';
import {
  capturarLog,
  criarSmtpFalso,
  dadosAcesso,
  dadosNovaSenha,
  decodificarPartes,
  destinatario,
  ID_ENVIO,
  ID_ENVIO_2,
  relogio,
  TENANT,
  vazamentos,
} from './apoio-teste';
import { criarCifraEmail } from './cifra';
import { lerConfigEmail } from './config';
import { ErroEmail } from './erros';
import { criarFilaMemoria, type FilaEmail, type JobEmail } from './fila';
import { criarEnvioEmail, criarProcessadorEmail, ligarEmail } from './servico';

const remetente = { email: 'nao-responda@macuxifdv.com.br', nome: 'Macuxi' };

/** Transporte falso: falha nas N primeiras entregas com o erro dado; guarda as mensagens. */
function transporteFalso(falhas: (Error | null)[] = []): TransporteEmail & { entregues: MensagemEmail[]; chamadas: number } {
  const t = {
    nome: 'falso',
    entregues: [] as MensagemEmail[],
    chamadas: 0,
    async entregar(msg: MensagemEmail) {
      const erro = falhas[t.chamadas];
      t.chamadas += 1;
      if (erro) throw erro;
      t.entregues.push(msg);
      return { idMensagem: `<${msg.idEnvio}@macuxifdv.com.br>` };
    },
  };
  return t;
}

const temporaria = () => new ErroEmail(CODIGOS_EMAIL.RECUSA_TEMPORARIA, 'SMTP mail_from: resposta 451', { retentavel: true, codigoSmtp: 451, etapa: 'mail_from' });
const definitiva = () => new ErroEmail(CODIGOS_EMAIL.RECUSA_DEFINITIVA, 'SMTP rcpt_to: resposta 550', { retentavel: false, codigoSmtp: 550, etapa: 'rcpt_to' });

function montar(transporte: TransporteEmail, maxTentativas = 6) {
  const cap = capturarLog();
  const cifra = criarCifraEmail(randomBytes(32));
  const fila = criarFilaMemoria({ maxTentativas, atrasoMs: () => 0 });
  const envio = criarEnvioEmail({ fila, cifra, log: cap.log, novoId: () => ID_ENVIO });
  const processador = criarProcessadorEmail({ transporte, cifra, remetente, log: cap.log });
  return { cap, cifra, fila, envio, processador };
}

describe('RN-CORE-34 — enviar não bloqueia a rota', () => {
  it('devolve "enfileirado" na hora, antes de qualquer entrega; o job não leva dado pessoal em claro', async () => {
    const t = transporteFalso();
    const jobs: JobEmail[] = [];
    const cap = capturarLog();
    const filaEspia: FilaEmail = { nome: 'espia', enfileirar: async (j) => void jobs.push(j), processar: async () => undefined, parar: async () => undefined };
    const envio = criarEnvioEmail({ fila: filaEspia, cifra: criarCifraEmail(randomBytes(32)), log: cap.log, novoId: () => ID_ENVIO });
    const r = await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { tenantId: TENANT });
    expect(r).toEqual({ ok: true, idEnvio: ID_ENVIO, situacao: 'enfileirado' });
    expect(ResultadoEnvioEmailSchema.parse(r)).toEqual(r);
    expect(t.chamadas).toBe(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ v: 1, idEnvio: ID_ENVIO, modelo: 'acesso_inicial', tenantId: TENANT });
    expect(vazamentos(JSON.stringify(jobs))).toEqual([]);
    expect(cap.linhas.map((l) => l.obj.evento)).toEqual(['enfileirado']);
    expect(cap.linhas[0]!.obj).toMatchObject({ id_envio: ID_ENVIO, modelo: 'acesso_inicial', tenant_id: TENANT });
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('fila em memória: o worker entrega a mensagem renderizada (com a senha só no corpo)', async () => {
    const t = transporteFalso();
    const { cap, fila, envio, processador } = montar(t);
    await fila.processar(processador);
    const r = await envio.enviar('nova_senha', destinatario, dadosNovaSenha, { idEnvio: ID_ENVIO_2, tenantId: TENANT });
    expect(r).toMatchObject({ ok: true, idEnvio: ID_ENVIO_2 });
    await fila.ocioso();
    expect(t.entregues).toHaveLength(1);
    const m = t.entregues[0]!;
    expect(m).toMatchObject({ idEnvio: ID_ENVIO_2, modelo: 'nova_senha', assunto: 'Sua nova senha', de: remetente, para: destinatario });
    expect(m.texto).toContain('Senha provisória: N0va-Senh4-Kz');
    expect(m.paraLog?.texto).toContain('Senha provisória: ********');
    expect(cap.linhas.map((l) => l.obj.evento)).toEqual(['enfileirado', 'enviado']);
    expect(cap.linhas[1]!.obj).toMatchObject({ tentativa: 1, transporte: 'falso', tenant_id: TENANT });
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('idempotência: o mesmo idEnvio enviado duas vezes gera uma entrega', async () => {
    const t = transporteFalso();
    const { cap, fila, envio, processador } = montar(t);
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { idEnvio: ID_ENVIO });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { idEnvio: ID_ENVIO });
    await fila.processar(processador);
    await fila.ocioso();
    expect(t.chamadas).toBe(1);
    expect(vazamentos(cap.json())).toEqual([]);
  });
});

describe('nova tentativa', () => {
  it('erro retentável: tenta de novo até dar certo', async () => {
    const t = transporteFalso([temporaria(), temporaria()]);
    const { cap, fila, envio, processador } = montar(t);
    await fila.processar(processador);
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { tenantId: TENANT });
    await fila.ocioso();
    expect(t.chamadas).toBe(3);
    expect(t.entregues).toHaveLength(1);
    expect(fila.situacao(ID_ENVIO)).toEqual({ estado: 'concluido', tentativas: 3 });
    const eventos = cap.linhas.map((l) => [l.nivel, l.obj.evento, l.obj.tentativa]);
    expect(eventos).toEqual([
      ['info', 'enfileirado', undefined],
      ['warn', 'falha_temporaria', 1],
      ['warn', 'falha_temporaria', 2],
      ['info', 'enviado', 3],
    ]);
    expect(cap.linhas[1]!.obj).toMatchObject({ codigo: 'EMAIL_RECUSA_TEMPORARIA', codigo_smtp: 451, etapa: 'mail_from' });
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('erro não retentável: uma tentativa só, job concluído e log warn só com o código', async () => {
    const t = transporteFalso([definitiva()]);
    const { cap, fila, envio, processador } = montar(t);
    await fila.processar(processador);
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso);
    await fila.ocioso();
    expect(t.chamadas).toBe(1);
    expect(fila.situacao(ID_ENVIO)).toEqual({ estado: 'concluido', tentativas: 1 });
    const ultima = cap.linhas.at(-1)!;
    expect(ultima.nivel).toBe('warn');
    expect(ultima.obj).toMatchObject({ evento: 'descartado', codigo: 'EMAIL_RECUSA_DEFINITIVA', retentavel: false });
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('retentável até esgotar: erro registrado na última tentativa', async () => {
    const t = transporteFalso([temporaria(), temporaria(), temporaria()]);
    const { cap, fila, envio, processador } = montar(t, 3);
    await fila.processar(processador);
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso);
    await fila.ocioso();
    expect(fila.situacao(ID_ENVIO)).toEqual({ estado: 'falhou', tentativas: 3 });
    expect(cap.linhas.at(-1)).toMatchObject({ nivel: 'error', obj: { evento: 'esgotado', tentativa: 3 } });
  });

  it('erro qualquer do transporte (mensagem com dado pessoal) vira código seguro', async () => {
    const t = transporteFalso([new Error(`falhou para ${destinatario.email} com senha ${dadosAcesso.senhaInicial}`)]);
    const { cap, fila, envio, processador } = montar(t);
    await fila.processar(processador);
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso);
    await fila.ocioso();
    expect(t.entregues).toHaveLength(1);
    expect(cap.linhas.find((l) => l.obj.evento === 'falha_temporaria')?.obj.codigo).toBe('EMAIL_TRANSPORTE');
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('carga adulterada no job: descartada (EMAIL_CIFRA_INVALIDA), sem tentar de novo', async () => {
    const t = transporteFalso();
    const { cap, cifra, processador } = montar(t);
    const outra = cifra.cifrar({ modelo: 'acesso_inicial', destinatario, dados: { ...dadosAcesso, validadeHoras: 72 } }, ID_ENVIO_2);
    await processador({ v: 1, idEnvio: ID_ENVIO, modelo: 'acesso_inicial', carga: outra }, { tentativa: 1, ultima: false });
    expect(t.chamadas).toBe(0);
    expect(cap.linhas.at(-1)!.obj).toMatchObject({ evento: 'descartado', codigo: 'EMAIL_CIFRA_INVALIDA' });
  });
});

describe('recusas sem lançar', () => {
  it('dados inválidos: EMAIL_DADOS_INVALIDOS; o log tem só caminho e código, nunca o valor', async () => {
    const t = transporteFalso();
    const { cap, envio } = montar(t);
    const emailRuim = 'joaquina.teste@@exemplo';
    const r = await envio.enviar('acesso_inicial', { ...destinatario, email: emailRuim }, { ...dadosAcesso, senhaInicial: 'curta' });
    expect(r).toEqual({ ok: false, codigo: 'EMAIL_DADOS_INVALIDOS', retentavel: false });
    const linha = cap.linhas[0]!;
    expect(linha.obj.problemas).toEqual([
      { caminho: 'destinatario.email', codigo: 'invalid_string' },
      { caminho: 'dados.senhaInicial', codigo: 'too_small' },
    ]);
    expect(vazamentos(cap.json(), [emailRuim, 'curta', destinatario.nome, 'Joaquina'])).toEqual([]);
    const r2 = await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { idEnvio: 'nao-e-uuid' });
    expect(r2).toMatchObject({ ok: false, codigo: 'EMAIL_DADOS_INVALIDOS' });
  });

  it('fila indisponível: EMAIL_FILA_INDISPONIVEL retentável, sem a mensagem do erro no log', async () => {
    const cap = capturarLog();
    const filaFora: FilaEmail = {
      nome: 'fora',
      enfileirar: async () => {
        throw new Error(`conexão recusada ao gravar ${destinatario.email}`);
      },
      processar: async () => undefined,
      parar: async () => undefined,
    };
    const envio = criarEnvioEmail({ fila: filaFora, cifra: criarCifraEmail(randomBytes(32)), log: cap.log, novoId: () => ID_ENVIO });
    expect(await envio.enviar('acesso_inicial', destinatario, dadosAcesso)).toEqual({ ok: false, codigo: 'EMAIL_FILA_INDISPONIVEL', retentavel: true });
    expect(cap.linhas[0]!.obj).toMatchObject({ evento: 'fila_indisponivel', id_envio: ID_ENVIO });
    expect(vazamentos(cap.json())).toEqual([]);
  });
});

describe('ligarEmail (fábrica a partir da configuração)', () => {
  it('arquivo + fila em memória: rota enfileira, worker grava o .eml; nenhum log com dado pessoal', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'macuxi-email-ligar-'));
    try {
      const cap = capturarLog();
      const config = lerConfigEmail({ MACUXI_EMAIL_PASTA: pasta, MACUXI_JWT_SEGREDO: 'j'.repeat(40) });
      const fila = criarFilaMemoria({ atrasoMs: () => 0 });
      const email = ligarEmail({ config, log: cap.log, fila, agora: relogio });
      await email.iniciar();
      const r = await email.envio.enviar('acesso_inicial', destinatario, dadosAcesso, { idEnvio: ID_ENVIO, tenantId: TENANT });
      expect(r).toMatchObject({ ok: true, situacao: 'enfileirado' });
      await fila.ocioso();
      expect(await readdir(pasta)).toEqual([`20261107T120000Z-${ID_ENVIO}.eml`]);
      expect(cap.linhas.map((l) => l.obj.evento ?? l.obj.transporte)).toEqual(['configuracao', 'enfileirado', 'arquivo', 'enviado']);
      expect(vazamentos(cap.json())).toEqual([]);
      await email.parar();
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });

  it('smtp contra o servidor falso: entrega de ponta a ponta, credencial fora do log', async () => {
    const servidor = await criarSmtpFalso();
    try {
      const cap = capturarLog();
      const config = lerConfigEmail({
        MACUXI_SMTP_HOST: '127.0.0.1',
        MACUXI_SMTP_PORTA: String(servidor.porta),
        MACUXI_SMTP_TLS: 'nenhum',
        MACUXI_SMTP_USUARIO: 'conta.smtp@macuxifdv.com.br',
        MACUXI_SMTP_SENHA: 'S3nha-do-SMTP-nao-vaza',
        MACUXI_SMTP_REMETENTE: 'Macuxi <nao-responda@macuxifdv.com.br>',
        MACUXI_EMAIL_CHAVE: randomBytes(32).toString('base64'),
      });
      const fila = criarFilaMemoria({ atrasoMs: () => 0 });
      const email = ligarEmail({ config, log: cap.log, fila, agora: relogio });
      await email.iniciar();
      await email.envio.enviar('nova_senha', destinatario, dadosNovaSenha, { idEnvio: ID_ENVIO });
      await fila.ocioso();
      expect(servidor.mensagens).toHaveLength(1);
      expect(decodificarPartes(servidor.mensagens[0]!).texto).toContain('Senha provisória: N0va-Senh4-Kz');
      expect(cap.linhas.at(-1)!.obj).toMatchObject({ evento: 'enviado', transporte: 'smtp', id_mensagem: `<${ID_ENVIO}@macuxifdv.com.br>` });
      expect(cap.linhas[0]!.obj).toMatchObject({ evento: 'configuracao', autenticado: true });
      expect(vazamentos(cap.json(), ['conta.smtp@macuxifdv.com.br', 'S3nha-do-SMTP-nao-vaza'])).toEqual([]);
      expect(vazamentos(cap.json())).toEqual([]);
      await email.parar();
    } finally {
      await servidor.fechar();
    }
  });

  it('desligado: EMAIL_DESLIGADO sem lançar', async () => {
    const cap = capturarLog();
    const email = ligarEmail({ config: lerConfigEmail({ MACUXI_EMAIL_TRANSPORTE: 'desligado' }), log: cap.log });
    expect(email.transporte).toBeNull();
    expect(await email.envio.enviar('acesso_inicial', destinatario, dadosAcesso)).toEqual({ ok: false, codigo: 'EMAIL_DESLIGADO', retentavel: false });
    expect(vazamentos(cap.json())).toEqual([]);
  });
});
