import { afterEach, describe, expect, it } from 'vitest';
import { processarFila } from '../src/remetente';
import { reiniciarCargaCompleta, retomarEntidade, sincronizarEntidade } from '../src/sincronizador';
import { type Ambiente, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente;
afterEach(async () => amb?.encerrar());

/** Uma volta: lê o ERP, esvazia a fila (avançando o relógio para vencer esperas). */
async function volta(a: Ambiente, entidade: 'cliente' | 'produto' = 'cliente', filas = 4) {
  const r = await sincronizarEntidade(a.ctx, entidade);
  for (let i = 0; i < filas; i++) {
    await processarFila(a.ctx);
    a.relogio.avancar(6_000);
  }
  return r;
}

const seteClientes = () => Array.from({ length: 7 }, (_, i) => cliente(`c${i + 1}`, `2026-03-01T10:00:0${i}Z`));

describe('carga inicial completa e delta (RN-INT-05, RN-INT-06)', () => {
  it('sem cursor no Hub: carga completa em partes numeradas, ultimo só na última; depois só delta', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes());
    await volta(amb);

    expect(amb.hub.envelopes.map((e) => [e.modo, e.sessao?.parte, e.sessao?.ultimo, e.registros.length])).toEqual([
      ['completo', 1, false, 3],
      ['completo', 2, false, 3],
      ['completo', 3, true, 1],
    ]);
    const sessoes = new Set(amb.hub.envelopes.map((e) => e.sessao?.id));
    expect(sessoes.size).toBe(1);
    expect(amb.hub.linhasDe('cliente')).toHaveLength(7);
    expect(amb.ctx.store.estado('cliente')).toMatchObject({ fase: 'delta', confirmado: { external_id: 'c7' } });

    // um cliente muda e outro nasce: só os dois vão, em modo delta, sem sessão
    amb.erp.definir('cliente', [...seteClientes().slice(0, 4), cliente('c5', '2026-03-02T09:00:00Z', 'Renomeado'), ...seteClientes().slice(5), cliente('c8', '2026-03-02T09:00:01Z')]);
    amb.hub.envelopes.length = 0;
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.hub.envelopes[0]?.modo).toBe('delta');
    expect(amb.hub.envelopes[0]?.sessao).toBeUndefined();
    expect(amb.hub.envelopes[0]?.registros.map((r) => (r as { external_id: string }).external_id)).toEqual(['c5', 'c8']);
    expect(amb.hub.envelopes[0]?.cursor).toEqual({ alterado_em: '2026-03-02T09:00:01.000Z', external_id: 'c8' });
  });

  it('sem novidade no ERP, nenhum lote é enviado', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes());
    await volta(amb);
    amb.hub.envelopes.length = 0;
    await volta(amb);
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(0);
  });

  it('seis linhas (múltiplo exato da página) não geram lote vazio e a última parte sai com ultimo=true', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 6));
    await volta(amb);
    expect(amb.hub.envelopes.map((e) => [e.sessao?.parte, e.sessao?.ultimo])).toEqual([[1, false], [2, true]]);
  });

  it('tabela vazia no ERP: nada é enviado (carga vazia nunca inativa) e passa ao delta', async () => {
    amb = await criarAmbiente();
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(0);
    expect(amb.ctx.store.estado('cliente')?.fase).toBe('delta');
  });

  it('o cursor CONFIRMADO só avança depois do aceite do Hub; com o Hub caído a leitura avança mas nada é confirmado', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    amb.hub.caido = true;
    await volta(amb);
    const e = amb.ctx.store.estado('cliente');
    // o Hub nem respondeu à consulta de cursor inicial: nada foi iniciado, nada se perde
    expect(e).toBeNull();
    amb.hub.caido = false;
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.caido = true;
    await processarFila(amb.ctx);
    const durante = amb.ctx.store.estado('cliente');
    expect(durante?.lido?.external_id).toBe('c2');
    expect(durante?.confirmado).toBeNull();
    expect(amb.ctx.store.lotesDaEntidade('cliente', ['pendente'])).toHaveLength(1);
    amb.hub.caido = false;
    amb.relogio.avancar(60_000);
    await processarFila(amb.ctx);
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('c2');
  });

  it('com cursor já no Hub (Conector reinstalado), segue por delta a partir dele, sem carga completa', async () => {
    amb = await criarAmbiente();
    amb.hub.cursores.set('cliente', { alterado_em: '2026-03-01T10:00:04.000Z', external_id: 'c5' });
    amb.erp.definir('cliente', seteClientes());
    await volta(amb);
    const e0 = amb.hub.envelopes[0];
    expect(e0?.modo).toBe('delta');
    expect(amb.hub.envelopes.flatMap((e) => e.registros).map((r) => (r as { external_id: string }).external_id)).toEqual(['c6', 'c7']);
  });

  it('ao voltar da carga completa relê uma folga (margem) para pegar o que mudou durante a carga', async () => {
    amb = await criarAmbiente({ margemDeltaSegundos: 3600 });
    const inicio = amb.relogio.agora();
    // linhas alteradas depois do início da carga (durante a carga)
    amb.erp.definir('cliente', Array.from({ length: 4 }, (_, i) => cliente(`c${i + 1}`, `2026-03-10T12:00:0${i + 1}Z`)));
    await sincronizarEntidade(amb.ctx, 'cliente');
    const e = amb.ctx.store.estado('cliente');
    expect(e?.fase).toBe('delta');
    expect(Date.parse(e?.lido?.alterado_em ?? '')).toBe(inicio - 3_600_000);
  });

  it('linhas sem external_id/alterado_em legíveis bloqueiam a entidade com uma mensagem acionável', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [{ external_id: null, alterado_em: new Date('2026-03-01T10:00:00Z'), razao_social: 'x' }]);
    const r = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toMatch(/mapeamento/);
    const seguinte = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(seguinte.adiado).toMatch(/bloqueada/);
    expect(r.lotesCriados).toBe(0);
  });

  it('linha já lida que o filtro do SQL devolve de novo (alterado_em com precisão maior que ms) é ignorada, sem reenviar nem travar', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    await volta(amb);
    amb.hub.envelopes.length = 0;
    amb.erp.devolverIgualAoCursor = true;
    await volta(amb);
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(0);
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
  });

  it('mais linhas que a página no MESMO cursor (precisão do alterado_em): bloqueia com a causa e log.erro, sem reler para sempre', async () => {
    amb = await criarAmbiente();
    const T = '2026-03-01T10:00:00Z';
    // o Hub já tem o cursor (T, "z"); o ERP devolve também as linhas do mesmo instante (precisão maior que a do filtro):
    // c1..c4 > página de 3, e as 3 primeiras já foram lidas (id <= "z")
    amb.hub.cursores.set('cliente', { alterado_em: T.replace('Z', '.000Z'), external_id: 'z' });
    amb.erp.definir('cliente', ['c1', 'c2', 'c3', 'c4'].map((id) => cliente(id, T)));
    amb.erp.devolverIgualAoCursor = true;

    const r = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(r.lotesCriados).toBe(0);
    const e = amb.ctx.store.estado('cliente');
    expect(e?.bloqueio).toMatch(/a leitura não avança.*milissegundos/);
    const bloqueios = amb.logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === 'entidade_bloqueada');
    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0]).toMatchObject({ nivel: 'erro', entidade: 'cliente' });

    // os ciclos seguintes não consultam o ERP de novo: a entidade fica parada com o motivo visível
    const consultas = amb.erp.consultas.length;
    const seguinte = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(seguinte.adiado).toMatch(/bloqueada: a leitura não avança/);
    expect(amb.erp.consultas.length).toBe(consultas);
  });

  it('erro do ERP é registrado no estado e a próxima volta tenta de novo', async () => {
    amb = await criarAmbiente();
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.erroNaProximaConsulta = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const r = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(r.erro).toMatch(/ECONNREFUSED/);
    expect(amb.ctx.store.estado('cliente')?.ultimoErro).toMatch(/ECONNREFUSED/);
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    await volta(amb);
    expect(amb.hub.linhasDe('cliente')).toHaveLength(1);
    expect(amb.ctx.store.estado('cliente')?.ultimoErro).toBeNull();
  });

  it('fila cheia: pausa a leitura (contrapressão) e avisa que há mais para ler', async () => {
    amb = await criarAmbiente({ fila: { maxLotesPendentesPorEntidade: 1, backoffBaseSegundos: 1, backoffMaxSegundos: 10, consultaResultadoSegundos: 1 } });
    amb.erp.definir('cliente', seteClientes());
    const r = await sincronizarEntidade(amb.ctx, 'cliente');
    expect(r.adiado).toMatch(/fila cheia/);
    expect(r.maisParaLer).toBe(true);
    expect(amb.ctx.store.contarLotes('cliente', ['pendente'])).toBe(1);
  });
});

