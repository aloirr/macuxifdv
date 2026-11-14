/**
 * Seed da demo da T-0170 (db/seeds/demo/tarefas-produtividade.ts), estático: as linhas respeitam os CHECKs e gatilhos das
 * 0064 a 0066 e os contratos do Core (faixas das metas de produtividade, aviso da tarefa).
 */
import { describe, expect, it } from 'vitest';
import { FAIXA_META_PRODUTIVIDADE, INDICADORES_PRODUTIVIDADE } from '../../modules/core/contracts/performance';
import { INDICADORES_META_BANCO } from '../../modules/core/db/nuvem';
import { idUsuarioDemo, TENANT_DEMO } from '../seeds/demo/demo';
import { PESQUISA_DEMO } from '../seeds/demo/pesquisa';
import { dadosDemoTarefasProdutividade, TAREFAS_DEMO } from '../seeds/demo/tarefas-produtividade';
import { idDeterministico } from '../src/ids';

const hoje = '2030-03-15';
const d = dadosDemoTarefasProdutividade({ tenantId: TENANT_DEMO, hoje });

describe('seed demo T-0170 (estático)', () => {
  it('tarefas: 4, uma de pesquisa com o questionário de exposição; questionário só na de pesquisa; alvo equipe ⇔ equipe_id', () => {
    expect(d.tarefas).toHaveLength(4);
    const pesquisa = d.tarefas.filter((t) => t.tipo === 'pesquisa');
    expect(pesquisa.map((t) => [t.id, t.questionario_id])).toEqual([[TAREFAS_DEMO.pesquisa, PESQUISA_DEMO.questionarios.exposicao]]);
    for (const t of d.tarefas) {
      expect(t.tipo === 'pesquisa').toBe(t.questionario_id !== null);
      expect(t.alvo === 'equipe').toBe(t.equipe_id !== null);
      expect(String(t.titulo).length).toBeLessThanOrEqual(120);
      expect(t.autor_id).toBe(idUsuarioDemo('supervisor'));
    }
    expect(d.tarefas.find((t) => t.id === TAREFAS_DEMO.vencida)!.prazo).toBe('2030-03-14');
  });

  it('destinatários: conclusão em par (concluida_em ⇔ recebida_em ⇔ conclusao_id), só a tarefa concluída do Lucas; um aviso por destinatário', () => {
    for (const l of d.destinatarios) {
      expect(l.concluida_em === null).toBe(l.recebida_em === null);
      expect(l.concluida_em === null).toBe(l.conclusao_id === null);
    }
    const concluidas = d.destinatarios.filter((l) => l.concluida_em !== null);
    expect(concluidas.map((l) => [l.tarefa_id, l.usuario_id])).toEqual([[TAREFAS_DEMO.concluida, idUsuarioDemo('vendedor')]]);
    expect(d.avisos.map((a) => `${String(a.tarefa_id)}|${String(a.usuario_id)}`)).toEqual(d.destinatarios.map((l) => `${String(l.tarefa_id)}|${String(l.usuario_id)}`));
    for (const a of d.avisos) expect(a).toMatchObject({ tipo: 'sistema', subtipo: 'tarefa', origem_modulo: 'core' });
    expect(d.avisos.find((a) => a.tarefa_id === TAREFAS_DEMO.foto)!.corpo).toBe('Prazo: 17/03/2030');
  });

  it('metas de produtividade: indicador do contrato, valor na faixa, escopo coerente com o alvo, vigência do mês', () => {
    for (const m of d.metasProdutividade) {
      const i = m.indicador as (typeof INDICADORES_PRODUTIVIDADE)[number];
      expect(INDICADORES_PRODUTIVIDADE).toContain(i);
      const [min, max] = FAIXA_META_PRODUTIVIDADE[i];
      expect(m.valor as number).toBeGreaterThanOrEqual(min);
      expect(m.valor as number).toBeLessThanOrEqual(max);
      expect(m.escopo === 'equipe').toBe(m.equipe_id !== null);
      expect(m.escopo === 'usuario').toBe(m.usuario_id !== null);
      expect(m.vigencia_inicio).toBe('2030-03');
    }
  });

  it("metas 'itens_por_pedido': indicador do banco, centésimos, mesmo esquema de id do demo.ts, mês corrente e anterior", () => {
    expect(INDICADORES_META_BANCO).toContain('itens_por_pedido');
    expect(d.metasItens).toHaveLength(4);
    for (const m of d.metasItens) {
      expect(m).toMatchObject({ indicador: 'itens_por_pedido', tipo: 'pedido' });
      expect(['2030-03', '2030-02']).toContain(m.periodo);
      expect(Number.isInteger(m.valor)).toBe(true);
    }
    const lucas = d.metasItens.find((m) => m.usuario_id === idUsuarioDemo('vendedor') && m.periodo === '2030-03')!;
    expect(lucas.id).toBe(idDeterministico('demo:meta:vendedor:2030-03:itens_por_pedido'));
    expect(lucas.valor).toBe(350);
  });

  it('deslocamento: datas antes do "hoje", pontos em par e em ordem, metros ≥ 0; ids únicos em tudo', () => {
    for (const l of d.deslocamentos) {
      expect(String(l.data) < hoje).toBe(true);
      expect(String(l.ultimo_ponto_em) >= String(l.primeiro_ponto_em)).toBe(true);
      expect(l.metros as number).toBeGreaterThanOrEqual(0);
    }
    const todas = [...d.tarefas, ...d.destinatarios, ...d.avisos, ...d.metasProdutividade, ...d.metasItens, ...d.deslocamentos];
    expect(new Set(todas.map((l) => l.id)).size).toBe(todas.length);
  });
});
