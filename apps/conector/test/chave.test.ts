import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executarCli, type ES } from '../src/comandos';
import { ClienteHub, ErroHubAutenticacao } from '../src/hub/cliente';
import { criarLogger } from '../src/log/logger';
import { limparSegredosRegistrados, mascararTexto, mascararValor, registrarSegredo } from '../src/log/mascara';
import { validarFormatoChave } from '../src/segredos/chave';
import { ProvedorEnv, Segredos, type ExecutarPowerShell } from '../src/segredos/provedores';
import { HubFalso } from './suporte/hub-falso';

const CHAVE_ANTIGA = 'mxk_antiga_0123456789abcdef0123';
const CHAVE_NOVA = 'mxk_nova_ABCDEFGHIJKLMNOP9876543210';

let hub: HubFalso;
let dir = '';
beforeEach(async () => {
  hub = await HubFalso.iniciar();
  hub.chavesExtras.add(CHAVE_NOVA); // janela de rotação: a nova já vale no Hub
});
afterEach(async () => {
  await hub.parar();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
  limparSegredosRegistrados();
});

function arquivoConfig(extra: Record<string, unknown> = {}, conectorId = 'cnx-teste-01') {
  dir = mkdtempSync(join(tmpdir(), 'conector-chave-'));
  const arquivo = join(dir, 'conector.json');
  writeFileSync(
    arquivo,
    JSON.stringify({
      dadosDir: join(dir, 'dados'),
      hub: { url: hub.url, conectorId, retry: { tentativas: 1, baseMs: 1, maxMs: 2 } },
      erp: { tipo: 'postgres', host: 'localhost', banco: 'erp', usuario: 'u', criptografar: false },
      entidades: { produto: { consulta: 'SELECT * FROM v WHERE a > :cursor_alterado_em AND b > :cursor_external_id LIMIT :limite', campos: { external_id: 'codigo', alterado_em: 'alterado_em', sku: 'sku', nome: 'nome', unidade: 'un' } } },
      ...extra,
    }),
  );
  return arquivo;
}

function es(entrada: string, extra: Partial<ES> = {}) {
  const saidas: string[] = [];
  const erros: string[] = [];
  const powershell: { script: string; entrada?: string }[] = [];
  const executarPowerShell: ExecutarPowerShell = async (script, e) => {
    powershell.push({ script, entrada: e });
    return { codigo: 0, saida: '', erro: '' };
  };
  const io: ES = { saida: (t) => void saidas.push(t), erro: (t) => void erros.push(t), lerEntrada: async () => entrada, env: {}, plataforma: 'win32', executarPowerShell, ...extra };
  return { io, saidas, erros, powershell, tudo: () => [...saidas, ...erros].join('\n') };
}

function todosOsLogs(): string {
  try {
    const pasta = join(dir, 'dados', 'logs');
    return readdirSync(pasta).map((f) => readFileSync(join(pasta, f), 'utf8')).join('\n');
  } catch {
    return '';
  }
}

describe('chave de API por Conector: formato', () => {
  it('recusa vazia, com espaço, curta demais, longa demais e fora do ASCII; nunca ecoa o valor', () => {
    expect(validarFormatoChave('')).toMatch(/vazia/);
    expect(validarFormatoChave('mxk com espaco 1234567890')).toMatch(/espaço/);
    expect(validarFormatoChave('curta')).toMatch(/menos de 16/);
    expect(validarFormatoChave('x'.repeat(600))).toMatch(/passa de 512/);
    expect(validarFormatoChave('chave-com-acento-é-1234567')).toMatch(/ASCII/);
    expect(validarFormatoChave(CHAVE_NOVA)).toBeNull();
    for (const ruim of ['curta', 'mxk com espaco 1234567890']) expect(validarFormatoChave(ruim)).not.toContain(ruim);
  });
});