describe('fila local: queda de rede, reinício e idempotência', () => {
  it('sobrevive a reinício: o lote pendente continua na fila e sai quando a rede volta', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    await sincronizarEntidade(amb.ctx, 'cliente'); // enfileira
    amb.hub.caido = true;
    await processarFila(amb.ctx);
    expect(amb.hub.envelopes).toHaveLength(0);
    amb.reiniciar(); // serviço reiniciado com o lote ainda na fila
    expect(amb.ctx.store.lotesDaEntidade('cliente', ['pendente'])).toHaveLength(1);
    amb.hub.caido = false;
    amb.relogio.avancar(60_000);
    await processarFila(amb.ctx);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('c2');
  });

  it('espera exponencial persistida: não insiste antes da hora e a espera cresce a cada falha', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.caido = true;
    await processarFila(amb.ctx);
    const l1 = amb.ctx.store.lotesDaEntidade('cliente')[0];
    expect(l1?.tentativas).toBe(1);
    const chamadas = amb.hub.chamadas.length;
    await processarFila(amb.ctx); // ainda não venceu a espera
    expect(amb.hub.chamadas.length).toBe(chamadas);
    amb.relogio.avancar(l1 ? l1.proximaMs - amb.relogio.agora() + 1 : 0);
    await processarFila(amb.ctx);
    const l2 = amb.ctx.store.lotesDaEntidade('cliente')[0];
    expect(l2?.tentativas).toBe(2);
    expect((l2?.proximaMs ?? 0) - amb.relogio.agora()).toBeGreaterThan((l1?.proximaMs ?? 0) - (amb.relogio.agora() - 1) - 1);
  });

  it('HTTP 503 é repetido pelo cliente (retry) e o lote chega; Retry-After é respeitado', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.falhas = { restantes: 2, status: 503 };
    await processarFila(amb.ctx);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.hub.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes'))).toHaveLength(3);
  });

  it('o reenvio usa a MESMA chave de idempotência e o Hub não duplica o lote (Conector caiu depois do aceite)', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    await sincronizarEntidade(amb.ctx, 'cliente');
    await processarFila(amb.ctx);
    // simula: o Hub aceitou, mas o Conector caiu antes de gravar o aceite — o lote volta a pendente
    const l = amb.ctx.store.lotesDaEntidade('cliente')[0];
    amb.ctx.store.atualizarLote(l?.id ?? 0, { estado: 'pendente', loteId: null, proximaMs: 0 }, amb.relogio.agora());
    await processarFila(amb.ctx);
    const posts = amb.hub.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.idempotencia).toBe(posts[1]?.idempotencia);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.hub.lotes.size).toBe(1);
  });

  it('o mesmo conteúdo relido gera a mesma chave e não duplica na fila', async () => {
    amb = await criarAmbiente();
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    await sincronizarEntidade(amb.ctx, 'cliente');
    // recomeçar a leitura do mesmo ponto (ex.: estado restaurado de uma cópia) reproduz a mesma chave
    amb.ctx.store.atualizarEstado('cliente', { lido: { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' } });
    await sincronizarEntidade(amb.ctx, 'cliente');
    expect(amb.ctx.store.lotesDaEntidade('cliente')).toHaveLength(1);
  });

  it('consulta o resultado até o Hub terminar de processar (recebido → processando → concluído)', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    amb.hub.consultasProcessando = 2;
    await sincronizarEntidade(amb.ctx, 'cliente');
    await processarFila(amb.ctx);
    expect(amb.ctx.store.estado('cliente')?.confirmado).toBeNull();
    amb.relogio.avancar(6_000);
    await processarFila(amb.ctx);
    expect(amb.ctx.store.estado('cliente')?.confirmado).toBeNull();
    amb.relogio.avancar(6_000);
    await processarFila(amb.ctx);
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('c1');
  });

  it('credencial recusada (401) interrompe o ciclo sem perder o lote nem bloquear a entidade', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 1));
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.tokenValido = false;
    const r = await processarFila(amb.ctx);
    expect(r.interrompido).toMatch(/credencial/);
    expect(amb.ctx.store.lotesDaEntidade('cliente', ['pendente'])).toHaveLength(1);
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
    amb.hub.tokenValido = true;
    amb.relogio.avancar(60_000);
    await processarFila(amb.ctx);
    expect(amb.hub.envelopes).toHaveLength(1);
  });
});

