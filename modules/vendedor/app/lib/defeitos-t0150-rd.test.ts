import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { alertasDoPedido, textoDoAlertaNoItem } from '../../domain/alertas-pedido';
import { entradaDasPendencias, itensSemEstoque, textoDaFalta } from './alertas-novo-pedido';
import { alertasDoItem } from './item-popup';
import { notaDaEtapaNaFila } from './salvar-na-fila';

const LIBERADO = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] };
const fonte = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

describe('RN-VEN-20 (T-0148): o alerta de estoque diz o que é', () => {
  it('RN-VEN-20: quantidade acima de um estoque positivo = "<código> acima do estoque (5 UN)"; "Sem estoque" só com estoque 0', () => {
    const acima = alertasDoItem({ erp_code: 'BIS-400', unidade_base: 'UN', estoque_base: 5, quantidade_base: 8, acima_do_maximo: false });
    expect(acima.map(textoDoAlertaNoItem)).toEqual(['Acima do estoque']);
    const zero = alertasDoItem({ erp_code: 'BIS-400', unidade_base: 'UN', estoque_base: 0, quantidade_base: 1, acima_do_maximo: false });
    expect(zero.map(textoDoAlertaNoItem)).toEqual(['Sem estoque']);
  });
  it('RN-VEN-20: a lista de Alertas do Novo pedido usa o mesmo texto quando o produto tem unidade', () => {
    const linhas = [{ product_id: 'p1', quantidade_base: 8 }] as never;
    const sem = itensSemEstoque(linhas, () => ({ erp_code: 'BIS-400', stock_total: 5, unit: 'UN' }));
    expect(alertasDoPedido({ cliente: LIBERADO, itens_sem_estoque: sem }).map((a) => a.texto)).toEqual(['BIS-400 acima do estoque (5 UN)']);
    const zero = itensSemEstoque(linhas, () => ({ erp_code: 'BIS-400', stock_total: 0, unit: 'UN' }));
    expect(alertasDoPedido({ cliente: LIBERADO, itens_sem_estoque: zero }).map((a) => a.texto)).toEqual(['BIS-400 sem estoque']);
  });
});

describe('RN-VEN-16 (T-0150): alerta do CNPJ da transportadora', () => {
  it('RN-CORE-36: o acrônimo mantém a maiúscula ("Falta CNPJ da transportadora"); o resto continua em minúscula', () => {
    expect(textoDaFalta('CNPJ da transportadora')).toBe('Falta CNPJ da transportadora');
    expect(textoDaFalta('Transportadora do frete FOB')).toBe('Falta transportadora do frete FOB');
  });
  it('RN-VEN-16: CNPJ digitado e inválido aparece como "CNPJ da transportadora inválido", não como "Falta"', () => {
    const { faltantes } = entradaDasPendencias([{ id: 'frete', texto: 'CNPJ da transportadora', aba: 'entrega' }] as never);
    expect(faltantes).toEqual([{ texto: 'CNPJ da transportadora inválido', aba: 'Entrega' }]);
    const sem = entradaDasPendencias([{ id: 'frete', texto: 'Transportadora do frete FOB', aba: 'entrega' }] as never);
    expect(sem.faltantes[0]!.texto).toBe('Falta transportadora do frete FOB');
  });
});

describe('RN-VEN-30 (T-0130): nota da etapa "Na fila"', () => {
  it('RN-VEN-30: pedido recusado não leva "Aguardando envio"; só enquanto está de fato na fila', () => {
    expect(notaDaEtapaNaFila({ recusado: true, criadoSemSinal: false })).toBe('');
    expect(notaDaEtapaNaFila({ recusado: false, criadoSemSinal: false })).toBe('Aguardando envio');
    expect(notaDaEtapaNaFila({ recusado: false, criadoSemSinal: true })).toBe('Criado no aparelho sem sinal');
  });
});

describe('RN-VEN-42 (RD-0058, RD-0064, RD-0083, RD-0085): nada de alerta ou repetição fora da área Alertas', () => {
  it('RD-0058: o detalhe do app não tem cartão de aprovação com o desconto repetido; só Aprovar e Rejeitar no rodapé', () => {
    const tela = fonte('app/screens/order-detail-screen.tsx');
    expect(tela).not.toContain('order-approval');
    expect(tela).not.toMatch(/Desconto \$\{formatPct/);
    expect(tela).toContain('testID="pedido-aprovar"');
    expect(tela).toContain('testID="pedido-rejeitar"');
  });
  it('RD-0064: a gaveta do BKO não repete o desconto na Decisão (ele está nos totais)', () => {
    expect(fonte('web/components/orders/order-drawer.tsx')).not.toContain('pedido.decisao.alcada');
  });
  it('RD-0083: o aviso vermelho do frete saiu da aba Entrega (a pendência vai para os Alertas)', () => {
    expect(fonte('app/components/novo-pedido-abas.tsx')).not.toContain('frete-aviso');
  });
  it('RD-0085: o popup do item usa a AreaAlertas, sem Alertas próprios', () => {
    const f = fonte('app/components/folha-do-item.tsx');
    expect(f).toContain('<AreaAlertas');
    expect(f).not.toContain('alertasTitulo');
    expect(f).not.toContain("startsWith('Acima')");
  });
});
