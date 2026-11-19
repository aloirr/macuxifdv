import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODIGOS_EMAIL, type EmailParaEnvio, type MensagemEmail, type ModeloEmail, type OpcoesApresentacaoEmail, type TransporteEmail } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { capturarLog, cargaAcesso, dadosAcesso, dadosNovaSenha, decodificarPartes, destinatario, INSTANTE, TENANT, USUARIO, vazamentos } from './apoio-teste';
import { criarTransporteArquivo } from './arquivo';
import { criarCifraEmail } from './cifra';
import { derivarChaveEmail } from './config';
import { criarDespachanteEmail, esperaEmailPadrao, MAX_TENTATIVAS_EMAIL_PADRAO } from './despachante';
import { ErroEmail } from './erros';
import { criarServicoEmail } from './servico';

const cifra = criarCifraEmail(derivarChaveEmail('j'.repeat(40)));
const remetente = { email: 'nao-responda@macuxifdv.com.br', nome: 'Macuxi FDV' };

interface Linha {
  id: string;
  tenant_id: string;
  usuario_id: string;
  modelo: ModeloEmail;
  chave_idempotencia: string;
  carga: Buffer | null;
  tentativas: number;
  proxima_tentativa_em: Date;
  expira_em: Date;
  enviado_em: Date | null;
  falhou_em: Date | null;
  ultimo_erro: string | null;
}

/**
 * `plataforma.email_saida` em memória: o `ClienteBanco` do tenant (insert da porta) e o pool do `macuxi_worker` (lote com
 * `for update skip locked` e os 3 updates do despachante), com os CHECKs da 0040 que importam aqui.
 */
function outboxFalsa() {
  const linhas: Linha[] = [];
  let seq = 0;
  const checar = (l: Linha) => {
    if (l.enviado_em && l.falhou_em) throw new Error('email_saida_enviado_ou_falhou');
    if ((l.enviado_em === null && l.falhou_em === null) !== (l.carga !== null)) throw new Error('email_saida_carga_so_pendente');
  };
  const db = {
    query: async (sql: string, p: unknown[] = []) => {
      if (sql.includes('tenant_atual()')) return { rows: [{ tenant_id: TENANT }] };
      if (sql.includes('insert into plataforma.email_saida')) {
        if (linhas.some((l) => l.tenant_id === p[1] && l.chave_idempotencia === p[4])) return { rows: [] };
        const l: Linha = {
          id: p[0] as string,
          tenant_id: p[1] as string,
          usuario_id: p[2] as string,
          modelo: p[3] as ModeloEmail,
          chave_idempotencia: p[4] as string,
          carga: p[5] as Buffer,
          tentativas: 0,
          proxima_tentativa_em: INSTANTE,
          expira_em: new Date(INSTANTE.getTime() + (p[6] as number) * 3_600_000),
          enviado_em: null,
          falhou_em: null,
          ultimo_erro: null,
        };
        checar(l);
        linhas.push(l);
        return { rows: [{ id: l.id }] };
      }
      throw new Error(`sql inesperado: ${sql}`);
    },
  };
  const comandos: string[] = [];
  const cliente = {
    query: async (sql: string, p: unknown[] = []) => {
      const s = sql.trim();
      comandos.push(s.split(/\s+/).slice(0, 3).join(' '));
      if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [] };
      if (s.startsWith('select id, tenant_id, modelo, carga')) {
        expect(s).toContain('for update skip locked');
        const agora = p[0] as Date;
        const l = linhas
          .filter((x) => !x.enviado_em && !x.falhou_em && x.proxima_tentativa_em.getTime() <= agora.getTime())
          .sort((a, b) => a.proxima_tentativa_em.getTime() - b.proxima_tentativa_em.getTime())[0];
        return { rows: l ? [{ ...l }] : [] };
      }
      const l = linhas.find((x) => x.id === p[0]);
      if (!l) throw new Error('linha sumiu');
      if (s.includes('set enviado_em')) Object.assign(l, { enviado_em: p[1], carga: null, ultimo_erro: null, tentativas: l.tentativas + 1 });
      else if (s.includes('set falhou_em')) Object.assign(l, { falhou_em: p[1], carga: null, ultimo_erro: p[2], tentativas: p[3] });
      else if (s.includes('set tentativas')) Object.assign(l, { tentativas: p[1], ultimo_erro: p[2], proxima_tentativa_em: p[3] });
      else throw new Error(`sql inesperado: ${s}`);
      checar(l);
      return { rows: [] };
    },
    release: () => undefined,
  };
  const worker = { connect: async () => cliente } as unknown as Pick<pg.Pool, 'connect'>;
  return { db: db as never, worker, linhas, comandos, nova: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
}

