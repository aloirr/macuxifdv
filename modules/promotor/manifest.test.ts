import { criarPermissoes, ehAcaoDePedido, PERFIS, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

const ativos = ['core', 'promotor'] as const;
const quem = (acao: string): Perfil[] => PERFIS.filter((perfil) => criarPermissoes([manifest]).pode(acao, { perfil, modulosAtivos: ativos }));

const COLETAS = [
  'coleta.registrar',
  'checklist_loja.responder',
  'gondola.registrar',
  'share.registrar',
  'preco.registrar',
  'ruptura.registrar',
  'validade.registrar',
  'ponto_extra.registrar',
  'concorrencia.registrar',
  'tarefa_trade.concluir',
];
const CADASTROS = [
  'mix_obrigatorio.gerenciar',
  'meta_share.gerenciar',
  'categoria_gondola.gerenciar',
  'concorrente.gerenciar',
  'foto_referencia.gerenciar',
  'checklist_modelo.gerenciar',
  'ponto_extra_negociado.gerenciar',
  'tarefa_trade.gerenciar',
];

describe('manifesto do promotor', () => {
  it('é válido no platform-sdk e usa visita.etapas_checkout', () => {
    expect(manifest.id).toBe('promotor');
    expect(manifest.usaExtensoes).toContain('visita.etapas_checkout');
  });

  it('RN-PRO-01: o manifesto não declara nenhuma ação de pedido', () => {
    const todos = JSON.stringify(manifest).toLowerCase();
    expect(todos).not.toMatch(/pedido/);
    expect(manifest.perfis).toContain('promotor');
    expect(Object.keys(manifest.acoes).filter(ehAcaoDePedido)).toEqual([]);
  });

  it('doc 03 §2: coletas de trade só para o promotor (supervisor, gerente, analista e admin apenas leem)', () => {
    for (const a of COLETAS) expect(quem(a), a).toEqual(['promotor']);
  });

  it('doc 03 §2: cadastros de trade só para analista e admin (promotor, supervisor e gerente não)', () => {
    for (const a of CADASTROS) expect(quem(a), a).toEqual(['analista', 'admin']);
  });

  it('declara exatamente as ações previstas (nada de escrita para quem só lê)', () => {
    expect(Object.keys(manifest.acoes).sort()).toEqual([...COLETAS, ...CADASTROS].sort());
  });

  it('ação com o módulo inativo é negada', () => {
    expect(criarPermissoes([manifest]).pode('gondola.registrar', { perfil: 'promotor', modulosAtivos: ['core'] })).toBe(false);
  });

  it('mantém os eventos promotor.*@1 do doc 02 e consome check-in/checkout do Core', () => {
    expect(manifest.publica).toEqual([
      'promotor.visita_loja.concluida@1',
      'promotor.gondola.registrada@1',
      'promotor.share.medido@1',
      'promotor.preco.coletado@1',
      'promotor.ruptura.registrada@1',
      'promotor.tarefa.concluida@1',
    ]);
    expect(manifest.consome).toEqual(['core.visita.checkin@1', 'core.visita.checkout@1']);
  });

  it('admin usa o BKO de cadastros: está em perfis; assistente e vendedor não', () => {
    expect(manifest.perfis).toContain('admin');
    expect(manifest.perfis).not.toContain('vendedor');
    expect(manifest.perfis).not.toContain('assistente');
  });
});
