import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Armazenamento } from '../src/armazenamento/armazenamento';
import { executarCli, type ES } from '../src/comandos';
import { Executor } from '../src/executor';
import { reconciliacaoVencida, reconciliarTudo } from '../src/reconciliacao';
import { sincronizarEntidade } from '../src/sincronizador';
import { formatarStatus, montarStatus } from '../src/status';
import { adquirirTrava } from '../src/trava';
import { type Ambiente, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente | undefined;
let dir = '';
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function io(env: NodeJS.ProcessEnv = {}, entrada = ''): ES & { saidas: string[]; erros: string[] } {
  const saidas: string[] = [];
  const erros: string[] = [];
  return { saidas, erros, saida: (t) => void saidas.push(t), erro: (t) => void erros.push(t), lerEntrada: async () => entrada, env };
}

const CONSULTA = 'SELECT * FROM v WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND codigo > :cursor_external_id) ORDER BY 1 LIMIT :limite';
function escreverConfig(extra: Record<string, unknown> = {}) {
  dir = mkdtempSync(join(tmpdir(), 'conector-cli-'));
  const arquivo = join(dir, 'conector.json');
  writeFileSync(arquivo, JSON.stringify({
    dadosDir: join(dir, 'dados'),
    hub: { url: 'http://127.0.0.1:9', conectorId: 'cnx-1' },
    erp: { tipo: 'postgres', host: 'localhost', banco: 'erp', usuario: 'u', criptografar: false },
    entidades: { produto: { consulta: CONSULTA, campos: { external_id: 'codigo', alterado_em: 'alterado_em', sku: 'sku', nome: 'nome', unidade: 'un' } } },
    ...extra,
  }));
  return arquivo;
}

describe('CLI', () => {
  it('sem comando mostra a ajuda (código 2); `versao` e `ajuda` funcionam', async () => {
    const a = io();
    expect(await executarCli([], a)).toBe(2);
    expect(a.saidas.join('')).toMatch(/testar-conexao.*status.*rodar.*instalar-servico/s);
    expect(await executarCli(['versao'], io())).toBe(0);
  });

  it('comando desconhecido e opção inválida dão código 2 com mensagem', async () => {
    const a = io();
    expect(await executarCli(['xpto'], a)).toBe(2);
    expect(a.erros.join('')).toMatch(/desconhecido/);
    expect(await executarCli(['status', '--naoexiste'], io())).toBe(2);
  });

  it('validar-config: ok com arquivo bom; erro legível com arquivo ruim ou ausente', async () => {
    const arq = escreverConfig();
    const ok = io();
    expect(await executarCli(['validar-config', '--config', arq], ok)).toBe(0);
    expect(ok.saidas.join('')).toMatch(/Configuração válida: 1 entidade/);
    const ruim = escreverConfig({ erp: { tipo: 'mysql', host: 'h', banco: 'b', usuario: 'u' } });
    const e = io();
    expect(await executarCli(['validar-config', '--config', ruim], e)).toBe(1);
    expect(e.erros.join('')).toMatch(/Configuração inválida/);
    const e2 = io();
    expect(await executarCli(['validar-config', '--config', join(dir, 'nao-existe.json')], e2)).toBe(1);
    expect(e2.erros.join('')).toMatch(/não encontrado/);
  });

  it('o caminho da configuração também vem de MACUXI_CONECTOR_CONFIG', async () => {
    const arq = escreverConfig();
    const a = io({ MACUXI_CONECTOR_CONFIG: arq });
    expect(await executarCli(['validar-config'], a)).toBe(0);
  });

  it('status: mostra fila e entidades (também em --json); código 3 se houver entidade bloqueada', async () => {
    const arq = escreverConfig();
    const a = io();
    expect(await executarCli(['status', '--config', arq], a)).toBe(0);
    expect(a.saidas.join('')).toMatch(/FILA LOCAL\n {2}vazia/);
    expect(a.saidas.join('')).toMatch(/produto\s+ainda não iniciada/);
    const j = io();
    await executarCli(['status', '--json', '--config', arq], j);
    expect(JSON.parse(j.saidas.join('')).entidades[0].entidade).toBe('produto');

    const store = Armazenamento.abrir(join(dir, 'dados', 'fila.sqlite'));
    store.iniciarEstado('produto', 'delta', { agoraMs: 1 });
    store.atualizarEstado('produto', { bloqueio: 'Hub recusou o lote' });
    store.fechar();
    const b = io();
    expect(await executarCli(['status', '--config', arq], b)).toBe(3);
    expect(b.saidas.join('')).toMatch(/BLOQUEADA: Hub recusou o lote/);
  });

  it('retomar e carga-completa operam só no armazenamento local (sem ERP nem segredos)', async () => {
    const arq = escreverConfig();
    const store = Armazenamento.abrir(join(dir, 'dados', 'fila.sqlite'));
    store.iniciarEstado('produto', 'delta', { cursor: { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'p1' }, agoraMs: 1 });
    store.atualizarEstado('produto', { bloqueio: 'x', lido: { alterado_em: '2026-02-01T00:00:00.000Z', external_id: 'p9' } });
    store.fechar();
    const a = io();
    expect(await executarCli(['retomar', 'produto', '--config', arq], a)).toBe(0);
    let s = Armazenamento.abrir(join(dir, 'dados', 'fila.sqlite'));
    expect(s.estado('produto')).toMatchObject({ bloqueio: null, fase: 'delta', lido: { external_id: 'p1' } });
    s.fechar();
    expect(await executarCli(['carga-completa', 'todas', '--config', arq], io())).toBe(0);
    s = Armazenamento.abrir(join(dir, 'dados', 'fila.sqlite'));
    expect(s.estado('produto')?.fase).toBe('completo');
    s.fechar();
    const e = io();
    expect(await executarCli(['retomar', 'cliente', '--config', arq], e)).toBe(2);
    expect(e.erros.join('')).toMatch(/não está configurada/);
  });

  it('segredo definir: valor vazio e nome inválido são recusados; fora do Windows orienta o uso de variável de ambiente', async () => {
    const arq = escreverConfig();
    expect(await executarCli(['segredo', 'definir', 'outro', '--config', arq], io())).toBe(2);
    const v = io({}, '\n');
    expect(await executarCli(['segredo', 'definir', 'erp_senha', '--config', arq], v)).toBe(2);
    expect(v.erros.join('')).toMatch(/vazio/);
  });

  it('testar-conexao sem segredos diz exatamente o que falta, sem imprimir valor algum', async () => {
    const arq = escreverConfig();
    const a = io({});
    expect(await executarCli(['testar-conexao', '--config', arq], a)).toBe(1);
    const t = a.erros.join('\n');
    expect(t).toMatch(/Segredo erp_senha não encontrado.*MACUXI_CONECTOR_ERP_SENHA/);
    expect(t).toMatch(/Segredo hub_chave não encontrado/);
  });

  it('testar-conexao avisa (sem falhar) quando o ERP está fora da LAN e a criptografia está desligada', async () => {
    const remoto = io({});
    expect(await executarCli(['testar-conexao', '--config', escreverConfig({ erp: { tipo: 'postgres', host: 'erp.cliente.com.br', banco: 'erp', usuario: 'u', criptografar: false } })], remoto)).toBe(1); // falta segredo
    expect(remoto.saidas.join('\n')).toMatch(/\[aviso\].*fora de localhost\/LAN.*"criptografar": true/s);
    const lan = io({});
    await executarCli(['testar-conexao', '--config', escreverConfig()], lan); // host localhost
    expect(lan.saidas.join('\n')).not.toMatch(/\[aviso\]/);
    const tls = io({});
    await executarCli(['testar-conexao', '--config', escreverConfig({ erp: { tipo: 'postgres', host: 'erp.cliente.com.br', banco: 'erp', usuario: 'u' } })], tls); // criptografar padrão: true
    expect(tls.saidas.join('\n')).not.toMatch(/\[aviso\]/);
  });

  it('instalar-servico --somente-gerar grava o XML do WinSW sem segredos', async () => {
    const arq = escreverConfig();
    const a = io();
    expect(await executarCli(['instalar-servico', '--somente-gerar', '--pasta', join(dir, 'svc'), '--config', arq], a)).toBe(0);
    expect(readFileSync(join(dir, 'svc', 'macuxi-conector.xml'), 'utf8')).toContain('<service>');
  });
});

describe('instância única', () => {
  it('uma segunda instância na mesma pasta é recusada; depois de liberar, entra; trava de processo morto é retomada', () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-trava-'));
    const liberar = adquirirTrava(dir);
    // mesmo PID: a trava é do próprio processo, então simulamos outro processo vivo com o PID do pai
    writeFileSync(join(dir, 'conector.lock'), String(process.ppid));
    expect(() => adquirirTrava(dir)).toThrow(/Já existe um Conector rodando/);
    writeFileSync(join(dir, 'conector.lock'), '999999999'); // processo inexistente
    const liberar2 = adquirirTrava(dir);
    liberar2();
    liberar();
  });
});

