import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODIGOS_EMAIL, type MensagemEmail } from '@macuxi/platform-sdk';
import { capturarLog, dadosAcesso, destinatario, ID_ENVIO, TENANT, vazamentos } from './apoio-teste';
import { criarCifraEmail } from './cifra';
import { ErroEmail } from './erros';
import { criarFilaMemoria, criarFilaPgBoss, POLITICA_TENTATIVAS_EMAIL, type JobPgBossLike, type OpcoesSendPgBoss, type PgBossLike } from './fila';
import { criarEnvioEmail, criarProcessadorEmail } from './servico';

/** pg-boss falso (v10): guarda o que recebe e expõe o handler do `work`. */
function bossFalso(opcoes: { filaExiste?: boolean } = {}) {
  const chamadas = {
    createQueue: [] as { nome: string; opcoes: Record<string, unknown> | undefined }[],
    send: [] as { nome: string; dados: object; opcoes: OpcoesSendPgBoss }[],
    work: [] as { nome: string; opcoes: Record<string, unknown> }[],
    offWork: [] as string[],
  };
  let handler: ((jobs: JobPgBossLike[]) => Promise<unknown>) | null = null;
  const ids = new Set<string>();
  const boss: PgBossLike = {
    async createQueue(nome, o) {
      chamadas.createQueue.push({ nome, opcoes: o });
    },
    async getQueue() {
      return opcoes.filaExiste ? { name: 'macuxi-email' } : null;
    },
    async send(nome, dados, o) {
      chamadas.send.push({ nome, dados, opcoes: o });
      if (ids.has(o.id)) return null;
      ids.add(o.id);
      return o.id;
    },
    async work(nome, o, h) {
      chamadas.work.push({ nome, opcoes: o });
      handler = h;
      return 'worker-1';
    },
    async offWork(nome) {
      chamadas.offWork.push(nome);
    },
  };
  const executar = (jobs: JobPgBossLike[]) => {
    if (!handler) throw new Error('work não chamado');
    return handler(jobs);
  };
  return { boss, chamadas, executar };
}