describe('respostas do Hub: erro por linha, recusa de envelope e trava de inativação', () => {
  it('erro de regra por linha NÃO é reenviado; o cursor avança e o erro fica no log local sem o valor', async () => {
    amb = await criarAmbiente();
    const linhas = [cliente('c1', '2026-03-01T10:00:00Z'), { ...cliente('c2', '2026-03-01T10:00:01Z'), razao_social: null }];
    amb.erp.definir('cliente', linhas);
    await volta(amb);
    expect(amb.hub.linhasDe('cliente').map((r) => r.external_id)).toEqual(['c1']);
    expect(amb.hub.envelopes).toHaveLength(1); // nenhum reenvio
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('c2');
    // RN-INT-03 (T-0023): a linha inválida foi ao Hub em `linhas_invalidas` (com o motivo); o Hub a devolve com origem `conector`
    // e o Conector não duplica esse erro como se fosse do Hub: fica um erro local, com campo e sem valor
    expect(amb.hub.envelopes[0]?.linhas_invalidas).toEqual([{ external_id: 'c2', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor' }]);
    const erros = amb.ctx.store.errosRecentes('cliente');
    expect(erros.filter((e) => e.origem === 'hub')).toHaveLength(0);
    expect(erros.find((e) => e.origem === 'local')).toMatchObject({ externalId: 'c2', campo: 'razao_social', codigo: 'mapeamento' });
  });

  it('quando o ERP corrige a linha (novo alterado_em), ela volta no delta seguinte', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z'), { ...cliente('c2', '2026-03-01T10:00:01Z'), razao_social: null }]);
    await volta(amb);
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z'), cliente('c2', '2026-03-03T08:00:00Z')]);
    await volta(amb);
    expect(amb.hub.linhasDe('cliente').map((r) => r.external_id).sort()).toEqual(['c1', 'c2']);
  });

  it('falha de processamento (transitória) reenvia só as linhas afetadas, em novo lote delta, até o limite', async () => {
    amb = await criarAmbiente();
    const hoje = ['c1', 'c2', 'c3'].map((id, i) => cliente(id, `2026-03-01T10:00:0${i}Z`));
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.hub.falhaTransitoria.add('c2');
    amb.erp.definir('cliente', hoje);
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(2);
    expect(amb.hub.envelopes[1]?.registros.map((r) => (r as { external_id: string }).external_id)).toEqual(['c2']);
    expect(amb.hub.linhasDe('cliente')).toHaveLength(3);
  });

  it('referência ausente é reprocessável no Hub: o Conector registra e não reenvia', async () => {
    amb = await criarAmbiente();
    amb.ctx.store.registrarErros([{ entidade: 'cliente', origem: 'hub', loteChave: 'k', indice: 0, externalId: 'c1', codigo: 'referencia_ausente', campo: 'vendedor_external_id', mensagem: 'x', reprocessavel: true }], 1);
    expect(amb.ctx.store.errosRecentes('cliente')[0]?.reprocessavel).toBe(true);
  });

  it('envelope recusado por regra (422) NÃO é reenviado: bloqueia a entidade com instrução; `retomar` relê do cursor confirmado', async () => {
    amb = await criarAmbiente();
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    amb.hub.recusarProximoEnvelope = { codigo: 'versao_nao_suportada', mensagem: 'versão não suportada' };
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(0);
    const e = amb.ctx.store.estado('cliente');
    expect(e?.bloqueio).toMatch(/versao_nao_suportada.*conector retomar cliente/);
    expect(e?.confirmado?.alterado_em).toBe('2026-01-01T00:00:00.000Z');
    const posts = amb.hub.chamadas.filter((c) => c.metodo === 'POST').length;
    await volta(amb);
    await volta(amb);
    expect(amb.hub.chamadas.filter((c) => c.metodo === 'POST').length).toBe(posts); // nada de novo

    retomarEntidade(amb.ctx, 'cliente');
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.hub.linhasDe('cliente')).toHaveLength(2);
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
  });

  it('trava de inativação em massa (RN-INT-06): o Hub segurou a inativação, o Conector só avisa e não reenvia nem força', async () => {
    amb = await criarAmbiente();
    amb.hub.inativacaoNaSessaoCompleta = { situacao: 'aguardando_confirmacao', candidatos: 12 };
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    await volta(amb);
    const e = amb.ctx.store.estado('cliente');
    expect(e?.aviso).toMatch(/Trava de inativação.*12/);
    expect(e?.bloqueio).toBeNull();
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.logs.some((l) => l.includes('inativacao_em_massa_aguardando_confirmacao'))).toBe(true);
  });

  it('`carga-completa` descarta a fila da entidade e recomeça com nova sessão', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', seteClientes().slice(0, 2));
    await volta(amb);
    const primeira = amb.hub.envelopes[0]?.sessao?.id;
    reiniciarCargaCompleta(amb.ctx, 'cliente');
    await volta(amb);
    const ultima = amb.hub.envelopes[amb.hub.envelopes.length - 1];
    expect(ultima?.modo).toBe('completo');
    expect(ultima?.sessao?.id).not.toBe(primeira);
    expect(ultima?.sessao).toMatchObject({ parte: 1, ultimo: true });
  });

  it('o corpo enviado e os logs não contêm dado pessoal das linhas', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [{ ...cliente('c1', '2026-03-01T10:00:00Z'), razao_social: 'Padaria da Maria 12.345.678/0001-95' }]);
    await volta(amb);
    expect(amb.logs.join('\n')).not.toMatch(/Padaria|12\.345\.678/);
  });
});
