import { describe, expect, it } from 'vitest';
import { botoesDoResumo, motivoDoMaximo, perguntaDaAlcada, PERGUNTA_DA_ALCADA, ROTULOS_DO_SALVAR, type EntradaDosBotoes } from './botoes-resumo';

const liberado = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
const base: EntradaDosBotoes = { cliente: liberado, pre_venda_ligada: true, editando: null, preco_data: '2026-11-09' };

describe('RF-VEN-11 / RN-VEN-38: botões do Resumo', () => {
  it('RN-VEN-38: Salvar e enviar pedido é o principal, habilitado, sem texto de destino ou de alçada embaixo', () => {
    const b = botoesDoResumo(base);
    expect(b.modo).toBe('novo_pedido');
    expect(b.principal).toBe('enviar');
    expect(b.enviar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar e enviar pedido' });
    expect('destino' in b.enviar).toBe(false);
    expect(b.apenasSalvar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Apenas salvar' });
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar como orçamento' });
    expect(b.cancelar).toBe(true);
  });
  it('RN-VEN-10 (T-0151): a alçada só vira a pergunta ao salvar, e só para pedido (orçamento não tem alçada)', () => {
    expect(perguntaDaAlcada({ tipo: 'pedido', nivel: 'supervisor' })).toEqual(PERGUNTA_DA_ALCADA);
    expect(PERGUNTA_DA_ALCADA).toEqual({ titulo: 'Enviar para aprovação?', enviar: 'Enviar', voltar: 'Voltar' });
    expect(perguntaDaAlcada({ tipo: 'pedido', nivel: null })).toBeNull();
    expect(perguntaDaAlcada({ tipo: 'orcamento', nivel: 'gerente' })).toBeNull();
  });
  it('RN-VEN-11 (T-0151): item acima do desconto máximo bloqueia o envio: só Salvar como orçamento, com o motivo numa linha', () => {
    const b = botoesDoResumo({ ...base, itens_acima_do_maximo: ['AGU-1500'] });
    expect(b.enviar.habilitado).toBe(false);
    expect(b.principal).toBe('orcamento');
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: true });
    // RD-0176: a linha do motivo saiu da folha e da tela (já está em Alertas)
    expect(b).not.toHaveProperty('aviso');
    expect(motivoDoMaximo(['AGU-1500', 'VEL-150'])).toBe('AGU-1500, VEL-150 acima do desconto máximo');
    expect(motivoDoMaximo([])).toBeNull();
  });
  it('RN-VEN-11 (T-0151): orçamento em edição salva, mas só vira pedido com o desconto ajustado', () => {
    const b = botoesDoResumo({ ...base, editando: 'orcamento', itens_acima_do_maximo: ['AGU-1500'] });
    expect(b.salvarOrcamento.habilitado).toBe(true);
    expect(b.transformar.habilitado).toBe(false);
  });
  it('RN-CORE-36 (RD-0235): o salvar é sempre tocável; a falta aparece no campo, na tentativa, e o domain não conta pendências', () => {
    const b = botoesDoResumo(base);
    expect(b).not.toHaveProperty('pendencias');
    expect([b.enviar.habilitado, b.apenasSalvar.habilitado, b.orcamento.habilitado]).toEqual([true, true, true]);
  });
  it('RN-VEN-38: tenant sem pré-venda não oferece o orçamento', () => {
    expect(botoesDoResumo({ ...base, pre_venda_ligada: false }).orcamento.visivel).toBe(false);
  });
});

describe('RN-VEN-13: cliente só de orçamento', () => {
  const bloqueado = { ...liberado, bloqueado: true };
  it('RN-VEN-13: Salvar e enviar pedido não aparece; Salvar como orçamento é o principal e Apenas salvar é o único outro', () => {
    const b = botoesDoResumo({ ...base, cliente: bloqueado });
    expect(b.modo).toBe('so_orcamento');
    expect(b.enviar.visivel).toBe(false);
    expect(b.principal).toBe('orcamento');
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: true });
    expect(b.apenasSalvar).toMatchObject({ visivel: true, habilitado: true });
  });
  it('RN-VEN-13: o orçamento aparece mesmo com a pré-venda desligada (a tela nunca fica sem salvar)', () => {
    expect(botoesDoResumo({ ...base, cliente: bloqueado, pre_venda_ligada: false }).orcamento.visivel).toBe(true);
  });
});

