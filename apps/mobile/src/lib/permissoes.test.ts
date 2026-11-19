/**
 * T-0145 (R-20261110-062232; RN-CORE-37): permissões obrigatórias antes do login e da sincronização. Critérios 2 a 5 nas
 * regras puras: Campo exige as 4 e Gestão só notificações; localização em 2 passos no Android 11+; depois de 2 recusas,
 * "Abrir configurações"; permissão retirada volta à mesma tela, só com ela em "Falta"/"Negada".
 */
import { APP_RASTREADO_DO_CARGO } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';

import {
  AVISO_LOCALIZACAO,
  botaoDepoisDeToquesSemEfeito,
  galeriaEfetiva,
  mesmoEstadoDePermissoes,
  PASSO_FALTA_LOCALIZACAO,
  PASSO_FALTA_TRECHOS,
  permissoesExigidas,
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

/** T-0187 §1.2: o app rastreado de cada cargo, o do Core (o mesmo que o shell usa). */
const APP_DO_CARGO = APP_RASTREADO_DO_CARGO;

describe('T-0187 (RN-CORE-37): "o tempo todo" no Gestão só para o supervisor', () => {
  it('permissões exigidas: o Campo segue com as 4 para todos; o Gestão acrescenta a localização só ao cargo rastreado nele', () => {
    expect(permissoesExigidas('campo', 'vendedor', APP_DO_CARGO)).toEqual(['notificacoes', 'localizacao', 'camera', 'galeria']);
    expect(permissoesExigidas('campo', null, APP_DO_CARGO)).toEqual(['notificacoes', 'localizacao', 'camera', 'galeria']);
    expect(permissoesExigidas('gestao', 'supervisor', APP_DO_CARGO)).toEqual(['notificacoes', 'localizacao']);
    // o gerente não é rastreado (T-0187 §0) e, antes do login, o cargo não é conhecido
    expect(permissoesExigidas('gestao', 'gerente', APP_DO_CARGO)).toEqual(['notificacoes']);
    expect(permissoesExigidas('gestao', null, APP_DO_CARGO)).toEqual(['notificacoes']);
    expect(APP_DO_CARGO).toMatchObject({ vendedor: 'campo', promotor: 'campo', supervisor: 'gestao' });
    expect(APP_DO_CARGO.gerente).toBeUndefined();
    // sem o mapa, nada muda no Gestão
    expect(permissoesExigidas('gestao', 'supervisor', {})).toEqual(['notificacoes']);
    expect(permissoesExigidas('gestao', 'supervisor')).toEqual(['notificacoes']);
  });

  it('o supervisor só segue com a localização "o tempo todo"; o gerente segue só com notificações', () => {
    const soNotificacoes = estados({ notificacoes: OK });
    const exigidasSup = permissoesExigidas('gestao', 'supervisor', APP_DO_CARGO);
    expect(permissoesLiberadas('gestao', soNotificacoes, exigidasSup)).toBe(false);
    expect(permissoesLiberadas('gestao', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: FALTA }), exigidasSup)).toBe(false);
    expect(permissoesLiberadas('gestao', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK }), exigidasSup)).toBe(true);
    expect(permissoesLiberadas('gestao', soNotificacoes, permissoesExigidas('gestao', 'gerente', APP_DO_CARGO))).toBe(true);
  });

  it('tela do supervisor: notificações e localização, com o aviso da base LGPD e os 2 passos no Android 11+', () => {
    const exigidas = permissoesExigidas('gestao', 'supervisor', APP_DO_CARGO);
    const t = telaDePermissoes('gestao', estados({ notificacoes: OK, duranteUso: OK }), API_11, 0, exigidas);
    expect(t.subtitulo).toBe('Sem elas o app não funciona.');
    expect(t.linhas.map((l) => [l.id, l.situacao])).toEqual([
      ['notificacoes', 'permitida'],
      ['localizacao', 'falta'],
    ]);
    expect(t.linhas[0]!.texto).toBe('Pedidos para aprovar e recados.');
    expect(t.avisoLocalizacao).toBe(AVISO_LOCALIZACAO);
    expect(t.passosLocalizacao?.falta).toBe(PASSO_FALTA_LOCALIZACAO);
    expect(t.botao).toEqual({ id: 'localizacao', acao: 'pedir-tempo-todo', rotulo: ROTULO_ABRIR_CONFIGURACOES });
  });

  it('tela do gerente: igual à de hoje (só notificações, sem o aviso da localização)', () => {
    const t = telaDePermissoes('gestao', estados(), API_11, 0, permissoesExigidas('gestao', 'gerente', APP_DO_CARGO));
    expect(t).toEqual(telaDePermissoes('gestao', estados(), API_11));
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

describe('🟡 1 da revisão T-0145: a galeria nunca prende o app', () => {
  const leitura = (estado: EstadoPermissao, o: { limitada?: boolean; leituraAndroid?: boolean | null } = {}) => ({
    estado,
    limitada: o.limitada ?? false,
    leituraAndroid: o.leituraAndroid ?? null,
  });

  it('acesso parcial ("limitado", Android 14+) conta como concedida', () => {
    expect(galeriaEfetiva(leitura(NEGADA, { limitada: true }), FALTA, 34)).toEqual(OK);
  });

  it('Android 11 e 12: WRITE negado sem volta, mas com a câmera concedida a galeria passa (nada a marcar nas configurações)', () => {
    for (const api of [30, 31, 32]) expect(galeriaEfetiva(leitura(NEGADA), OK, api)).toEqual(OK);
  });

  it('READ_EXTERNAL_STORAGE concedido (lido à parte) conta como concedida, mesmo sem a câmera', () => {
    expect(galeriaEfetiva(leitura(NEGADA, { leituraAndroid: true }), FALTA, 31)).toEqual(OK);
  });

  it('Android 11/12 sem a câmera: segue o estado lido (a câmera vem antes na ordem do botão)', () => {
    expect(galeriaEfetiva(leitura(FALTA), FALTA, 31)).toEqual(FALTA);
  });

  it('Android 10 e Android 13+: o estado lido vale (no 10 o WRITE dá acesso; no 13+ o pedido é vazio e vem concedido)', () => {
    expect(galeriaEfetiva(leitura(NEGADA), OK, API_10)).toEqual(NEGADA);
    expect(galeriaEfetiva(leitura(NEGADA), OK, 33)).toEqual(NEGADA);
    expect(galeriaEfetiva(leitura(OK), FALTA, 33)).toEqual(OK);
  });

  it('Campo no Android 12 com a galeria "negada" pelo WRITE e o resto concedido: o app segue', () => {
    const galeria = galeriaEfetiva(leitura(NEGADA), OK, 31);
    const e = estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK, camera: OK, galeria });
    expect(permissoesLiberadas('campo', e)).toBe(true);
    expect(telaDePermissoes('campo', e, 31).botao).toBeNull();
  });
});

