import { describe, expect, it } from 'vitest';
import type { ClienteBanco } from '../api';
import {
  CHAVE_IDEMPOTENCIA_EMAIL_RE,
  CODIGOS_EMAIL,
  CodigoEmailSchema,
  criarServicoEmailMemoria,
  MensagemEmailSchema,
  type MensagemEmail,
} from './porta';

const USUARIO = '0b6f3c2e-6d1a-4f7e-9c2b-1a2b3c4d5e6f';
const db = {} as ClienteBanco;

const mensagem = (extra: Partial<MensagemEmail> = {}): MensagemEmail => ({
  modelo: 'acesso_inicial',
  usuario_id: USUARIO,
  para: 'Joaquina.Teste@Exemplo.com.br',
  dados: {
    nome: 'Joaquina Teste',
    empresa_nome: 'Distribuidora Rio Branco',
    codigo_empresa: 'RIOBRANCO',
    login: 'joaquina.teste@exemplo.com.br',
    senha: 'Prov1sor1a-Xq7',
    validade_horas: 72,
    apps: ['campo'],
  },
  chave_idempotencia: `${USUARIO}:acesso`,
  ...extra,
});

describe('porta ServicoEmail — MensagemEmail (desenho T-0094 §10)', () => {
  it('aceita a mensagem do desenho e normaliza o e-mail', () => {
    const v = MensagemEmailSchema.parse(mensagem());
    expect(v.para).toBe('joaquina.teste@exemplo.com.br');
  });

  it('RN-CORE-34: motivo obrigatório no nova_senha e proibido no acesso_inicial', () => {
    expect(() => MensagemEmailSchema.parse(mensagem({ modelo: 'nova_senha' }))).toThrowError();
    expect(MensagemEmailSchema.parse(mensagem({ modelo: 'nova_senha', dados: { ...mensagem().dados, motivo: 'esqueci' } })).modelo).toBe('nova_senha');
    expect(() => MensagemEmailSchema.parse(mensagem({ dados: { ...mensagem().dados, motivo: 'redefinida' } }))).toThrowError();
  });

  it('chave de idempotência no formato da coluna (sem @ nem espaço: nunca o e-mail)', () => {
    expect(CHAVE_IDEMPOTENCIA_EMAIL_RE.test(`${USUARIO}:redefinida:3`)).toBe(true);
    expect(() => MensagemEmailSchema.parse(mensagem({ chave_idempotencia: 'joaquina@exemplo.com.br' }))).toThrowError();
    expect(() => MensagemEmailSchema.parse(mensagem({ chave_idempotencia: 'a b' }))).toThrowError();
  });

  it('recusa campo a mais, CRLF no nome e senha com espaço nas pontas', () => {
    expect(() => MensagemEmailSchema.parse({ ...mensagem(), extra: 1 })).toThrowError();
    expect(() => MensagemEmailSchema.parse(mensagem({ dados: { ...mensagem().dados, nome: 'Ana\r\nBcc: x@y.z' } }))).toThrowError();
    expect(() => MensagemEmailSchema.parse(mensagem({ dados: { ...mensagem().dados, senha: ' Senha12345' } }))).toThrowError();
  });

  it('códigos com prefixo EMAIL_ e únicos', () => {
    const lista = Object.values(CODIGOS_EMAIL);
    expect(new Set(lista).size).toBe(lista.length);
    for (const c of lista) {
      expect(c).toMatch(/^EMAIL_[A-Z_]+$/);
      expect(CodigoEmailSchema.parse(c)).toBe(c);
    }
  });
});

describe('criarServicoEmailMemoria (contexto falso dos módulos)', () => {
  it('guarda a mensagem validada; a mesma chave não gera 2º e-mail', async () => {
    const s = criarServicoEmailMemoria();
    expect(await s.enfileirar(db, mensagem())).toBe('enfileirado');
    expect(await s.enfileirar(db, mensagem())).toBe('enfileirado');
    expect(s.enviados).toHaveLength(1);
  });

  it('desligado: indisponivel sem gravar', async () => {
    const s = criarServicoEmailMemoria({ disponivel: false });
    expect(s.disponivel()).toBe(false);
    expect(await s.enfileirar(db, mensagem())).toBe('indisponivel');
    expect(s.enviados).toHaveLength(0);
    s.ligar(true);
    expect(await s.enfileirar(db, mensagem())).toBe('enfileirado');
  });

  it('mensagem inválida lança (a rota desfaz a transação)', async () => {
    const s = criarServicoEmailMemoria();
    await expect(s.enfileirar(db, mensagem({ usuario_id: 'x' }))).rejects.toThrowError();
  });
});
