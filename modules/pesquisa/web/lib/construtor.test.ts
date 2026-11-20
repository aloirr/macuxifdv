import { describe, expect, it } from 'vitest';
import { Pergunta, QuestionarioVersao, type RegraCondicional } from '../../contracts';
import { validarVersao } from '../../domain';
import { publicada } from '../../domain/util-teste';
import {
  adicionarOpcao,
  ajustarRegra,
  listaDeTexto,
  moverPergunta,
  mudarTipo,
  novaPergunta,
  novaRegra,
  operadoresPara,
  removerOpcao,
  removerPergunta,
  vigenciaDoForm,
  vigenciaParaForm,
} from './construtor';

let seq = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

describe('RF-PES-01: construtor — perguntas e opções', () => {
  it('RF-PES-01: pergunta nova de cada um dos nove tipos já nasce válida no contrato', () => {
    for (const tipo of ['sim_nao', 'unica', 'multipla', 'numero', 'texto', 'escala', 'data', 'foto', 'codigo_barras'] as const) {
      expect(Pergunta.safeParse(novaPergunta(tipo, novoId)).success, tipo).toBe(true);
    }
  });

  it('RF-PES-01: trocar o tipo mantém o id (estável entre versões, RN-PES-01), o enunciado e a obrigatoriedade', () => {
    const p = { ...novaPergunta('texto', novoId), enunciado: 'Qual o preço?', obrigatoria: true } as Pergunta;
    const q = mudarTipo(p, 'numero', novoId);
    expect(q).toMatchObject({ id: p.id, tipo: 'numero', enunciado: 'Qual o preço?', obrigatoria: true });
  });

  it('RF-PES-01: mover respeita as pontas; remover leva junto as regras que citam a pergunta', () => {
    const a = novaPergunta('sim_nao', novoId);
    const b = novaPergunta('texto', novoId);
    expect(moverPergunta([a, b], b.id, -1).map((p) => p.id)).toEqual([b.id, a.id]);
    expect(moverPergunta([a, b], a.id, -1).map((p) => p.id)).toEqual([a.id, b.id]);
    const regra = novaRegra([a, b], b.id, novoId)!;
    expect(removerPergunta([a, b], [regra], a.id)).toEqual({ perguntas: [b], regras: [] });
  });

  it('RF-PES-01: adicionar e remover opção; regra que usava a opção removida sai', () => {
    const p = adicionarOpcao(novaPergunta('unica', novoId), novoId);
    expect(p.tipo === 'unica' && p.opcoes).toHaveLength(3);
    const alvo = novaPergunta('texto', novoId);
    const r = novaRegra([p, alvo], alvo.id, novoId)!;
    const op = p.tipo === 'unica' ? p.opcoes[0]!.id : '';
    expect(r.valor).toBe(op);
    expect(removerOpcao(p, [r], op).regras).toEqual([]);
  });
});

describe('RF-PES-01 / RN-PES-05: regras condicionais no construtor', () => {
  it('RF-PES-01: operadores pelo tipo da origem (iguais aos aceitos pelo domain)', () => {
    expect(operadoresPara('multipla')).toEqual(['contem', 'nao_contem', 'respondida', 'nao_respondida']);
    expect(operadoresPara('foto')).toEqual(['respondida', 'nao_respondida']);
  });

  it('RF-PES-01: a primeira pergunta não tem regra (só olha para trás); a regra padrão passa no validarVersao', () => {
    const a = novaPergunta('sim_nao', novoId);
    const b = novaPergunta('texto', novoId);
    expect(novaRegra([a, b], a.id, novoId)).toBeNull();
    const r = novaRegra([a, b], b.id, novoId)!;
    expect(r).toMatchObject({ acao: 'mostrar', origem_id: a.id, operador: 'igual', valor: true });
    const v = QuestionarioVersao.parse(publicada({ perguntas: [a, b], regras: [r] }));
    expect(validarVersao(v).erros).toEqual([]);
  });

  it('RF-PES-01: trocar para operador sem valor apaga o valor; voltar repõe o padrão', () => {
    const a = novaPergunta('sim_nao', novoId);
    const b = novaPergunta('texto', novoId);
    const r = novaRegra([a, b], b.id, novoId)!;
    const semValor: RegraCondicional = ajustarRegra(r, [a, b], { operador: 'respondida' });
    expect(semValor).not.toHaveProperty('valor');
    expect(ajustarRegra(semValor, [a, b], { operador: 'igual' }).valor).toBe(true);
  });
});

describe('RF-PES-02: público e vigência no formulário', () => {
  it('RF-PES-02: lista digitada separada por vírgula, ponto e vírgula ou linha, sem repetidos', () => {
    expect(listaDeTexto('Varejo, Atacado;Farma\nVarejo,  ')).toEqual(['Varejo', 'Atacado', 'Farma']);
  });

  it('RF-PES-02: vigência em dias do fuso do tenant vira UTC inclusivo (00:00 a 23:59:59 de Manaus)', () => {
    const v = vigenciaDoForm({ inicio: '2026-10-01', fim: '2026-10-30' }, 'America/Manaus');
    expect(v).toEqual({ inicio: '2026-10-01T04:00:00Z', fim: '2026-10-31T03:59:59Z' });
    expect(vigenciaParaForm(v, 'America/Manaus')).toEqual({ inicio: '2026-10-01', fim: '2026-10-30' });
    expect(vigenciaDoForm({ inicio: '2026-10-01', fim: '' }, 'America/Manaus').fim).toBeNull();
  });
});

describe('RF-PES-01/02: formulário do rascunho ⇄ versão', async () => {
  const { SalvarRascunhoRequest } = await import('../../contracts');
  const { corpoDoForm, formDaVersao, idsInvalidos } = await import('./construtor');
  const U = '00000000-0000-4000-8000-000000000777';

  it('RF-PES-02: ida e volta preserva público, vigência (no fuso) e perguntas; o corpo passa no contrato', () => {
    const v = QuestionarioVersao.parse(
      publicada({
        publico_alvo: { perfis: ['vendedor'], equipes: [U], segmentos: ['Varejo'], regioes: ['Norte'], canais: ['Tradicional', 'Auto Serviço'], clientes: [] },
        vigencia: { inicio: '2026-10-01T04:00:00Z', fim: '2026-10-31T03:59:59Z' },
      }),
    );
    const f = formDaVersao(v, 'America/Manaus');
    expect(f).toMatchObject({ inicio: '2026-10-01', fim: '2026-10-30', segmentos: 'Varejo', canais: 'Tradicional, Auto Serviço', equipes: U });
    expect(corpoDoForm(f, 'America/Manaus').publico_alvo?.canais).toEqual(['Tradicional', 'Auto Serviço']); // RN-PES-05
    const corpo = corpoDoForm(f, 'America/Manaus');
    expect(SalvarRascunhoRequest.safeParse(corpo).success).toBe(true);
    expect(corpo).toMatchObject({ publico_alvo: v.publico_alvo, vigencia: v.vigencia, perguntas: v.perguntas });
  });

  it('RF-PES-02: id de equipe/cliente que não é UUID é apontado e não vai no corpo', () => {
    expect(idsInvalidos(`${U}\nabc`)).toEqual(['abc']);
    const f = { ...formDaVersao(QuestionarioVersao.parse(publicada()), 'America/Manaus'), clientes: `${U}, abc` };
    expect(corpoDoForm(f, 'America/Manaus').publico_alvo?.clientes).toEqual([U]);
  });
});