describe('🟡 2 da revisão T-0145: o "Permitir" sem efeito não fica em laço', () => {
  it('depois de 2 toques sem mudança, o botão vira "Abrir configurações" para a mesma permissão', () => {
    const e = estados();
    expect(telaDePermissoes('campo', e, API_11, 1).botao).toMatchObject({ id: 'notificacoes', acao: 'pedir', rotulo: ROTULO_PERMITIR });
    expect(telaDePermissoes('campo', e, API_11, 2).botao).toEqual({
      id: 'notificacoes',
      acao: 'abrir-configuracoes',
      rotulo: ROTULO_ABRIR_CONFIGURACOES,
    });
  });

  it('o passo 2 da localização também cai nas configurações; "Abrir configurações" e "sem botão" não mudam', () => {
    const tempoTodo = { id: 'localizacao' as const, acao: 'pedir-tempo-todo' as const, rotulo: ROTULO_ABRIR_CONFIGURACOES };
    expect(botaoDepoisDeToquesSemEfeito(tempoTodo, 2)?.acao).toBe('abrir-configuracoes');
    const config = { id: 'camera' as const, acao: 'abrir-configuracoes' as const, rotulo: ROTULO_ABRIR_CONFIGURACOES };
    expect(botaoDepoisDeToquesSemEfeito(config, 5)).toBe(config);
    expect(botaoDepoisDeToquesSemEfeito(null, 5)).toBeNull();
  });

  it('mesmoEstadoDePermissoes: igual só com as mesmas concessões e o mesmo "pode perguntar"', () => {
    expect(mesmoEstadoDePermissoes(estados(), estados())).toBe(true);
    expect(mesmoEstadoDePermissoes(estados(), estados({ camera: NEGADA }))).toBe(false);
    expect(mesmoEstadoDePermissoes(estados(), estados({ tempoTodo: OK }))).toBe(false);
  });
});