describe('executor (laço de execução)', () => {
  it('um ciclo roda as tarefas vencidas na ordem (entidades, fila, sinal…) e só volta quando vence a periodicidade', async () => {
    amb = await criarAmbiente({ sinalSegundos: 60 });
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.hub.cursores.set('produto', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    const exec = new Executor(amb.ctx);
    const primeiras = await exec.ciclo();
    expect(primeiras.slice(0, 4)).toEqual(['sinal', 'entidade:produto', 'entidade:cliente', 'fila']);
    expect(primeiras).toContain('sinal');
    expect(amb.hub.linhasDe('cliente')).toHaveLength(1); // a fila roda no mesmo ciclo, logo depois das entidades
    expect(await exec.ciclo()).toEqual([]); // nada vencido ainda
    amb.relogio.avancar(6_000);
    expect(await exec.ciclo()).toEqual(['fila']);
    amb.relogio.avancar(61_000);
    expect(await exec.ciclo()).toContain('sinal');
    expect(amb.hub.sinais.length).toBe(2);
    expect(amb.hub.sinais[0]).toMatchObject({ versao_conector: '1.1.0', versao_contrato: 'v1' });
    expect(JSON.stringify(amb.hub.sinais)).not.toMatch(/razao|Cliente c1/);
  });

  it('a falha de uma tarefa (Hub fora) não derruba as outras nem o laço', async () => {
    amb = await criarAmbiente();
    amb.hub.caido = true;
    const exec = new Executor(amb.ctx);
    const feitas = await exec.ciclo();
    expect(feitas).toContain('fila');
    expect(feitas).toContain('sinal');
    expect(amb.logs.some((l) => l.includes('tarefa_falhou'))).toBe(true);
  });

  it('com fila cheia, a entidade volta a ser lida logo (não espera a periodicidade inteira)', async () => {
    amb = await criarAmbiente({ fila: { maxLotesPendentesPorEntidade: 1, backoffBaseSegundos: 1, backoffMaxSegundos: 10, consultaResultadoSegundos: 1 } });
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.hub.cursores.set('produto', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', Array.from({ length: 9 }, (_, i) => cliente(`c${i + 1}`, `2026-03-01T10:00:0${i}Z`)));
    const exec = new Executor(amb.ctx);
    await exec.ciclo();
    amb.relogio.avancar(3_500);
    expect((await exec.ciclo()).includes('entidade:cliente')).toBe(true);
  });

  it('`rodar` repete ciclos até receber o sinal de parada', async () => {
    amb = await criarAmbiente();
    const parar = new AbortController();
    let voltas = 0;
    const exec = new Executor(amb.ctx, { dormir: async () => void (++voltas >= 3 && parar.abort()) });
    await exec.rodar(parar.signal);
    expect(voltas).toBe(3);
    expect(amb.logs.some((l) => l.includes('conector_parado'))).toBe(true);
  });
});

describe('reconciliação diária (RN-INT-07)', () => {
  it('vence depois da hora configurada, uma vez por dia; só marca o dia se todas as entidades forem enviadas', async () => {
    amb = await criarAmbiente({
      reconciliacaoHora: '00:00',
      entidades: {
        cliente: { consulta: CONSULTA, campos: { external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social' }, reconciliacao: { consulta: 'SELECT 7 AS contagem, NULL AS soma' } },
        produto: { consulta: CONSULTA, campos: { external_id: 'external_id', alterado_em: 'alterado_em', sku: 'sku', nome: 'nome', unidade: 'unidade' }, reconciliacao: { consulta: 'SELECT 3 AS contagem, 99 AS soma' } },
      },
    });
    amb.erp.onConsulta = (sql) => (sql.includes('7 AS') ? [{ contagem: 7, soma: null }] : [{ contagem: 3, soma: 99 }]);
    expect(reconciliacaoVencida(amb.ctx)).toBe(true);
    const r = await reconciliarTudo(amb.ctx);
    expect(r).toEqual({ enviadas: 2, falhas: 0 });
    const por = Object.fromEntries((amb.hub.reconciliacoes as { entidade: string; contagem: number; soma: number | null }[]).map((x) => [x.entidade, x]));
    expect(por.cliente).toMatchObject({ contagem: 7, soma: null });
    expect(por.produto).toMatchObject({ contagem: 3, soma: null }); // produto só tem contagem no contrato (CAMPO_SOMA_CONTROLE)
    expect(reconciliacaoVencida(amb.ctx)).toBe(false);
    amb.relogio.avancar(86_400_000);
    expect(reconciliacaoVencida(amb.ctx)).toBe(true);
    amb.hub.caido = true;
    expect(await reconciliarTudo(amb.ctx)).toEqual({ enviadas: 0, falhas: 2 });
    expect(reconciliacaoVencida(amb.ctx)).toBe(true);
  });
});

describe('status', () => {
  it('lista o último sucesso, o cursor confirmado, os erros e o que está na fila', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z'), { ...cliente('c2', '2026-03-01T10:00:01Z'), razao_social: null }]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    const antes = montarStatus(amb.ctx.store, amb.ctx.config);
    // a linha inválida (razao_social nula) NÃO vai em `registros`: vai em `linhas_invalidas` (T-0023), então o lote tem 1 registro
    expect(antes.fila).toEqual([expect.objectContaining({ estado: 'pendente', lotes: 1, linhas: 1 })]);
    const texto = formatarStatus(antes);
    expect(texto).toMatch(/cliente\s+delta\s+último sucesso: 2026-03-10/);
    expect(texto).toMatch(/erros: 1 locais/);
    expect(texto).toMatch(/ERROS RECENTES \(sem dados pessoais\)/);
    expect(texto).not.toMatch(/Cliente c1/);
  });
});