describe('conector trocar-chave', () => {
  it('testa a chave nova no Hub (com o identificador do Conector), grava no Gerenciador de Credenciais pela entrada padrão e não vaza a chave', async () => {
    const arquivo = arquivoConfig();
    const a = es(`${CHAVE_NOVA}\r\n`);
    const codigo = await executarCli(['trocar-chave', '--config', arquivo], a.io);
    expect(codigo, a.tudo()).toBe(0);
    expect(a.saidas.join('\n')).toMatch(/gravada no Gerenciador de Credenciais.*cnx-teste-01.*60 s, sem reiniciar/s);
    // a chave foi para o PowerShell por stdin, nunca no script (que vai por -EncodedCommand/argumento do processo)
    expect(a.powershell).toHaveLength(1);
    expect(a.powershell[0]?.entrada).toBe(CHAVE_NOVA);
    expect(a.powershell[0]?.script).toContain("'Macuxi.Conector/hub_chave'");
    expect(a.powershell[0]?.script).not.toContain(CHAVE_NOVA);
    // o Hub viu o identificador e o teste foi feito com a chave nova
    const teste = hub.chamadas.find((c) => c.caminho.includes('/cursores/'));
    expect(teste).toMatchObject({ conectorId: 'cnx-teste-01' });
    // nada vaza: saída, erros e arquivos de log
    expect(a.tudo()).not.toContain(CHAVE_NOVA);
    expect(todosOsLogs()).not.toContain(CHAVE_NOVA);
    expect(todosOsLogs()).toContain('chave_hub_trocada');
  });

  it('o Hub recusa a chave: NADA é gravado, a atual continua valendo e a mensagem diz o que conferir', async () => {
    const arquivo = arquivoConfig();
    const ruim = 'mxk_chave_que_o_hub_nao_conhece_99';
    const a = es(ruim);
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(1);
    expect(a.powershell).toHaveLength(0);
    expect(a.erros.join('\n')).toMatch(/Hub recusou a chave nova.*cnx-teste-01.*Nada foi gravado.*chave atual continua valendo.*hub\.conectorId/s);
    expect(a.tudo()).not.toContain(ruim);
  });

  it('identificador do Conector diferente do cadastrado no Hub também é recusado', async () => {
    const arquivo = arquivoConfig({}, 'cnx-outro');
    const a = es(CHAVE_NOVA);
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(1);
    expect(a.powershell).toHaveLength(0);
  });

  it('Hub fora do ar: não grava (a menos que --sem-testar)', async () => {
    const arquivo = arquivoConfig();
    hub.caido = true;
    const a = es(CHAVE_NOVA);
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(1);
    expect(a.erros.join('\n')).toMatch(/Não consegui falar com o Hub.*Nada foi gravado.*--sem-testar/s);
    expect(a.powershell).toHaveLength(0);
    const b = es(CHAVE_NOVA);
    expect(await executarCli(['trocar-chave', '--sem-testar', '--config', arquivo], b.io)).toBe(0);
    expect(b.powershell).toHaveLength(1);
  });

  it('formato inválido (curta, com espaço, vazia) sai com código 2 e não grava nem chama o Hub', async () => {
    const arquivo = arquivoConfig();
    for (const entrada of ['', 'curta', 'tem espaco no meio 1234567']) {
      const a = es(entrada);
      expect(await executarCli(['trocar-chave', '--config', arquivo], a.io), entrada).toBe(2);
      expect(a.powershell).toHaveLength(0);
    }
    expect(hub.chamadas).toHaveLength(0);
  });

  it('fora do Windows (fallback): valida mas não grava, orienta a variável de ambiente e sai com 4', async () => {
    const arquivo = arquivoConfig();
    const a = es(CHAVE_NOVA, { plataforma: 'linux' });
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(4);
    expect(a.powershell).toHaveLength(0);
    expect(a.erros.join('\n')).toMatch(/NÃO gravada.*MACUXI_CONECTOR_HUB_CHAVE.*reinicie o serviço/s);
    expect(a.tudo()).not.toContain(CHAVE_NOVA);
  });

  it('provedor configurado como env também não grava no Windows', async () => {
    const arquivo = arquivoConfig({ segredos: { provedor: 'env' } });
    const a = es(CHAVE_NOVA);
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(4);
    expect(a.erros.join('\n')).toContain('o provedor configurado é "env"');
  });

  it('avisa quando a variável de ambiente (que tem prioridade) ainda guarda a chave antiga', async () => {
    const arquivo = arquivoConfig();
    const a = es(CHAVE_NOVA, { env: { MACUXI_CONECTOR_HUB_CHAVE: CHAVE_ANTIGA } });
    expect(await executarCli(['trocar-chave', '--config', arquivo], a.io)).toBe(0);
    expect(a.saidas.join('\n')).toMatch(/ATENÇÃO.*MACUXI_CONECTOR_HUB_CHAVE.*prioridade.*ANTIGA/s);
  });

  it('a chave aparece como argumento? não: o comando não aceita a chave em argumento (só entrada padrão)', async () => {
    const arquivo = arquivoConfig();
    const a = es('');
    // uma chave passada como argumento posicional é ignorada: o valor vem só da entrada, que está vazia
    expect(await executarCli(['trocar-chave', CHAVE_NOVA, '--config', arquivo], a.io)).toBe(2);
    expect(a.powershell).toHaveLength(0);
  });
});