describe('RN-VEN-18: editar orçamento', () => {
  const edicao: EntradaDosBotoes = { ...base, editando: 'orcamento' };
  it('RN-VEN-18: Salvar orçamento é o principal; Transformar em pedido é o secundário; sem Apenas salvar nem Salvar como orçamento', () => {
    const b = botoesDoResumo(edicao);
    expect(b.modo).toBe('editar_orcamento');
    expect(b.principal).toBe('salvar_orcamento');
    expect(b.salvarOrcamento).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar orçamento' });
    expect(b.transformar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Transformar em pedido' });
    expect(b.enviar.visivel).toBe(false);
    expect(b.apenasSalvar.visivel).toBe(false);
    expect(b.orcamento.visivel).toBe(false);
    expect(b.cancelar).toBe(true);
  });
  it('RN-VEN-13: cliente bloqueado não transforma em pedido; só salva o orçamento', () => {
    const b = botoesDoResumo({ ...edicao, cliente: { ...liberado, bloqueado: true } });
    expect(b.transformar.visivel).toBe(false);
    expect(b.salvarOrcamento.habilitado).toBe(true);
  });
});

describe('RN-VEN-38: editar pedido já salvo', () => {
  it('RN-VEN-38: um botão só (salvar alterações), desligado só por item fora da regra; sem rascunho nem orçamento', () => {
    const ok = botoesDoResumo({ ...base, editando: 'pedido' });
    expect(ok.modo).toBe('editar_pedido');
    expect(ok.principal).toBe('enviar');
    expect(ok.enviar).toMatchObject({ visivel: true, habilitado: true });
    expect(botoesDoResumo({ ...base, editando: 'pedido', itens_acima_do_maximo: ['AGU-1500'] }).enviar.habilitado).toBe(false);
    expect(ok.apenasSalvar.visivel).toBe(false);
    expect(ok.orcamento.visivel).toBe(false);
  });
  it('RN-VEN-38 / RD-0036: o rótulo da edição sai do domain (aparelho ou alterações; a alçada não entra no botão)', () => {
    expect(botoesDoResumo({ ...base, editando: 'pedido' }).enviar.rotulo).toBe(ROTULOS_DO_SALVAR.alteracoes);
    expect(botoesDoResumo({ ...base, editando: 'pedido', editando_no_servidor: false }).enviar.rotulo).toBe('Salvar alterações no aparelho');
  });
  it('RN-VEN-38 / RD-0036: os rótulos dos botões e da folha de saída vêm do mesmo mapa', () => {
    const novo = botoesDoResumo(base);
    expect([novo.enviar.rotulo, novo.apenasSalvar.rotulo, novo.orcamento.rotulo]).toEqual([ROTULOS_DO_SALVAR.enviar, ROTULOS_DO_SALVAR.apenasSalvar, ROTULOS_DO_SALVAR.orcamento]);
  });
});

describe('RN-VEN-20 (T-0150): produto sem estoque entra, mas o pedido só sai como orçamento', () => {
  it('RN-VEN-20: item sem estoque desliga o enviar; Salvar como orçamento vira o principal e Apenas salvar continua', () => {
    const b = botoesDoResumo({ ...base, itens_sem_estoque: ['BIS-400'] });
    expect(b.principal).toBe('orcamento');
    expect(b.enviar.habilitado).toBe(false);
    expect(b.orcamento.habilitado).toBe(true);
    expect(b.apenasSalvar.habilitado).toBe(true);
  });
  it('RN-VEN-20: na edição do orçamento, o Transformar fica desligado com item sem estoque', () => {
    const b = botoesDoResumo({ ...base, editando: 'orcamento', itens_sem_estoque: ['BIS-400'] });
    expect(b.transformar.habilitado).toBe(false);
    expect(b.salvarOrcamento.habilitado).toBe(true);
  });
});