describe('adaptador pg-boss (tipo estrutural, sem importar o pacote)', () => {
  it('cria a fila uma vez com a política e envia com id = idEnvio, retryLimit 5, retryDelay 30, backoff', async () => {
    const { boss, chamadas } = bossFalso();
    const cap = capturarLog();
    const fila = criarFilaPgBoss(boss, { log: cap.log });
    const envio = criarEnvioEmail({ fila, cifra: criarCifraEmail(randomBytes(32)), log: cap.log, novoId: () => ID_ENVIO });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { tenantId: TENANT });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { tenantId: TENANT });
    expect(chamadas.createQueue).toEqual([{ nome: 'macuxi-email', opcoes: { ...POLITICA_TENTATIVAS_EMAIL } }]);
    expect(chamadas.send).toHaveLength(2);
    expect(chamadas.send[0]!.opcoes).toEqual({ id: ID_ENVIO, retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 });
    expect(chamadas.send[0]!.dados).toMatchObject({ v: 1, idEnvio: ID_ENVIO, modelo: 'acesso_inicial', tenantId: TENANT });
    // o job (que vai para a tabela do pg-boss) não tem e-mail, nome nem senha em claro
    expect(vazamentos(JSON.stringify(chamadas.send))).toEqual([]);
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('fila já existente (getQueue): não recria', async () => {
    const { boss, chamadas } = bossFalso({ filaExiste: true });
    await criarFilaPgBoss(boss).processar(async () => undefined);
    expect(chamadas.createQueue).toEqual([]);
    expect(chamadas.work[0]).toEqual({ nome: 'macuxi-email', opcoes: { batchSize: 1, includeMetadata: true } });
  });

  it('handler: retentável ⇒ lança (pg-boss tenta de novo) com mensagem segura; não retentável ⇒ conclui', async () => {
    const { boss, executar, chamadas } = bossFalso();
    const cap = capturarLog();
    const cifra = criarCifraEmail(randomBytes(32));
    const fila = criarFilaPgBoss(boss, { log: cap.log });
    const envio = criarEnvioEmail({ fila, cifra, log: cap.log, novoId: () => ID_ENVIO });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso, { tenantId: TENANT });
    const dados = chamadas.send[0]!.dados;

    let erroDaVez: Error | null = new ErroEmail(CODIGOS_EMAIL.RECUSA_TEMPORARIA, 'SMTP mail_from: resposta 451', { retentavel: true, codigoSmtp: 451 });
    const entregues: MensagemEmail[] = [];
    const transporte = {
      nome: 'falso',
      async entregar(msg: MensagemEmail) {
        if (erroDaVez) throw erroDaVez;
        entregues.push(msg);
        return {};
      },
    };
    await fila.processar(criarProcessadorEmail({ transporte, cifra, remetente: { email: 'nao-responda@macuxifdv.com.br' }, log: cap.log }));

    const falha = await executar([{ id: ID_ENVIO, data: dados, retryCount: 0, retryLimit: 5 }]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(falha).toBeInstanceOf(ErroEmail);
    expect((falha as ErroEmail).message).toBe('SMTP mail_from: resposta 451');
    expect(cap.linhas.at(-1)!.obj).toMatchObject({ evento: 'falha_temporaria', tentativa: 1 });

    // erro qualquer com dado pessoal na mensagem: o que sobe para o pg-boss é o ErroEmail genérico
    erroDaVez = new Error(`caixa de ${destinatario.email} cheia`);
    const falha2 = (await executar([{ id: ID_ENVIO, data: dados, retryCount: 5, retryLimit: 5 }]).catch((e: unknown) => e)) as ErroEmail;
    expect(falha2.codigo).toBe('EMAIL_TRANSPORTE');
    expect(vazamentos(`${falha2.message} ${falha2.stack}`)).toEqual([]);
    expect(cap.linhas.at(-1)).toMatchObject({ nivel: 'error', obj: { evento: 'esgotado', tentativa: 6 } });

    erroDaVez = new ErroEmail(CODIGOS_EMAIL.RECUSA_DEFINITIVA, 'SMTP rcpt_to: resposta 550', { retentavel: false, codigoSmtp: 550 });
    await expect(executar([{ id: ID_ENVIO, data: dados, retryCount: 1, retryLimit: 5 }])).resolves.toBeUndefined();
    expect(cap.linhas.at(-1)!.obj).toMatchObject({ evento: 'descartado', codigo: 'EMAIL_RECUSA_DEFINITIVA' });

    erroDaVez = null;
    await executar([{ id: ID_ENVIO, data: dados, retryCount: 2 }]);
    expect(entregues).toHaveLength(1);
    expect(cap.linhas.at(-1)!.obj).toMatchObject({ evento: 'enviado', tentativa: 3 });

    expect(vazamentos(cap.json())).toEqual([]);
    await fila.parar();
    expect(chamadas.offWork).toEqual(['macuxi-email']);
  });

  it('job malformado: concluído com aviso, sem chamar o handler', async () => {
    const { boss, executar } = bossFalso();
    const cap = capturarLog();
    const fila = criarFilaPgBoss(boss, { log: cap.log });
    let chamado = false;
    await fila.processar(async () => {
      chamado = true;
    });
    await executar([{ id: 'x', data: { email: destinatario.email } }]);
    expect(chamado).toBe(false);
    expect(cap.linhas[0]!.obj).toMatchObject({ evento: 'job_invalido', id_job: 'x' });
    expect(vazamentos(cap.json())).toEqual([]);
  });
});

describe('fila em memória', () => {
  it('atraso padrão 30 s com backoff e agendador injetável', async () => {
    const atrasos: number[] = [];
    const pendentes: (() => void)[] = [];
    const fila = criarFilaMemoria({
      maxTentativas: 3,
      agendar: (fn, ms) => {
        atrasos.push(ms);
        pendentes.push(fn);
        return () => undefined;
      },
    });
    let n = 0;
    await fila.processar(async () => {
      n += 1;
      throw new Error('falha');
    });
    const cifra = criarCifraEmail(randomBytes(32));
    const envio = criarEnvioEmail({ fila, cifra, log: capturarLog().log, novoId: () => ID_ENVIO });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso);
    while (pendentes.length) {
      pendentes.shift()!();
      await new Promise((r) => setImmediate(r));
    }
    await fila.ocioso();
    expect(n).toBe(3);
    expect(atrasos).toEqual([0, 30_000, 60_000]);
    expect(fila.situacao(ID_ENVIO)).toEqual({ estado: 'falhou', tentativas: 3 });
  });

  it('job enfileirado antes do processar é entregue quando o worker liga', async () => {
    const fila = criarFilaMemoria({ atrasoMs: () => 0 });
    const envio = criarEnvioEmail({ fila, cifra: criarCifraEmail(randomBytes(32)), log: capturarLog().log, novoId: () => ID_ENVIO });
    await envio.enviar('acesso_inicial', destinatario, dadosAcesso);
    expect(fila.situacao(ID_ENVIO)).toEqual({ estado: 'pendente', tentativas: 0 });
    let n = 0;
    await fila.processar(async () => {
      n += 1;
    });
    await fila.ocioso();
    expect(n).toBe(1);
  });
});
