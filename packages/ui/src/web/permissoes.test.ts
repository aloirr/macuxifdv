import { describe, expect, it } from 'vitest';
import { Cadeado, Interruptor, SeletorDePerfis } from './permissoes';

// sem react-dom: os componentes (sem hooks) são chamados como função e a árvore é percorrida
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function nos(x: unknown): No[] {
  if (Array.isArray(x)) return x.flatMap(nos);
  if (!x || typeof x !== 'object' || !('props' in x)) return [];
  const n = x as No;
  // componente filho do kit (função): expande para a árvore dele
  if (typeof n.type === 'function') return [n, ...nos((n.type as (p: unknown) => unknown)(n.props))];
  return [n, ...nos(n.props.children)];
}

function texto(x: unknown): string {
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return x.map(texto).join('');
  if (!x || typeof x !== 'object' || !('props' in x)) return '';
  const n = x as No;
  if (n.props['aria-hidden'] === 'true') return '';
  if (typeof n.type === 'function') return texto((n.type as (p: unknown) => unknown)(n.props));
  return texto(n.props.children);
}

const porTestId = (a: No[], id: string) => a.find((n) => n.props['data-testid'] === id);
const nada = () => undefined;

describe('Cadeado', () => {
  it('botão "Travado" com a regra como descrição (tooltip)', () => {
    const a = nos(Cadeado({ id: 'l-trava', mensagem: 'Vendedor nunca entra no BKO.' }));
    const botao = porTestId(a, 'cadeado.botao');
    expect(botao?.props['aria-label']).toBe('Travado');
    expect(botao?.props['aria-describedby']).toBe('l-trava');
    const tip = porTestId(a, 'cadeado.texto');
    expect(tip?.props.role).toBe('tooltip');
    expect(tip?.props.id).toBe('l-trava');
    expect(texto(tip)).toBe('Vendedor nunca entra no BKO.');
    // aparece no hover e no foco (o toque liga um dos dois)
    expect(String(tip?.props.className)).toContain('group-hover:block');
    expect(String(tip?.props.className)).toContain('group-focus-within:block');
  });
});

describe('Interruptor', () => {
  it('role switch, estado em aria-checked e "Sim"/"Não" escrito', () => {
    const ligado = Interruptor({ ligado: true, onChange: nada, rotuloId: 'x-rotulo' }) as unknown as No;
    expect(ligado.props.role).toBe('switch');
    expect(ligado.props['aria-checked']).toBe(true);
    expect(ligado.props['aria-labelledby']).toBe('x-rotulo');
    expect(nos(ligado).some((n) => n.props.children === 'Sim')).toBe(true);
    const desligado = Interruptor({ ligado: false, onChange: nada, rotulo: 'Excluir rascunho' }) as unknown as No;
    expect(desligado.props['aria-checked']).toBe(false);
    expect(desligado.props['aria-label']).toBe('Excluir rascunho');
    expect(nos(desligado).some((n) => n.props.children === 'Não')).toBe(true);
  });

  it('o toque inverte; o misto liga tudo; travado fica desabilitado', () => {
    const recebido: boolean[] = [];
    const on = Interruptor({ ligado: true, onChange: (v) => recebido.push(v), rotulo: 'a' }) as unknown as No;
    (on.props.onClick as () => void)();
    const misto = Interruptor({ ligado: true, misto: true, onChange: (v) => recebido.push(v), rotulo: 'a' }) as unknown as No;
    expect(misto.props['data-estado']).toBe('misto');
    expect(misto.props['aria-checked']).toBe(false);
    (misto.props.onClick as () => void)();
    expect(recebido).toEqual([false, true]);
    expect(nos(misto).some((n) => n.props.children === 'Em parte')).toBe(true);
    const travado = Interruptor({ ligado: false, onChange: nada, rotulo: 'a', desabilitado: true, descricaoId: 'l-trava' }) as unknown as No;
    expect(travado.props.disabled).toBe(true);
    expect(travado.props['aria-describedby']).toBe('l-trava');
  });
  it('so-desligada (regra de Parâmetros › Alertas): ligado sem texto; desligado com o selo "Desligada"; o estado segue no aria-checked', () => {
    const ligado = Interruptor({ ligado: true, onChange: nada, rotulo: 'Parado entre visitas', estadoEscrito: 'so-desligada' }) as unknown as No;
    expect(ligado.props['aria-checked']).toBe(true);
    expect(nos(ligado).some((n) => ['Sim', 'Não', 'Desligada'].includes(n.props.children as string))).toBe(false);
    expect(porTestId(nos(ligado), 'interruptor.desligada')).toBeUndefined();
    const desligado = Interruptor({ ligado: false, onChange: nada, rotulo: 'Parado entre visitas', estadoEscrito: 'so-desligada' }) as unknown as No;
    expect(desligado.props['aria-checked']).toBe(false);
    expect(porTestId(nos(desligado), 'interruptor.desligada')).toBeDefined();
    expect(nos(desligado).some((n) => n.props.children === 'Desligada')).toBe(true);
    expect(nos(desligado).some((n) => n.props.children === 'Não')).toBe(false);
  });
});

