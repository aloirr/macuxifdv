import { describe, expect, it } from 'vitest';
import { botoesDoResumo, DESTINO_DIRETO_ERP, destinoDoEnvio, type EntradaDosBotoes } from './botoes-resumo';

const liberado = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
const base: EntradaDosBotoes = { cliente: liberado, pre_venda_ligada: true, editando: null, pendencias: 0, nivel: null, validade_data: '2026-11-15' };

describe('RF-VEN-11 / RN-VEN-38: botões do Resumo, sem pendência', () => {
  it('RN-VEN-38: Salvar e enviar pedido é o principal, habilitado, com o destino escrito embaixo', () => {
    const b = botoesDoResumo(base);
    expect(b.modo).toBe('novo_pedido');
    expect(b.principal).toBe('enviar');
    expect(b.enviar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar e enviar pedido', destino: 'Vai direto ao ERP' });
    expect(b.apenasSalvar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Apenas salvar' });
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar como orçamento', destino: null });
    expect(b.cancelar).toBe(true);
    expect(b.aviso).toBeNull();
  });
  it('RN-VEN-10: o destino é o nível da alçada (supervisor, gerente, analista)', () => {
    expect(botoesDoResumo({ ...base, nivel: 'supervisor' }).enviar.destino).toBe('Vai para o supervisor');
    expect(botoesDoResumo({ ...base, nivel: 'gerente' }).enviar.destino).toBe('Vai para o gerente');
    expect(destinoDoEnvio(null)).toBe(DESTINO_DIRETO_ERP);
  });
  it('RN-VEN-38: tenant sem pré-venda não oferece o orçamento', () => {
    expect(botoesDoResumo({ ...base, pre_venda_ligada: false }).orcamento.visivel).toBe(false);
  });
});

describe('RN-CORE-36 / RN-VEN-38: botões do Resumo, com pendência', () => {
  const b = botoesDoResumo({ ...base, pendencias: 2, nivel: 'supervisor' });
  it('RN-CORE-36: Salvar e enviar pedido fica desligado e sem o destino', () => {
    expect(b.enviar).toMatchObject({ visivel: true, habilitado: false, destino: null });
  });
  it('RN-VEN-38: Apenas salvar continua habilitado (grava rascunho com pendência)', () => {
    expect(b.apenasSalvar).toMatchObject({ visivel: true, habilitado: true });
  });
  it('RN-VEN-18: Salvar como orçamento valida e fica desligado com pendência', () => {
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: false });
  });
  it('RN-CORE-36: a leitura do TalkBack diz quantas pendências faltam', () => {
    expect(b.pendencias).toBe(2);
  });
});

describe('RN-VEN-13: cliente só de orçamento', () => {
  const bloqueado = { ...liberado, bloqueado: true };
  it('RN-VEN-13: Salvar e enviar pedido não aparece; Salvar como orçamento é o principal e Apenas salvar é o único outro', () => {
    const b = botoesDoResumo({ ...base, cliente: bloqueado });
    expect(b.modo).toBe('so_orcamento');
    expect(b.enviar.visivel).toBe(false);
    expect(b.principal).toBe('orcamento');
    expect(b.orcamento).toMatchObject({ visivel: true, habilitado: true, destino: 'Válido até 15/11' });
    expect(b.apenasSalvar).toMatchObject({ visivel: true, habilitado: true });
    expect(b.aviso).toBe('Cliente bloqueado: só dá para salvar como orçamento');
  });
  it('RN-VEN-13: o orçamento aparece mesmo com a pré-venda desligada (a tela nunca fica sem salvar)', () => {
    expect(botoesDoResumo({ ...base, cliente: bloqueado, pre_venda_ligada: false }).orcamento.visivel).toBe(true);
  });
  it('RN-VEN-13: com pendência, o orçamento desliga e Apenas salvar segue', () => {
    const b = botoesDoResumo({ ...base, cliente: { ...liberado, ativo: false }, pendencias: 1 });
    expect(b.orcamento.habilitado).toBe(false);
    expect(b.apenasSalvar.habilitado).toBe(true);
    expect(b.aviso).toBe('Cliente inativo: só dá para salvar como orçamento');
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
  it('RN-CORE-36: com pendência os dois desligam', () => {
    const b = botoesDoResumo({ ...edicao, pendencias: 1 });
    expect(b.salvarOrcamento.habilitado).toBe(false);
    expect(b.transformar.habilitado).toBe(false);
  });
  it('RN-VEN-13: cliente bloqueado não transforma em pedido; só salva o orçamento', () => {
    const b = botoesDoResumo({ ...edicao, cliente: { ...liberado, bloqueado: true } });
    expect(b.transformar.visivel).toBe(false);
    expect(b.salvarOrcamento.habilitado).toBe(true);
  });
});

describe('RN-VEN-38: editar pedido já salvo', () => {
  it('RN-VEN-38: um botão só (salvar alterações), desligado com pendência; sem rascunho nem orçamento', () => {
    const ok = botoesDoResumo({ ...base, editando: 'pedido' });
    expect(ok.modo).toBe('editar_pedido');
    expect(ok.principal).toBe('enviar');
    expect(ok.enviar).toMatchObject({ visivel: true, habilitado: true });
    expect(ok.apenasSalvar.visivel).toBe(false);
    expect(ok.orcamento.visivel).toBe(false);
    expect(botoesDoResumo({ ...base, editando: 'pedido', pendencias: 1 }).enviar.habilitado).toBe(false);
  });
});