describe('rotação sem reiniciar o serviço', () => {
  it('o Hub passa a recusar a chave antiga; ao gravar a nova, o serviço a usa em até 60 s (cache do segredo), sem reinstalar', async () => {
    hub.chavesExtras.clear();
    const env: NodeJS.ProcessEnv = { MACUXI_CONECTOR_HUB_CHAVE: hub.token };
    let agora = 0;
    const segredos = new Segredos(new ProvedorEnv(env), 60_000, () => agora);
    const cliente = new ClienteHub({ url: hub.url, token: () => segredos.exigir('hub_chave'), conectorId: 'cnx-teste-01', retry: { tentativas: 1, baseMs: 1, maxMs: 2 } });
    await expect(cliente.consultarCursor('cliente')).resolves.toBeDefined();

    // o Hub revoga a chave antiga e aceita só a nova
    hub.chavesExtras.add(CHAVE_NOVA);
    hub.tokenValido = true;
    (hub as unknown as { token: string }).token = 'revogada-' + hub.token;
    env.MACUXI_CONECTOR_HUB_CHAVE = CHAVE_NOVA;
    agora += 30_000;
    await expect(cliente.consultarCursor('cliente')).rejects.toBeInstanceOf(ErroHubAutenticacao); // ainda no cache da chave antiga
    agora += 31_000;
    await expect(cliente.consultarCursor('cliente')).resolves.toBeDefined(); // releu: nova chave
  });

  it('a mensagem de credencial recusada manda usar `conector trocar-chave`', async () => {
    const cliente = new ClienteHub({ url: hub.url, token: async () => 'chave-errada-1234567890', conectorId: 'cnx-teste-01', retry: { tentativas: 1 } });
    await expect(cliente.consultarCursor('cliente')).rejects.toThrow(/conector trocar-chave/);
  });
});

describe('a chave nunca vai para o log', () => {
  it('registrada como segredo, é mascarada em qualquer texto; chaves/cabeçalhos de API são mascarados por nome', () => {
    registrarSegredo(CHAVE_NOVA);
    expect(mascararTexto(`falhou com ${CHAVE_NOVA} no cabeçalho`)).toBe('falhou com *** no cabeçalho');
    expect(mascararTexto(`Authorization: Bearer ${CHAVE_ANTIGA}`)).toBe('Authorization: Bearer ***');
    expect(mascararTexto('hub_chave=abc123def456')).toBe('hub_chave=***');
    expect(mascararTexto('x-api-key: abc123def456')).toBe('x-api-key=***');
    expect(mascararTexto('chave de api: abc123def456')).toBe('chave de api=***');
    expect(mascararTexto('idempotency-key: 9f2c')).toBe('idempotency-key: 9f2c'); // não é segredo
    const v = mascararValor({ hub_chave: CHAVE_ANTIGA, 'x-api-key': CHAVE_ANTIGA, conector_id: 'cnx-1', cabecalhos: { Authorization: `Bearer ${CHAVE_ANTIGA}` } }) as Record<string, unknown>;
    expect(v).toEqual({ hub_chave: '***', 'x-api-key': '***', conector_id: 'cnx-1', cabecalhos: { Authorization: '***' } });
  });

  it('o logger grava a linha mascarada mesmo que a chave apareça numa mensagem de erro', () => {
    const linhas: string[] = [];
    const log = criarLogger({ escrever: (l) => linhas.push(l), nivel: 'info' });
    registrarSegredo(CHAVE_NOVA);
    log.aviso('hub_falhou', { erro: `HTTP 401 usando ${CHAVE_NOVA}`, chave: CHAVE_NOVA, hub_chave: CHAVE_NOVA });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).not.toContain(CHAVE_NOVA);
    expect(JSON.parse(linhas[0] as string)).toMatchObject({ erro: 'HTTP 401 usando ***', chave: '***', hub_chave: '***' });
  });

  it('o arquivo de configuração não aceita a chave (nem com o nome hub_chave ou chave)', async () => {
    const { interpretarConfig } = await import('../src/config/carregar');
    const base = { hub: { url: 'https://h.example.com', conectorId: 'c1' }, erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' }, entidades: {} };
    for (const campo of ['hub_chave', 'chave', 'apiKey']) {
      expect(() => interpretarConfig(JSON.stringify({ ...base, hub: { ...base.hub, [campo]: 'abc' } }), 'json'), campo).toThrow(/Segredo no arquivo.*MACUXI_CONECTOR_HUB_CHAVE/s);
    }
  });
});