function transporteFalso(falhas: (Error | null)[] = []): TransporteEmail & { entregues: EmailParaEnvio[] } {
  let n = 0;
  const entregues: EmailParaEnvio[] = [];
  return {
    nome: 'falso',
    entregues,
    async entregar(msg) {
      const e = falhas[n++];
      if (e) throw e;
      entregues.push(msg);
      return { idMensagem: `<${msg.idEnvio}@macuxifdv.com.br>` };
    },
  };
}

const temporaria = () => new ErroEmail(CODIGOS_EMAIL.RECUSA_TEMPORARIA, 'SMTP mail_from: resposta 451', { retentavel: true, codigoSmtp: 451, etapa: 'mail_from' });
const definitiva = () => new ErroEmail(CODIGOS_EMAIL.RECUSA_DEFINITIVA, 'SMTP rcpt_to: resposta 550', { retentavel: false, codigoSmtp: 550, etapa: 'rcpt_to' });

const mensagem = (extra: Partial<MensagemEmail> = {}): MensagemEmail => ({
  modelo: 'acesso_inicial',
  usuario_id: USUARIO,
  para: destinatario.email,
  dados: dadosAcesso,
  chave_idempotencia: `${USUARIO}:acesso`,
  ...extra,
});

async function montar(transporte: TransporteEmail, op: { agora?: () => Date; apresentacao?: OpcoesApresentacaoEmail } = {}) {
  const o = outboxFalsa();
  const cap = capturarLog();
  const servico = criarServicoEmail({ cifra, log: cap.log, novoId: o.nova });
  const desp = criarDespachanteEmail({ worker: o.worker, transporte, cifra, remetente, log: cap.log, agora: op.agora ?? (() => INSTANTE), ...(op.apresentacao ? { apresentacao: op.apresentacao } : {}) });
  return { o, cap, servico, desp };
}

