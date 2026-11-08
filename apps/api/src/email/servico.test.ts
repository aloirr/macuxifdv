import { describe, expect, it } from 'vitest';
import type { ClienteBanco, MensagemEmail } from '@macuxi/platform-sdk';
import { capturarLog, dadosAcesso, destinatario, ID_ENVIO, TENANT, USUARIO, vazamentos } from './apoio-teste';
import { criarCifraEmail } from './cifra';
import { derivarChaveEmail, lerConfigEmail } from './config';
import { ErroEmail } from './erros';
import { criarServicoEmail, criarServicoEmailDaConfig, SERVICO_EMAIL_DESLIGADO } from './servico';

const SEGREDO = 'j'.repeat(40);
const cifra = criarCifraEmail(derivarChaveEmail(SEGREDO));

/** `ClienteBanco` falso da transação do tenant: guarda os `insert` em `plataforma.email_saida` (único por tenant + chave). */
function bancoFalso(tenant: string | null = TENANT) {
  const linhas: { params: unknown[] }[] = [];
  const sqls: string[] = [];
  const db: ClienteBanco = {
    query: (async (sql: string, params: unknown[] = []) => {
      sqls.push(sql);
      if (sql.includes('tenant_atual()')) return { rows: [{ tenant_id: tenant }], rowCount: 1 };
      if (sql.includes('insert into plataforma.email_saida')) {
        const dup = linhas.some((l) => l.params[1] === params[1] && l.params[4] === params[4]);
        if (dup) return { rows: [], rowCount: 0 };
        linhas.push({ params });
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      throw new Error(`sql inesperado: ${sql}`);
    }) as ClienteBanco['query'],
  };
  return { db, linhas, sqls };
}

const mensagem = (extra: Partial<MensagemEmail> = {}): MensagemEmail => ({
  modelo: 'acesso_inicial',
  usuario_id: USUARIO,
  para: destinatario.email,
  dados: dadosAcesso,
  chave_idempotencia: `${USUARIO}:acesso`,
  ...extra,
});

describe('ServicoEmail.enfileirar — outbox plataforma.email_saida (desenho T-0094 §10)', () => {
  it('um insert pela conexão recebida, carga cifrada com AAD id|tenant|modelo; nada pessoal fora da carga nem no log', async () => {
    const cap = capturarLog();
    const b = bancoFalso();
    const s = criarServicoEmail({ cifra, log: cap.log, novoId: () => ID_ENVIO });
    expect(s.disponivel()).toBe(true);
    expect(await s.enfileirar(b.db, mensagem())).toBe('enfileirado');
    expect(b.linhas).toHaveLength(1);
    const [id, tenant, usuario, modelo, chave, carga, horas] = b.linhas[0]!.params as [string, string, string, string, string, Buffer, number];
    expect({ id, tenant, usuario, modelo, chave, horas }).toEqual({ id: ID_ENVIO, tenant: TENANT, usuario: USUARIO, modelo: 'acesso_inicial', chave: `${USUARIO}:acesso`, horas: 72 });
    expect(Buffer.isBuffer(carga)).toBe(true);
    expect(vazamentos(carga.toString('latin1'))).toEqual([]);
    expect(cifra.decifrar(carga, { id: ID_ENVIO, tenant_id: TENANT, modelo: 'acesso_inicial' }).dados.senha).toBe(dadosAcesso.senha);
    expect(b.sqls.join('\n')).toContain('on conflict (tenant_id, chave_idempotencia) do nothing');
    expect(vazamentos(cap.json())).toEqual([]);
    expect(cap.linhas[0]!.obj).toMatchObject({ evento: 'enfileirado', email_id: ID_ENVIO, tenant_id: TENANT, modelo: 'acesso_inicial' });
  });

  it('a mesma chave_idempotencia não gera 2º e-mail (enfileirado, sem 2ª linha)', async () => {
    const b = bancoFalso();
    const s = criarServicoEmail({ cifra, log: capturarLog().log });
    await s.enfileirar(b.db, mensagem());
    expect(await s.enfileirar(b.db, mensagem())).toBe('enfileirado');
    expect(b.linhas).toHaveLength(1);
  });

  it('validade nula (admin inicial, P5): a linha vive 72 h', async () => {
    const b = bancoFalso();
    await criarServicoEmail({ cifra, log: capturarLog().log }).enfileirar(b.db, mensagem({ dados: { ...dadosAcesso, validade_horas: null } }));
    expect(b.linhas[0]!.params[6]).toBe(72);
  });

  it('mensagem inválida: lança EMAIL_DADOS_INVALIDOS sem gravar e sem o valor no erro nem no log', async () => {
    const cap = capturarLog();
    const b = bancoFalso();
    const s = criarServicoEmail({ cifra, log: cap.log });
    const p = s.enfileirar(b.db, mensagem({ para: 'sem-arroba-joaquina', dados: { ...dadosAcesso, senha: 'curta' } }));
    await expect(p).rejects.toBeInstanceOf(ErroEmail);
    const e = (await p.catch((x: unknown) => x)) as ErroEmail;
    expect(e.codigo).toBe('EMAIL_DADOS_INVALIDOS');
    expect(b.linhas).toHaveLength(0);
    for (const texto of [e.message, JSON.stringify(e), cap.json()]) {
      expect(texto).not.toContain('sem-arroba-joaquina');
      expect(texto).not.toContain('curta');
    }
  });

  it('fora do comTenant (sem tenant no contexto): lança sem gravar', async () => {
    const b = bancoFalso(null);
    await expect(criarServicoEmail({ cifra, log: capturarLog().log }).enfileirar(b.db, mensagem())).rejects.toBeInstanceOf(ErroEmail);
    expect(b.linhas).toHaveLength(0);
  });

  it('sem adaptador: disponivel() = false e indisponivel sem tocar o banco', async () => {
    for (const s of [SERVICO_EMAIL_DESLIGADO, criarServicoEmail({ cifra: null, log: capturarLog().log }), criarServicoEmailDaConfig(lerConfigEmail({}), capturarLog().log)]) {
      const b = bancoFalso();
      expect(s.disponivel()).toBe(false);
      expect(await s.enfileirar(b.db, mensagem())).toBe('indisponivel');
      expect(b.sqls).toEqual([]);
    }
  });

  it('da configuração: arquivo ou SMTP = disponível; registra a configuração sem segredo', () => {
    const cap = capturarLog();
    const s = criarServicoEmailDaConfig(lerConfigEmail({ MACUXI_EMAIL_ARQUIVO_DIR: '/tmp/caixa', MACUXI_JWT_SEGREDO: SEGREDO }), cap.log);
    expect(s.disponivel()).toBe(true);
    expect(cap.json()).not.toContain(SEGREDO);
    expect(cap.linhas[0]!.obj).toMatchObject({ transporte: 'arquivo', origem_chave: 'MACUXI_JWT_SEGREDO' });
  });
});
