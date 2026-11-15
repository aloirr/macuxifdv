/**
 * T-0140 / relato 5 (08/11): o checkout "fechou" na folha e a visita voltou aberta. Hipótese verificada aqui: o que a folha
 * deixa confirmar (`prepararCheckoutVisita`) nunca é recusado pelo servidor (`avaliarCheckoutTolerante`), com ou sem a
 * etapa obrigatória da pesquisa. Se a matriz passar, a recusa só pode vir de dado (motivo/pedido/visita), não da regra.
 */
import { describe, expect, it } from 'vitest';
import { avaliarCheckoutTolerante } from './checkout-tolerancia';
import { prepararCheckoutVisita } from './checkout';
describe('RN-CORE-12: o que a folha de checkout confirma o servidor aceita (paridade app × API)', () => {
    const escolhas = ['pedido', 'sem_pedido', 'atendido'];
    const tipos = [null, 'nao_venda', 'cliente_fechado'];
    for (const vendedorEfetivo of [true, false])
        for (const escolha of escolhas)
            for (const tipo of tipos)
                for (const temPedido of [true, false])
                    for (const foto of [true, false])
                        for (const pesquisaFeita of [true, false]) {
                            const nome = `RN-CORE-12: vendedor=${vendedorEfetivo} escolha=${escolha} motivo=${tipo} pedido=${temPedido} foto=${foto} pesquisa=${pesquisaFeita}`;
                            it(nome, () => {
                                const etapa = { modulo: 'pesquisa', id: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria: true, concluida: pesquisaFeita };
                                const app = prepararCheckoutVisita({ escolha, vendedorEfetivo, motivo: tipo ? { tipo } : null, fotoFachada: foto, temPedido, etapas: [etapa] });
                                if (!app.pode || !app.resultado)
                                    return; // a folha não deixa confirmar
                                const srv = avaliarCheckoutTolerante({
                                    resultadoInformado: app.resultado,
                                    vendedorEfetivo,
                                    motivoId: tipo ? 'm1' : null,
                                    motivoTexto: null,
                                    motivo: tipo ? { tipo, ativo: true } : null,
                                    fotoFachada: foto,
                                    temPedido: app.resultado === 'pedido' ? temPedido : false,
                                    // o servidor verifica a pesquisa por conta própria: aqui, sempre "não feita" (pior caso, fila da pesquisa atrasada)
                                    verificacoes: [{ modulo: 'pesquisa', etapa: 'pesquisa.preco', rotulo: 'Pesquisa de preço', obrigatoria: true, concluida: false }],
                                });
                                expect(srv.decisao, nome).not.toBe('recusar');
                            });
                        }
});
