/**
 * T-0145 (R-20261110-062232; RN-CORE-37): permissões obrigatórias antes do login e da sincronização. Critérios 2 a 5 nas
 * regras puras: Campo exige as 4 e Gestão só notificações; localização em 2 passos no Android 11+; depois de 2 recusas,
 * "Abrir configurações"; permissão retirada volta à mesma tela, só com ela em "Falta"/"Negada".
 */
import { describe, expect, it } from 'vitest';

import {
  AVISO_LOCALIZACAO,
  PASSO_FALTA_LOCALIZACAO,
  PASSO_FALTA_TRECHOS,
  permissoesLiberadas,
  ROTULO_ABRIR_CONFIGURACOES,
  ROTULO_PERMITIR,
  telaDePermissoes,
  TUDO_CONCEDIDO,
  type EstadoPermissao,
  type EstadosPermissoes,
} from './permissoes';

const OK: EstadoPermissao = { concedida: true, podePerguntar: true };
const FALTA: EstadoPermissao = { concedida: false, podePerguntar: true };
const NEGADA: EstadoPermissao = { concedida: false, podePerguntar: false };

function estados(o: Partial<{ notificacoes: EstadoPermissao; duranteUso: EstadoPermissao; tempoTodo: EstadoPermissao; camera: EstadoPermissao; galeria: EstadoPermissao }> = {}): EstadosPermissoes {
  return {
    notificacoes: o.notificacoes ?? FALTA,
    localizacao: { duranteUso: o.duranteUso ?? FALTA, tempoTodo: o.tempoTodo ?? FALTA },
    camera: o.camera ?? FALTA,
    galeria: o.galeria ?? FALTA,
  };
}

const API_11 = 30;
const API_10 = 29;

