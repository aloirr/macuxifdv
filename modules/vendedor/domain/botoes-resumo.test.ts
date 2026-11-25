import { describe, expect, it } from 'vitest';
import { botoesDaEdicao, botoesDoSalvarNovo, motivoDeNaoEnviarOSalvo, motivoDoItemSoOrcamento, motivoDoMaximo, perguntaDaAlcada, precisaPerguntarAlcadaNoEnvioSalvo, PERGUNTA_DA_ALCADA, ROTULOS_DA_EDICAO, ROTULOS_DO_SALVAR_NOVO } from './botoes-resumo';

const liberado = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
const base = { cliente: liberado, pre_venda_ligada: true };

describe('RF-VEN-11 / RN-VEN-38: alçada e motivo do máximo', () => {
  it('RN-VEN-10 (T-0151): a alçada só vira a pergunta ao salvar, e só para pedido (orçamento não tem alçada)', () => {
    expect(perguntaDaAlcada({ tipo: 'pedido', nivel: 'supervisor' })).toEqual(PERGUNTA_DA_ALCADA);
    expect(PERGUNTA_DA_ALCADA).toEqual({ titulo: 'Enviar para aprovação?', enviar: 'Enviar', voltar: 'Voltar' });
    expect(perguntaDaAlcada({ tipo: 'pedido', nivel: null })).toBeNull();
    expect(perguntaDaAlcada({ tipo: 'orcamento', nivel: 'gerente' })).toBeNull();
  });
  it('RN-VEN-10 e RN-VEN-48: o Enviar pedido do salvo pergunta acima da alçada, envia direto dentro dela', () => {
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: 'supervisor' })).toBe(true);
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: null })).toBe(false);
  });
  it('RN-VEN-11 (T-0151): o motivo do máximo numa linha (RD-0176: sem linha própria na tela, já está em Alertas)', () => {
    expect(motivoDoMaximo(['AGU-1500', 'VEL-150'])).toBe('AGU-1500, VEL-150 acima do desconto máximo');
    expect(motivoDoMaximo([])).toBeNull();
  });
});

describe('RN-VEN-18: editar orçamento', () => {
  const edicao = { ...base, editando: 'orcamento' as const };
  it('RN-VEN-18: Salvar orçamento é o principal; Converter em pedido é o secundário; sem salvar alterações', () => {
    const b = botoesDaEdicao(edicao);
    expect(b.modo).toBe('editar_orcamento');
    expect(b.principal).toBe('salvar_orcamento');
    expect(b.salvarOrcamento).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Salvar orçamento' });
    expect(b.transformar).toMatchObject({ visivel: true, habilitado: true, rotulo: 'Converter em pedido' });
    expect(b.salvarAlteracoes.visivel).toBe(false);
    expect(b.cancelar).toBe(true);
    expect(b).not.toHaveProperty('aviso');
  });
  it('RN-VEN-13: cliente bloqueado não transforma em pedido; só salva o orçamento', () => {
    const b = botoesDaEdicao({ ...edicao, cliente: { ...liberado, bloqueado: true } });
    expect(b.transformar.visivel).toBe(false);
    expect(b.salvarOrcamento.habilitado).toBe(true);
  });
  it('RN-VEN-11 (T-0151) e RN-VEN-20 (T-0150): orçamento em edição salva; só vira pedido sem item acima do máximo nem sem estoque', () => {
    for (const x of [{ itens_acima_do_maximo: ['AGU-1500'] }, { itens_sem_estoque: ['BIS-400'] }]) {
      const b = botoesDaEdicao({ ...edicao, ...x });
      expect(b.salvarOrcamento.habilitado).toBe(true);
      expect(b.transformar.habilitado).toBe(false);
    }
  });
});

describe('RN-VEN-38: editar pedido já salvo', () => {
  const edicao = { ...base, editando: 'pedido' as const };
  it('RN-VEN-38: um botão só (salvar alterações), desligado só por item fora da regra; sem orçamento', () => {
    const ok = botoesDaEdicao(edicao);
    expect(ok.modo).toBe('editar_pedido');
    expect(ok.principal).toBe('salvar_alteracoes');
    expect(ok.salvarAlteracoes).toMatchObject({ visivel: true, habilitado: true });
    expect(botoesDaEdicao({ ...edicao, itens_acima_do_maximo: ['AGU-1500'] }).salvarAlteracoes.habilitado).toBe(false);
    expect(ok.salvarOrcamento.visivel).toBe(false);
    expect(ok.transformar.visivel).toBe(false);
  });
  it('RN-VEN-38 / RD-0036: o rótulo da edição sai do domain (aparelho ou alterações; a alçada não entra no botão)', () => {
    expect(botoesDaEdicao(edicao).salvarAlteracoes.rotulo).toBe(ROTULOS_DA_EDICAO.alteracoes);
    expect(botoesDaEdicao({ ...edicao, editando_no_servidor: false }).salvarAlteracoes.rotulo).toBe('Salvar alterações no aparelho');
  });
});

