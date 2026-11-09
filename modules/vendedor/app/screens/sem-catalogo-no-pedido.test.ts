/**
 * T-0141 (D e E; RF-VEN-11, RN-VEN-38): o Novo pedido não abre o Catálogo. Item novo só pela busca da aba Itens. Era o caminho
 * em que o Voltar do Android levava ao Início e o vendedor achava que tinha perdido o pedido (teste do v1.0.1, 09/11).
 * Varre o código do app: nenhuma tela do Vendedor navega para `/m/catalogo`, e o botão "Catálogo" da trilha não existe mais.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('RF-VEN-11 / RN-VEN-38: sem o botão Catálogo no Novo pedido', () => {
  it('RF-VEN-11: a aba Itens não tem a trilha "Catálogo" nem navega para o Catálogo', () => {
    const tela = ler('screens/new-order-screen.tsx');
    expect(tela).not.toMatch(/trilha-catalogo|irParaCatalogoDoPedido|niveisDaTrilha|<Trilha\b/);
    expect(tela).not.toMatch(/\/m\/catalogo/);
  });

  it('RN-VEN-38: as rotas do Vendedor não têm atalho para o Catálogo (nenhuma tela aberta a partir do pedido tira o vendedor dele)', () => {
    expect(ler('rotas.ts')).not.toMatch(/catalogo/i);
  });
});
