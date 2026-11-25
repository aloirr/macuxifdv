import { describe, expect, it } from 'vitest';
import { avaliarCheckout, ehClienteFechado, avaliarCheckoutVisita, prepararCheckoutVisita } from './checkout';
const pesquisa = { rotulo: 'Pesquisa', obrigatoria: true, concluida: false };
const checklist = { rotulo: 'Checklist da loja', obrigatoria: true, concluida: false };
const opcional = { rotulo: 'Nota', obrigatoria: false, concluida: false };
describe('RN-CORE-14: cliente fechado', () => {
    it('RN-CORE-14: loja_fechada e acesso_negado são cliente fechado; os demais motivos não', () => {
        expect(ehClienteFechado('loja_fechada')).toBe(true);
        expect(ehClienteFechado('acesso_negado')).toBe(true);
        expect(ehClienteFechado('estoque_alto')).toBe(false);
        expect(ehClienteFechado(null)).toBe(false);
    });
    it('RN-CORE-14: cliente fechado sem foto da fachada bloqueia o checkout', () => {
        const r = avaliarCheckout({ resultado: 'no_order', motivo: 'loja_fechada', fotoFachada: false, etapas: [] });
        expect(r).toMatchObject({ pode: false, pendencias: ['foto_fachada'] });
    });
    it('RN-CORE-14: cliente fechado com foto dispensa todas as etapas obrigatórias', () => {
        const r = avaliarCheckout({ resultado: 'no_order', motivo: 'acesso_negado', fotoFachada: true, etapas: [pesquisa, checklist] });
        expect(r).toEqual({ pode: true, pendencias: [], etapasDispensadas: true });
    });
});
describe('RN-CORE-12: etapas obrigatórias do checkout', () => {
    it('RN-CORE-12: etapa obrigatória pendente bloqueia o checkout', () => {
        const r = avaliarCheckout({ resultado: 'order', motivo: null, fotoFachada: false, etapas: [pesquisa, opcional] });
        expect(r).toEqual({ pode: false, pendencias: ['Pesquisa'], etapasDispensadas: false });
    });
    it('RN-CORE-12: etapa obrigatória concluída libera', () => {
        const r = avaliarCheckout({ resultado: 'order', motivo: null, fotoFachada: false, etapas: [{ ...pesquisa, concluida: true }] });
        expect(r.pode).toBe(true);
    });
    it('RN-CORE-12: sem pedido exige motivo; motivo comum não dispensa etapas', () => {
        expect(avaliarCheckout({ resultado: 'no_order', motivo: null, fotoFachada: false, etapas: [] })).toMatchObject({ pode: false, pendencias: ['motivo'] });
        expect(avaliarCheckout({ resultado: 'no_order', motivo: 'estoque_alto', fotoFachada: false, etapas: [pesquisa] })).toMatchObject({ pode: false, pendencias: ['Pesquisa'] });
    });
    it('RN-CORE-12: resultado ainda não escolhido bloqueia', () => {
        expect(avaliarCheckout({ resultado: null, motivo: null, fotoFachada: false, etapas: [] }).pode).toBe(false);
    });
});
describe('avaliarCheckoutVisita — resultado × Vendedor efetivo (RN-CORE-12 e RN-CORE-14)', () => {
    const etapaPendente = { rotulo: 'Pesquisa', obrigatoria: true, concluida: false };
    const base = { vendedorEfetivo: true, temMotivo: false, motivoClienteFechado: false, fotoFachada: false, temPedido: false, etapas: [] };
    it('RN-CORE-12: sem pedido exige motivo quando o Vendedor está ativo', () => {
        const r = avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido' });
        expect(r.pode).toBe(false);
        expect(r.pendencias).toEqual(['motivo']);
        expect(avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido', temMotivo: true }).pode).toBe(true);
    });
    it('RN-CORE-12: promotor (sem Vendedor efetivo) fecha como atendido sem motivo', () => {
        expect(avaliarCheckoutVisita({ ...base, vendedorEfetivo: false, resultado: 'atendido' }).pode).toBe(true);
    });
    it('RN-CORE-12: com Vendedor efetivo, "atendido" não vale — escolha pedido ou sem pedido', () => {
        expect(avaliarCheckoutVisita({ ...base, resultado: 'atendido' }).pendencias).toEqual(['resultado']);
    });
    it('RN-CORE-12: resultado com pedido exige o pedido feito na visita', () => {
        expect(avaliarCheckoutVisita({ ...base, resultado: 'pedido' }).pendencias).toEqual(['pedido']);
        expect(avaliarCheckoutVisita({ ...base, resultado: 'pedido', temPedido: true }).pode).toBe(true);
    });
    it('RN-CORE-12: etapa obrigatória pendente de módulo ativo bloqueia o checkout', () => {
        const r = avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido', temMotivo: true, etapas: [etapaPendente] });
        expect(r.pendencias).toEqual(['Pesquisa']);
    });
    it('RN-CORE-14: cliente fechado exige motivo da lista fechada e foto da fachada', () => {
        const r = avaliarCheckoutVisita({ ...base, resultado: 'cliente_fechado' });
        expect(r.pendencias).toEqual(['motivo', 'foto_fachada']);
        expect(avaliarCheckoutVisita({ ...base, resultado: 'cliente_fechado', motivoClienteFechado: true, fotoFachada: true }).pode).toBe(true);
    });
    it('RN-CORE-14: cliente fechado dispensa as etapas obrigatórias (pesquisa, checklist)', () => {
        const r = avaliarCheckoutVisita({ ...base, vendedorEfetivo: false, resultado: 'cliente_fechado', motivoClienteFechado: true, fotoFachada: true, etapas: [etapaPendente] });
        expect(r.pode).toBe(true);
        expect(r.etapasDispensadas).toBe(true);
    });
});
describe('prepararCheckoutVisita — folha de checkout (RN-CORE-12, com RN-CORE-14)', () => {
    const pesquisaPend = { modulo: 'pesquisa', id: 'pesquisa.obrigatoria', rotulo: 'Pesquisa', obrigatoria: true, concluida: false };
    const pesquisaOk = { ...pesquisaPend, concluida: true };
    const checklistPend = { modulo: 'promotor', id: 'checklist', rotulo: 'Checklist da loja', obrigatoria: true, concluida: false };
    const notaOpcional = { modulo: 'promotor', id: 'nota', rotulo: 'Nota', obrigatoria: false, concluida: false };
    const naoVenda = { tipo: 'nao_venda' };
    const fechado = { tipo: 'cliente_fechado' };
    const vendedor = { vendedorEfetivo: true, motivo: null, fotoFachada: false, temPedido: false, etapas: [] };
    const promotor = { ...vendedor, vendedorEfetivo: false };
    describe('caminho feliz', () => {
        it('RN-CORE-12: vendedor com pedido feito na visita e etapas cumpridas conclui como "pedido"', () => {
            const r = prepararCheckoutVisita({ ...vendedor, escolha: 'pedido', temPedido: true, etapas: [pesquisaOk] });
            expect(r).toMatchObject({ pode: true, pendencias: [], resultado: 'pedido', clienteFechado: false, etapasDispensadas: false, etapasPendentes: [] });
            expect(r.etapasRegistro).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria', situacao: 'concluida' }]);
        });
        it('RN-CORE-12: vendedor sem pedido com motivo de não venda conclui como "sem_pedido"', () => {
            const r = prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', motivo: naoVenda });
            expect(r).toMatchObject({ pode: true, pendencias: [], resultado: 'sem_pedido' });
        });
        it('RN-CORE-12: sem Vendedor efetivo (promotor) conclui como "atendido" sem motivo', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido' });
            expect(r).toMatchObject({ pode: true, pendencias: [], resultado: 'atendido' });
        });
    });
    describe('limites', () => {
        it('RN-CORE-12: etapa opcional pendente não bloqueia nem vai para o registro', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido', etapas: [notaOpcional] });
            expect(r.pode).toBe(true);
            expect(r.etapasPendentes).toEqual([]);
            expect(r.etapasRegistro).toEqual([]);
        });
        it('RN-CORE-12: sem etapas registradas pelos módulos ativos, só o resultado decide', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', motivo: naoVenda, etapas: [] }).pode).toBe(true);
        });
        it('RN-CORE-12: etapa opcional concluída vai para o registro como "concluida"', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido', etapas: [{ ...notaOpcional, concluida: true }] });
            expect(r.etapasRegistro).toEqual([{ modulo: 'promotor', etapa: 'nota', situacao: 'concluida' }]);
        });
        it('RN-CORE-12: motivo escolhido com o resultado "pedido" não muda o resultado nem bloqueia', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'pedido', temPedido: true, motivo: naoVenda })).toMatchObject({ pode: true, resultado: 'pedido' });
        });
        it('RN-CORE-14: motivo de cliente fechado vence a escolha (vendedor e promotor) e vira "cliente_fechado"', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', motivo: fechado, fotoFachada: true }).resultado).toBe('cliente_fechado');
            expect(prepararCheckoutVisita({ ...promotor, escolha: 'atendido', motivo: fechado, fotoFachada: true }).resultado).toBe('cliente_fechado');
        });
        it('RN-CORE-14: cliente fechado com foto dispensa as etapas obrigatórias e as registra como "dispensada"', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido', motivo: fechado, fotoFachada: true, etapas: [pesquisaPend, checklistPend, notaOpcional] });
            expect(r).toMatchObject({ pode: true, pendencias: [], etapasDispensadas: true, clienteFechado: true, etapasPendentes: [] });
            expect(r.etapasRegistro).toEqual([
                { modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria', situacao: 'dispensada' },
                { modulo: 'promotor', etapa: 'checklist', situacao: 'dispensada' },
            ]);
        });
        it('RN-CORE-14: cliente fechado mantém como "concluida" a etapa que já tinha sido feita', () => {
            const r = prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', motivo: fechado, fotoFachada: true, etapas: [pesquisaOk] });
            expect(r.etapasRegistro).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria', situacao: 'concluida' }]);
        });
        it('a entrada não é alterada (função pura)', () => {
            const etapas = [pesquisaPend];
            const entrada = { ...vendedor, escolha: 'sem_pedido', motivo: naoVenda, etapas };
            const copia = structuredClone(entrada);
            prepararCheckoutVisita(entrada);
            expect(entrada).toEqual(copia);
        });
    });
    describe('recusas', () => {
        it('RN-CORE-12: resultado ainda não escolhido bloqueia, mas a folha já lista as etapas obrigatórias pendentes', () => {
            const r = prepararCheckoutVisita({ ...vendedor, escolha: null, etapas: [pesquisaPend] });
            expect(r).toMatchObject({ pode: false, pendencias: ['resultado'], resultado: null });
            expect(r.etapasPendentes).toEqual([pesquisaPend]);
        });
        it('RN-CORE-12: com Vendedor efetivo, sem pedido exige motivo', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido' })).toMatchObject({ pode: false, pendencias: ['motivo'] });
        });
        it('RN-CORE-12: com Vendedor efetivo, "pedido" exige o pedido feito na visita', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'pedido', temPedido: false })).toMatchObject({ pode: false, pendencias: ['pedido'], resultado: 'pedido' });
        });
        it('RN-CORE-12: com Vendedor efetivo, "atendido" não vale', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'atendido' })).toMatchObject({ pode: false, pendencias: ['resultado'] });
        });
        it('RN-CORE-12: sem Vendedor efetivo, "pedido" e "sem pedido" não valem', () => {
            expect(prepararCheckoutVisita({ ...promotor, escolha: 'pedido', temPedido: true }).pendencias).toEqual(['resultado']);
            expect(prepararCheckoutVisita({ ...promotor, escolha: 'sem_pedido', motivo: naoVenda }).pendencias).toEqual(['resultado']);
        });
        it('RN-CORE-12: etapa obrigatória pendente bloqueia e aparece em pendências e em etapasPendentes, na ordem do slot', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido', etapas: [checklistPend, notaOpcional, pesquisaPend] });
            expect(r).toMatchObject({ pode: false, pendencias: ['Checklist da loja', 'Pesquisa'] });
            expect(r.etapasPendentes.map((e) => e.id)).toEqual(['checklist', 'pesquisa.obrigatoria']);
            expect(r.etapasRegistro).toEqual([]);
        });
        it('RN-CORE-12: motivo comum (não venda) não dispensa as etapas obrigatórias', () => {
            const r = prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', motivo: naoVenda, etapas: [pesquisaPend] });
            expect(r).toMatchObject({ pode: false, pendencias: ['Pesquisa'], etapasDispensadas: false });
        });
        it('RN-CORE-12: pendências acumulam (motivo e etapa)', () => {
            expect(prepararCheckoutVisita({ ...vendedor, escolha: 'sem_pedido', etapas: [pesquisaPend] }).pendencias).toEqual(['motivo', 'Pesquisa']);
        });
        it('RN-CORE-14: cliente fechado sem foto da fachada bloqueia', () => {
            const r = prepararCheckoutVisita({ ...promotor, escolha: 'atendido', motivo: fechado, etapas: [pesquisaPend] });
            expect(r).toMatchObject({ pode: false, pendencias: ['foto_fachada'], etapasDispensadas: true, etapasPendentes: [] });
        });
    });
});