describe('RN-VEN-38: Resumo com só Salvar e Cancelar; o Salvar escolhe Orçamento ou Pedido', () => {
  it('RN-VEN-38: pré-venda ligada e nada impede: Salvar abre a folha com Orçamento e Pedido, ambos tocáveis', () => {
    const b = botoesDoSalvarNovo(base);
    expect(b.salvar).toEqual({ rotulo: 'Salvar' });
    expect(ROTULOS_DO_SALVAR_NOVO.cancelar).toBe('Cancelar');
    expect(b.escolha.orcamento).toEqual({ visivel: true, rotulo: 'Orçamento' });
    expect(b.escolha.pedido).toEqual({ visivel: true, rotulo: 'Pedido' });
    expect(b.direto).toBeNull();
  });
  it('RN-VEN-35 e RN-VEN-48: Campo e Gestão (pedido em nome) têm o mesmo Salvar; o Pedido só grava e o envio é das Ações', () => {
    const b = botoesDoSalvarNovo(base);
    expect(b).not.toHaveProperty('envia_ao_salvar');
    expect(b.escolha.pedido).toEqual({ visivel: true, rotulo: 'Pedido' });
  });
  it('RN-VEN-38: tenant sem pré-venda: Salvar grava direto o pedido salvo, sem folha', () => {
    const b = botoesDoSalvarNovo({ ...base, pre_venda_ligada: false });
    expect(b.escolha.orcamento.visivel).toBe(false);
    expect(b.direto).toBe('pedido');
  });
  it('RN-VEN-13: cliente bloqueado, inativo ou cadastro incompleto: Pedido oculto, Salvar grava orçamento direto', () => {
    for (const c of [{ ...liberado, bloqueado: true }, { ...liberado, ativo: false }, { ...liberado, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] }]) {
      const b = botoesDoSalvarNovo({ ...base, cliente: c, pre_venda_ligada: false });
      expect(b.escolha.pedido.visivel).toBe(false);
      expect(b.escolha.orcamento.visivel).toBe(true);
      expect(b.direto).toBe('orcamento');
    }
  });
  it('RN-VEN-11, RN-VEN-11a e RN-VEN-20: item só-orçamento não impede salvar o Pedido (impede enviar)', () => {
    for (const x of [{ itens_acima_do_maximo: ['AGU-1500'] }, { acima_do_limite: true }, { itens_sem_estoque: ['BIS-400'] }]) {
      const b = botoesDoSalvarNovo({ ...base, ...x });
      expect(b.escolha.pedido.visivel).toBe(true);
      expect(b.escolha.orcamento.visivel).toBe(true);
      expect(b.direto).toBeNull();
      expect(motivoDeNaoEnviarOSalvo({ cliente: liberado, itens_acima_do_maximo: [], acima_do_limite: false, itens_sem_estoque: [], pre_venda_ligada: true, ...x })).toMatch(/Edite o item ou salve como orçamento\.$/);
    }
  });
  it('RN-VEN-48: o Enviar da lista revalida cliente e itens; pedido liberado entra na fila', () => {
    const livre = { pre_venda_ligada: true, cliente: liberado, itens_acima_do_maximo: [], acima_do_limite: false, itens_sem_estoque: [] };
    expect(motivoDeNaoEnviarOSalvo(livre)).toBeNull();
    // RN-CORE-36 / RN-VEN-48: o pedido salvo com pendência de preenchimento não entra na fila; vem antes do item só-orçamento
    expect(motivoDeNaoEnviarOSalvo({ ...livre, pendencias_de_preenchimento: ['Forma de pagamento', 'Prazo de pagamento'], itens_sem_estoque: ['A1'] })).toBe('Falta preencher Forma de pagamento, Prazo de pagamento. Edite o pedido para enviar.');
    expect(motivoDeNaoEnviarOSalvo({ ...livre, cliente: { ...liberado, bloqueado: true } })).toBe('Cliente bloqueado. Só orçamento.');
  });
  it('RN-VEN-11/11a/20/13: sem pré-venda o motivo do Enviar não fala em orçamento; diz o problema e a ação', () => {
    const base = { cliente: liberado, pre_venda_ligada: false, itens_acima_do_maximo: [], acima_do_limite: false, itens_sem_estoque: [] };
    expect(motivoDeNaoEnviarOSalvo({ ...base, itens_acima_do_maximo: ['AGU-1500'] })).toBe('AGU-1500 acima do desconto máximo. Ajuste o item para enviar.');
    expect(motivoDeNaoEnviarOSalvo({ ...base, acima_do_limite: true })).toBe('Pedido acima do desconto máximo. Ajuste o item para enviar.');
    expect(motivoDeNaoEnviarOSalvo({ ...base, itens_sem_estoque: ['BIS-400'] })).toBe('BIS-400 sem estoque. Retire o item para enviar.');
    expect(motivoDeNaoEnviarOSalvo({ ...base, cliente: { ...liberado, bloqueado: true } })).toBe('Cliente bloqueado.');
    expect(motivoDeNaoEnviarOSalvo({ ...base, cliente: { ...liberado, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] } })).toBe('Cadastro do cliente incompleto: falta CNPJ. Complete o cadastro para enviar.');
  });
});

describe('RN-VEN-11/11a/20: motivo do item só-orçamento', () => {
  it('RN-VEN-11/11a/20: um critério só; null sem item, a primeira causa quando há item', () => {
    expect(motivoDoItemSoOrcamento({ itens_acima_do_maximo: [], acima_do_limite: false, itens_sem_estoque: [] })).toBeNull();
    expect(motivoDoItemSoOrcamento({ itens_sem_estoque: ['AGU-1'] })).toBe('AGU-1 sem estoque. Edite o item ou salve como orçamento.');
    expect(motivoDoItemSoOrcamento({ acima_do_limite: true })).toBe('Pedido acima do desconto máximo. Edite o item ou salve como orçamento.');
  });
});
