import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SinalConector } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { executarCli, type ES } from '../src/comandos';
import { Executor } from '../src/executor';
import { cicloPedidos } from '../src/pedidos';
import { avaliarVersaoLocal, guardarPolitica, lerPolitica } from '../src/politica';
import { reconciliarTudo } from '../src/reconciliacao';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { formatarStatus, montarStatus } from '../src/status';
import { VERSAO_CONECTOR } from '../src/versao';
import { type Ambiente, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente | undefined;
let dir = '';
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const politica = (minima: string, recomendada: string, mensagem?: string) => ({ versao_minima: minima, versao_recomendada: recomendada, ...(mensagem ? { mensagem } : {}) });

describe('atualização v1: política de versão do Hub (mínima e recomendada) e o Conector que reporta a própria versão', () => {
  it('o Conector informa a própria versão no cabeçalho de toda chamada, no lote e no sinal', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    const exec = new Executor(amb.ctx);
    await exec.ciclo();
    expect(amb.hub.chamadas.length).toBeGreaterThan(2);
    expect(amb.hub.chamadas.every((c) => c.versao === VERSAO_CONECTOR && c.conectorId === 'cnx-teste-01')).toBe(true);
    expect(amb.hub.envelopes[0]?.versao_conector).toBe(VERSAO_CONECTOR);
    expect(amb.hub.sinais[0]).toMatchObject({ conector_id: 'cnx-teste-01', versao_conector: VERSAO_CONECTOR });
    // o corpo do sinal obedece ao contrato `SinalConector`
    expect(SinalConector.safeParse(amb.hub.sinais[0]).success).toBe(true);
  });

  it('a política vem na resposta do sinal e fica guardada na fila local (sobrevive a reinício)', async () => {
    amb = await criarAmbiente();
    amb.hub.politicaVersao = politica('1.0.0', '1.1.0', 'Atualize até dezembro.');
    await new Executor(amb.ctx).ciclo();
    expect(lerPolitica(amb.ctx.store)?.politica).toMatchObject({ versao_minima: '1.0.0', versao_recomendada: '1.1.0', mensagem: 'Atualize até dezembro.' });
    amb.reiniciar();
    expect(lerPolitica(amb.ctx.store)?.politica.versao_recomendada).toBe('1.1.0');
    expect(avaliarVersaoLocal(amb.ctx.store, '1.1.0').situacao).toBe('ok');
  });

  it('abaixo da recomendada: `status` mostra DESATUALIZADO e o Conector segue enviando', async () => {
    amb = await criarAmbiente();
    amb.ctx.versao = '1.0.5';
    amb.hub.politicaVersao = politica('1.0.0', '1.1.0');
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    await new Executor(amb.ctx).ciclo();
    const s = montarStatus(amb.ctx.store, amb.ctx.config, '1.0.5');
    expect(s.versao).toMatchObject({ situacao: 'desatualizado', deveParar: false, minima: '1.0.0', recomendada: '1.1.0' });
    expect(formatarStatus(s)).toMatch(/CONECTOR 1\.0\.5\s+\[DESATUALIZADO\]/);
    expect(amb.hub.linhasDe('cliente')).toHaveLength(1); // enviou
    expect(amb.logs.join('\n')).toContain('versao_desatualizada');
  });

  it('abaixo da mínima: PARA de enviar lotes, retornos de pedido e reconciliação; registra o motivo no status e no log', async () => {
    amb = await criarAmbiente({ pedidos: PEDIDOS });
    amb.ctx.versao = '0.9.0';
    amb.hub.politicaVersao = politica('1.0.0', '1.1.0', 'Correção de segurança.');
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    const exec = new Executor(amb.ctx);
    await exec.ciclo(); // o sinal vai primeiro e traz a política; depois disso nada é enviado
    const enviosAntes = amb.hub.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes')).length;
    expect(enviosAntes).toBe(0);
    expect(amb.hub.envelopes).toHaveLength(0);
    expect(amb.hub.chamadas.filter((c) => c.caminho.includes('/pedidos/')).length).toBe(0);

    const s = montarStatus(amb.ctx.store, amb.ctx.config, '0.9.0');
    expect(s.versao).toMatchObject({ situacao: 'abaixo_da_minima', deveParar: true });
    const texto = formatarStatus(s);
    expect(texto).toMatch(/\[VERSÃO ABAIXO DA MÍNIMA\]/);
    expect(texto).toContain('parou de enviar');
    expect(texto).toContain('Correção de segurança.');
    expect(amb.logs.join('\n')).toContain('versao_abaixo_da_minima');

    // chamadas diretas também respeitam a parada
    expect(await sincronizarEntidade(amb.ctx, 'cliente')).toMatchObject({ adiado: expect.stringContaining('abaixo da mínima') });
    expect((await processarFila(amb.ctx)).interrompido).toContain('abaixo da mínima');
    expect((await cicloPedidos(amb.ctx)).erro).toContain('abaixo da mínima');
    expect(await reconciliarTudo(amb.ctx)).toEqual({ enviadas: 0, falhas: 0 });
    expect(amb.ctx.store.meta('ultima_reconciliacao')).toBeNull();

    // o sinal de vida segue, avisando o Hub que está parado por versão
    amb.relogio.avancar(61_000);
    await exec.ciclo();
    expect(amb.hub.sinais.at(-1)).toMatchObject({ parado_por_versao: true, versao_conector: '0.9.0' });
  });

  it('quando o Hub baixa a mínima (ou o Conector é atualizado), o envio volta sozinho e nada que estava na fila se perdeu', async () => {
    amb = await criarAmbiente();
    amb.ctx.versao = '0.9.0';
    guardarPolitica(amb.ctx.store, politica('1.0.0', '1.1.0'), amb.relogio.agora());
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    // lote já na fila antes da parada (montado numa versão boa)
    amb.ctx.versao = '1.1.0';
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.ctx.versao = '0.9.0';
    expect((await processarFila(amb.ctx)).enviados).toBe(0);
    expect(amb.ctx.store.contarLotes('cliente', ['pendente'])).toBe(1);

    // o Hub baixa a mínima: a próxima resposta de sinal libera
    amb.hub.politicaVersao = politica('0.9.0', '1.1.0');
    amb.relogio.avancar(61_000);
    const exec = new Executor(amb.ctx);
    await exec.ciclo();
    for (let i = 0; i < 3; i++) {
      await processarFila(amb.ctx);
      amb.relogio.avancar(6_000);
    }
    expect(amb.hub.linhasDe('cliente')).toHaveLength(1);
    expect(montarStatus(amb.ctx.store, amb.ctx.config, '0.9.0').versao.situacao).toBe('desatualizado');
  });

  it('sem política do Hub nada é restrito', async () => {
    amb = await criarAmbiente();
    amb.ctx.versao = '0.0.1';
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    await new Executor(amb.ctx).ciclo();
    expect(amb.hub.linhasDe('cliente')).toHaveLength(1);
    expect(montarStatus(amb.ctx.store, amb.ctx.config, '0.0.1').versao.situacao).toBe('sem_politica');
  });

  it('`conector status` sai com código 3 quando a versão está abaixo da mínima e mostra o motivo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'conector-ver-'));
    const arquivo = join(dir, 'conector.json');
    writeFileSync(
      arquivo,
      JSON.stringify({
        dadosDir: join(dir, 'dados'),
        hub: { url: 'http://127.0.0.1:9', conectorId: 'cnx-1' },
        erp: { tipo: 'postgres', host: 'localhost', banco: 'erp', usuario: 'u', criptografar: false },
        entidades: { produto: { consulta: 'SELECT * FROM v WHERE a > :cursor_alterado_em AND b > :cursor_external_id LIMIT :limite', campos: { external_id: 'codigo', alterado_em: 'alterado_em', sku: 'sku', nome: 'nome', unidade: 'un' } } },
      }),
    );
    const { Armazenamento } = await import('../src/armazenamento/armazenamento');
    const store = Armazenamento.abrir(join(dir, 'dados', 'fila.sqlite'));
    guardarPolitica(store, politica('99.0.0', '99.1.0'), Date.now());
    store.fechar();
    const saidas: string[] = [];
    const io: ES = { saida: (t) => void saidas.push(t), erro: (t) => void saidas.push(`ERRO ${t}`), lerEntrada: async () => '', env: {} };
    expect(await executarCli(['status', '--config', arquivo], io)).toBe(3);
    expect(saidas.join('\n')).toMatch(/\[VERSÃO ABAIXO DA MÍNIMA\]/);
    const json: string[] = [];
    await executarCli(['status', '--json', '--config', arquivo], { ...io, saida: (t) => void json.push(t) });
    expect(JSON.parse(json.join('')).versao).toMatchObject({ situacao: 'abaixo_da_minima', deveParar: true, atual: VERSAO_CONECTOR });
  });

  it('política ilegível guardada na fila local é ignorada (nunca para o Conector por engano)', async () => {
    amb = await criarAmbiente();
    amb.ctx.store.definirMeta('politica_versao', '{"versao_minima":"lixo"}');
    expect(lerPolitica(amb.ctx.store)).toBeNull();
    expect(avaliarVersaoLocal(amb.ctx.store, '0.0.1').deveParar).toBe(false);
  });
});

const PEDIDOS = {
  gravacao: { cabecalho: '/*cab*/ INSERT INTO pedido VALUES (:pedido_uuid)', numeroErp: '/*num*/ SELECT numero_erp FROM pedido WHERE uuid = :pedido_uuid' },
  status: { consulta: '/*st*/ SELECT * FROM v WHERE pedido_uuid = :pedido_uuid', mapaStatus: { I: 'integrado' } },
};