describe('despachante da outbox de e-mail (macuxi_worker, desenho T-0094 §10 item 3)', () => {
  it('envia, grava enviado_em e ZERA a carga; log só com id, tenant, modelo e tentativas', async () => {
    const t = transporteFalso();
    const { o, cap, servico, desp } = await montar(t);
    await servico.enfileirar(o.db, mensagem());
    await servico.enfileirar(o.db, mensagem({ modelo: 'nova_senha', dados: dadosNovaSenha, chave_idempotencia: `${USUARIO}:redefinida:1` }));
    expect(await desp.ciclo()).toEqual({ lidos: 2, enviados: 2, adiados: 0, falhos: 0 });
    expect(o.linhas.every((l) => l.enviado_em && l.carga === null && l.tentativas === 1)).toBe(true);
    expect(t.entregues.map((m) => m.assunto)).toEqual(['Seu acesso ao Macuxi', 'Sua senha temporária do Macuxi']);
    expect(t.entregues[0]!.para).toEqual(destinatario);
    expect(t.entregues[0]!.texto).toContain('\nSenha temporária\nProv1sor1a-Xq7\n');
    // sem apresentação configurada: sem logo (só o texto alternativo) e sem botão
    expect(t.entregues[0]!.html).not.toContain('<img');
    expect(t.entregues[0]!.html).not.toContain('Abrir o backoffice');
    expect(t.entregues[0]!.idEnvio).toBe(o.linhas[0]!.id);
    expect(vazamentos(cap.json())).toEqual([]);
    expect(cap.linhas.filter((l) => l.obj.evento === 'enviado').map((l) => Object.keys(l.obj).sort())[0]).toEqual(
      ['email_id', 'evento', 'id_mensagem', 'modelo', 'tenant_id', 'tentativas', 'tipo', 'transporte'].sort(),
    );
    expect(await desp.ciclo()).toEqual({ lidos: 0, enviados: 0, adiados: 0, falhos: 0 });
  });

  it('repassa a apresentação (logo e backoffice) às três renderizações: e-mail, log e sem senha', async () => {
    const t = transporteFalso();
    const apresentacao = { urlLogo: 'https://bko.exemplo.com.br/email/logo.png', urlLogoEscuro: 'https://bko.exemplo.com.br/email/logo-escuro.png', urlBackoffice: 'https://bko.exemplo.com.br/' };
    const { o, servico, desp } = await montar(t, { apresentacao });
    await servico.enfileirar(o.db, mensagem({ dados: { ...dadosAcesso, apps: ['web'] } }));
    expect(await desp.ciclo()).toMatchObject({ enviados: 1 });
    const m = t.entregues[0]!;
    for (const r of [m, m.paraLog!, m.semSenha!]) {
      expect(r.html).toContain('src="https://bko.exemplo.com.br/email/logo.png"');
      expect(r.html).toContain('src="https://bko.exemplo.com.br/email/logo-escuro.png"');
      expect(r.html).toContain('href="https://bko.exemplo.com.br/"');
      expect(r.texto).toContain('Abrir o backoffice: https://bko.exemplo.com.br/');
    }
  });

  it('falha temporária: tentativas + 1, código em ultimo_erro, espera crescente; depois envia', async () => {
    let agora = INSTANTE;
    const t = transporteFalso([temporaria()]);
    const { o, cap, servico, desp } = await montar(t, { agora: () => agora });
    await servico.enfileirar(o.db, mensagem());
    expect(await desp.ciclo()).toMatchObject({ adiados: 1 });
    const l = o.linhas[0]!;
    expect(l).toMatchObject({ tentativas: 1, ultimo_erro: 'EMAIL_RECUSA_TEMPORARIA', enviado_em: null, falhou_em: null });
    expect(l.carga).not.toBeNull();
    expect(l.proxima_tentativa_em.getTime() - INSTANTE.getTime()).toBe(esperaEmailPadrao(1));
    expect(await desp.ciclo()).toMatchObject({ lidos: 0 }); // ainda na espera
    agora = new Date(INSTANTE.getTime() + esperaEmailPadrao(1));
    expect(await desp.ciclo()).toMatchObject({ enviados: 1 });
    expect(l).toMatchObject({ tentativas: 2, ultimo_erro: null, carga: null });
    expect(vazamentos(cap.json())).toEqual([]);
  });

  it('falha definitiva (5xx): falhou_em, código e carga zerada, sem nova tentativa', async () => {
    const t = transporteFalso([definitiva()]);
    const { o, servico, desp } = await montar(t);
    await servico.enfileirar(o.db, mensagem());
    expect(await desp.ciclo()).toMatchObject({ falhos: 1 });
    expect(o.linhas[0]).toMatchObject({ ultimo_erro: 'EMAIL_RECUSA_DEFINITIVA', carga: null, enviado_em: null, tentativas: 1 });
    expect(o.linhas[0]!.falhou_em).toEqual(INSTANTE);
  });

  it('tentativas esgotadas: falha final com carga zerada', async () => {
    let agora = INSTANTE;
    const t = transporteFalso(Array.from({ length: MAX_TENTATIVAS_EMAIL_PADRAO }, temporaria));
    const { o, servico, desp } = await montar(t, { agora: () => agora });
    await servico.enfileirar(o.db, mensagem());
    for (let i = 0; i < MAX_TENTATIVAS_EMAIL_PADRAO; i++) {
      await desp.ciclo();
      agora = new Date(agora.getTime() + 3_600_000);
    }
    expect(o.linhas[0]).toMatchObject({ tentativas: MAX_TENTATIVAS_EMAIL_PADRAO, ultimo_erro: 'EMAIL_RECUSA_TEMPORARIA', carga: null });
    expect(o.linhas[0]!.falhou_em).not.toBeNull();
  });

  it('passou de expira_em sem sair: EMAIL_EXPIRADO, carga zerada, nada entregue', async () => {
    const t = transporteFalso();
    const { o, servico, desp } = await montar(t, { agora: () => new Date(INSTANTE.getTime() + 73 * 3_600_000) });
    await servico.enfileirar(o.db, mensagem());
    expect(await desp.ciclo()).toMatchObject({ falhos: 1 });
    expect(o.linhas[0]).toMatchObject({ ultimo_erro: 'EMAIL_EXPIRADO', carga: null });
    expect(t.entregues).toHaveLength(0);
  });

  it('carga que não decifra (segredo do JWT trocado): EMAIL_CIFRA_INVALIDA, carga zerada', async () => {
    const t = transporteFalso();
    const o = outboxFalsa();
    await criarServicoEmail({ cifra: criarCifraEmail(derivarChaveEmail('outro-segredo'.repeat(4))), log: capturarLog().log, novoId: o.nova }).enfileirar(o.db, mensagem());
    const desp = criarDespachanteEmail({ worker: o.worker, transporte: t, cifra, remetente, log: capturarLog().log, agora: () => INSTANTE });
    expect(await desp.ciclo()).toMatchObject({ falhos: 1 });
    expect(o.linhas[0]).toMatchObject({ ultimo_erro: 'EMAIL_CIFRA_INVALIDA', carga: null });
  });

  it('erro estranho do adaptador (mensagem com dado pessoal): só o código vai para o banco e o log', async () => {
    const t = transporteFalso([new Error(`falhou para ${destinatario.email} com senha ${dadosAcesso.senha}`)]);
    const { o, cap, servico, desp } = await montar(t);
    await servico.enfileirar(o.db, mensagem());
    await desp.ciclo();
    expect(o.linhas[0]!.ultimo_erro).toBe('EMAIL_TRANSPORTE');
    expect(vazamentos(cap.json())).toEqual([]);
  });
});