describe('permissoesLiberadas — o app só segue com todas', () => {
  it('Campo exige as 4 (localização "o tempo todo", não só "durante o uso")', () => {
    expect(permissoesLiberadas('campo', TUDO_CONCEDIDO)).toBe(true);
    expect(permissoesLiberadas('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: FALTA, camera: OK, galeria: OK }))).toBe(false);
    expect(permissoesLiberadas('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK, camera: OK, galeria: NEGADA }))).toBe(false);
  });

  it('Gestão exige só notificações', () => {
    expect(permissoesLiberadas('gestao', estados({ notificacoes: OK }))).toBe(true);
    expect(permissoesLiberadas('gestao', estados({ notificacoes: NEGADA, duranteUso: OK, tempoTodo: OK, camera: OK, galeria: OK }))).toBe(false);
  });
});

describe('telaDePermissoes — Campo', () => {
  it('1ª abertura: as 4 linhas em "Falta", botão Permitir pede a 1ª da ordem (notificações)', () => {
    const t = telaDePermissoes('campo', estados(), API_11);
    expect(t.titulo).toBe('Permissões');
    expect(t.subtitulo).toBe('Sem elas o app não funciona.');
    expect(t.linhas.map((l) => [l.nome, l.situacao])).toEqual([
      ['Notificações', 'falta'],
      ['Localização o tempo todo', 'falta'],
      ['Câmera', 'falta'],
      ['Fotos e galeria', 'falta'],
    ]);
    expect(t.botao).toEqual({ id: 'notificacoes', acao: 'pedir', rotulo: ROTULO_PERMITIR });
    expect(t.passosLocalizacao).toBeNull();
  });

  it('localização no Android 11+: passo 1 é o diálogo "durante o uso"; passo 2 vai às configurações, com o cartão dos 2 passos', () => {
    const passo1 = telaDePermissoes('campo', estados({ notificacoes: OK }), API_11);
    expect(passo1.botao).toEqual({ id: 'localizacao', acao: 'pedir', rotulo: ROTULO_PERMITIR });
    expect(passo1.passosLocalizacao).toBeNull();

    const passo2 = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, camera: OK, galeria: OK }), API_11);
    expect(passo2.linhas.find((l) => l.id === 'localizacao')!.situacao).toBe('falta');
    expect(passo2.botao).toEqual({ id: 'localizacao', acao: 'pedir-tempo-todo', rotulo: ROTULO_ABRIR_CONFIGURACOES });
    expect(passo2.passosLocalizacao).toEqual({ feito: 'Durante o uso', falta: PASSO_FALTA_LOCALIZACAO, faltaTrechos: PASSO_FALTA_TRECHOS });
    // a imagem aprovada: "Em **Permissões › Localização**, marque **Permitir o tempo todo**."
    expect(PASSO_FALTA_LOCALIZACAO).toBe('Em Permissões › Localização, marque Permitir o tempo todo.');
    expect(PASSO_FALTA_TRECHOS.filter((p) => p.forte).map((p) => p.texto)).toEqual(['Permissões › Localização', 'Permitir o tempo todo']);
  });

  it('Android 10: "o tempo todo" ainda vem no diálogo (botão Permitir, sem o cartão dos 2 passos)', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK }), API_10);
    expect(t.botao).toEqual({ id: 'localizacao', acao: 'pedir-tempo-todo', rotulo: ROTULO_PERMITIR });
    expect(t.passosLocalizacao).toBeNull();
  });

  it('2 recusas (o Android não pergunta mais): "Negada", o motivo vira a ação e o botão abre as configurações', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK, camera: NEGADA, galeria: OK }), API_11);
    const camera = t.linhas.find((l) => l.id === 'camera')!;
    expect(camera).toMatchObject({ situacao: 'negada', texto: 'Em Permissões › Câmera, marque Permitir.' });
    expect(t.botao).toEqual({ id: 'camera', acao: 'abrir-configuracoes', rotulo: ROTULO_ABRIR_CONFIGURACOES });
  });

  it('localização "o tempo todo" negada depois do passo 1: abre as configurações (não pede de novo)', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: NEGADA }), API_11);
    expect(t.linhas.find((l) => l.id === 'localizacao')!.situacao).toBe('negada');
    expect(t.botao?.acao).toBe('abrir-configuracoes');
  });

  it('RD-0073: "o tempo todo" negada com o cartão dos 2 passos: a linha fica com o motivo e o caminho só no cartão', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: NEGADA }), API_11);
    expect(t.passosLocalizacao?.falta).toBe(PASSO_FALTA_LOCALIZACAO);
    expect(t.linhas.find((l) => l.id === 'localizacao')).toMatchObject({ situacao: 'negada', texto: 'Check-in e trajeto no horário de trabalho.' });
    const textos = [...t.linhas.map((l) => l.texto), t.passosLocalizacao!.falta];
    expect(textos.filter((x) => x === PASSO_FALTA_LOCALIZACAO)).toHaveLength(1);
  });

  it('localização negada sem o cartão (Android 10 ou "durante o uso" negado): o caminho fica na linha', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: NEGADA, tempoTodo: NEGADA }), API_11);
    expect(t.passosLocalizacao).toBeNull();
    expect(t.linhas.find((l) => l.id === 'localizacao')!.texto).toBe('Em Permissões › Localização, marque Permitir o tempo todo.');
  });

  it('permissão retirada nas configurações: na abertura seguinte a mesma tela, só ela fora de "Permitida"', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK, camera: OK, galeria: FALTA }), API_11);
    expect(t.linhas.filter((l) => l.situacao !== 'permitida').map((l) => l.id)).toEqual(['galeria']);
    expect(t.botao).toEqual({ id: 'galeria', acao: 'pedir', rotulo: ROTULO_PERMITIR });
  });

  it('todas concedidas: sem botão (a tela some sozinha)', () => {
    expect(telaDePermissoes('campo', TUDO_CONCEDIDO, API_11).botao).toBeNull();
  });
});

describe('telaDePermissoes — Gestão', () => {
  it('só notificações, com o motivo e o subtítulo do Gestão', () => {
    const t = telaDePermissoes('gestao', estados(), API_11);
    expect(t.subtitulo).toBe('Sem ela o app não funciona.');
    expect(t.linhas).toEqual([{ id: 'notificacoes', nome: 'Notificações', texto: 'Pedidos para aprovar e recados.', situacao: 'falta' }]);
    expect(t.botao?.id).toBe('notificacoes');
    // Gestão não pede localização: sem o link "Como usamos a localização"
    expect(t.avisoLocalizacao).toBeNull();
  });
});

describe('"Como usamos a localização" (base LGPD §6)', () => {
  it('só no Campo, com o aviso curto: trajeto só no expediente, nada fora dele', () => {
    const t = telaDePermissoes('campo', estados(), API_11);
    expect(t.avisoLocalizacao).toBe(AVISO_LOCALIZACAO);
    expect(AVISO_LOCALIZACAO.link).toBe('Como usamos a localização');
    expect(AVISO_LOCALIZACAO.texto).toMatch(/Durante o expediente/);
    expect(AVISO_LOCALIZACAO.texto).toMatch(/Fora do expediente, nada é registrado./);
  });
});