describe('SeletorDePerfis', () => {
  const opcoes = [
    { valor: 'vendedor', rotulo: 'Vendedor', selo: 'Padrão' },
    { valor: 'vendedor_jr', rotulo: 'Vendedor júnior', detalhe: 'Base: Vendedor' },
    { valor: 'admin', rotulo: 'Admin', desabilitada: true, motivo: 'A senha de um admin não é redefinida por aqui.' },
  ];

  it('caixas nativas num fieldset com legenda; marcados; admin travado com motivo', () => {
    const a = nos(SeletorDePerfis({ nome: 'alvos', legenda: 'De quais perfis', opcoes, marcados: ['vendedor_jr'], onChange: nada }));
    expect(porTestId(a, 'perfis')?.type).toBe('fieldset');
    expect(texto(a.find((n) => n.type === 'legend'))).toBe('De quais perfis');
    const caixas = a.filter((n) => n.type === 'input');
    expect(caixas.map((c) => [c.props.value, c.props.checked, c.props.disabled])).toEqual([
      ['vendedor', false, false],
      ['vendedor_jr', true, false],
      ['admin', false, true],
    ]);
    expect(texto(a.filter((n) => n.type === 'label')[2])).toContain('não é redefinida por aqui.');
  });

  it('"todos" marcado: as outras aparecem marcadas e desabilitadas (menos a travada)', () => {
    const a = nos(SeletorDePerfis({ nome: 'alvos', legenda: 'x', opcoes, marcados: ['*'], onChange: nada, todos: { rotulo: 'Todos os perfis, menos admin' } }));
    const caixas = a.filter((n) => n.type === 'input');
    expect(caixas.map((c) => [c.props.value, c.props.checked, c.props.disabled])).toEqual([
      ['*', true, false],
      ['vendedor', true, true],
      ['vendedor_jr', true, true],
      ['admin', false, true],
    ]);
    expect(porTestId(a, 'perfis.todos')).toBeDefined();
  });

  it('erro de nenhum perfil: alerta, aria-invalid e descrição', () => {
    const a = nos(SeletorDePerfis({ nome: 'perfis', legenda: 'Perfis', ajuda: 'Marque um ou mais.', opcoes, marcados: [], onChange: nada, erro: 'Escolha pelo menos um perfil.' }));
    const fs = porTestId(a, 'perfis');
    expect(fs?.props['aria-invalid']).toBe(true);
    expect(fs?.props['aria-describedby']).toBe('perfis-ajuda perfis-erro');
    expect(porTestId(a, 'perfis.erro')?.props.role).toBe('alert');
  });

  it('marcar e desmarcar avisam a tela', () => {
    const recebido: Array<[string, boolean]> = [];
    const a = nos(SeletorDePerfis({ nome: 'p', legenda: 'x', opcoes, marcados: [], onChange: (v, m) => recebido.push([v, m]) }));
    (porTestId(a, 'perfis.vendedor')?.props.onChange as (e: unknown) => void)({ target: { checked: true } });
    expect(recebido).toEqual([['vendedor', true]]);
  });
});