describe('ponta a ponta com o adaptador de arquivo (MACUXI_EMAIL_ARQUIVO_DIR)', () => {
  let pasta = '';
  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'macuxi-email-desp-'));
  });
  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it('a senha aparece só no arquivo; banco sem carga depois do envio; log sem dado pessoal', async () => {
    const cap = capturarLog();
    const o = outboxFalsa();
    await criarServicoEmail({ cifra, log: cap.log, novoId: o.nova }).enfileirar(o.db, mensagem());
    const desp = criarDespachanteEmail({
      worker: o.worker,
      transporte: criarTransporteArquivo({ pasta, log: cap.log, agora: () => INSTANTE }),
      cifra,
      remetente,
      log: cap.log,
      agora: () => INSTANTE,
    });
    expect(await desp.ciclo()).toMatchObject({ enviados: 1 });
    const [arquivo] = await readdir(pasta);
    expect(arquivo).toBe(`20261107T120000Z-${o.linhas[0]!.id}.eml`);
    const eml = await readFile(join(pasta, arquivo!), 'utf8');
    expect(decodificarPartes(eml).texto).toContain(`\nSenha temporária\n${cargaAcesso.dados.senha}\n`);
    expect(o.linhas[0]!.carga).toBeNull();
    expect(vazamentos(cap.json())).toEqual([]);
  });
});
