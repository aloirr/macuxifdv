/**
 * T-0145 (R-20261110-062232; RN-CORE-37): permissões obrigatórias antes do login e da sincronização. Critérios 2 a 5 nas
 * regras puras: Campo exige as 4 e Gestão só notificações; localização em 2 passos no Android 11+; depois de 2 recusas,
 * "Abrir configurações"; permissão retirada volta à mesma tela, só com ela ("Negada" só na negada, RD-2466).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  botaoDepoisDeToquesSemEfeito,
  galeriaEfetiva,
  mesmoEstadoDePermissoes,
  PASSO_FALTA_LOCALIZACAO,
  PASSO_FALTA_TRECHOS,
  pedirAsQueFaltam,
  permissoesExigidas,
  permissoesLiberadas,
  ROTULO_ABRIR_CONFIGURACOES,
  proximoPedidoAutomatico,
  ROTULO_PERMITIR,
  telaDePermissoes,
  TUDO_CONCEDIDO,
  type EstadoPermissao,
  type EstadosPermissoes,
  type PedidoDePermissao,
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
  it('1ª abertura: as 4 linhas que faltam, botão Permitir pede a 1ª da ordem (notificações)', () => {
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

  it('permissão retirada nas configurações: na abertura seguinte a mesma tela, só com ela', () => {
    const t = telaDePermissoes('campo', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK, camera: OK, galeria: FALTA }), API_11);
    expect(t.linhas.map((l) => l.id)).toEqual(['galeria']);
    expect(t.subtitulo).toBe('Sem ela o app não funciona.');
    expect(t.botao).toEqual({ id: 'galeria', acao: 'pedir', rotulo: ROTULO_PERMITIR });
  });

  it('todas concedidas: sem linhas e sem botão (a tela some sozinha)', () => {
    const t = telaDePermissoes('campo', TUDO_CONCEDIDO, API_11);
    expect(t.linhas).toEqual([]);
    expect(t.botao).toBeNull();
  });
});

describe('telaDePermissoes — Gestão', () => {
  it('só notificações, com o motivo e o subtítulo do Gestão', () => {
    const t = telaDePermissoes('gestao', estados(), API_11);
    expect(t.subtitulo).toBe('Sem ela o app não funciona.');
    expect(t.linhas).toEqual([{ id: 'notificacoes', nome: 'Notificações', texto: 'Pedidos para aprovar e recados.', situacao: 'falta' }]);
    expect(t.botao?.id).toBe('notificacoes');
  });
});

describe('T-0187 (RN-CORE-37): "o tempo todo" no Gestão só para o supervisor', () => {
  it('permissões exigidas: o Campo segue com as 4 para todos; o Gestão acrescenta a localização só ao cargo rastreado nele', () => {
    expect(permissoesExigidas('campo', 'vendedor')).toEqual(['notificacoes', 'localizacao', 'camera', 'galeria']);
    expect(permissoesExigidas('campo', null)).toEqual(['notificacoes', 'localizacao', 'camera', 'galeria']);
    expect(permissoesExigidas('gestao', 'supervisor')).toEqual(['notificacoes', 'localizacao']);
    // o gerente não é rastreado (T-0187 §0) e, antes do login, o cargo não é conhecido
    expect(permissoesExigidas('gestao', 'gerente')).toEqual(['notificacoes']);
    expect(permissoesExigidas('gestao', null)).toEqual(['notificacoes']);
  });

  it('o supervisor só segue com a localização "o tempo todo"; o gerente segue só com notificações', () => {
    const soNotificacoes = estados({ notificacoes: OK });
    const exigidasSup = permissoesExigidas('gestao', 'supervisor');
    expect(permissoesLiberadas('gestao', soNotificacoes, exigidasSup)).toBe(false);
    expect(permissoesLiberadas('gestao', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: FALTA }), exigidasSup)).toBe(false);
    expect(permissoesLiberadas('gestao', estados({ notificacoes: OK, duranteUso: OK, tempoTodo: OK }), exigidasSup)).toBe(true);
    expect(permissoesLiberadas('gestao', soNotificacoes, permissoesExigidas('gestao', 'gerente'))).toBe(true);
  });

  it('tela do supervisor: só a localização que falta, com os 2 passos no Android 11+', () => {
    const exigidas = permissoesExigidas('gestao', 'supervisor');
    const t = telaDePermissoes('gestao', estados({ notificacoes: OK, duranteUso: OK }), API_11, 0, exigidas);
    expect(t.subtitulo).toBe('Sem ela o app não funciona.');
    expect(t.linhas.map((l) => [l.id, l.situacao])).toEqual([['localizacao', 'falta']]);
    expect(t.passosLocalizacao?.falta).toBe(PASSO_FALTA_LOCALIZACAO);
    expect(t.botao).toEqual({ id: 'localizacao', acao: 'pedir-tempo-todo', rotulo: ROTULO_ABRIR_CONFIGURACOES });
  });

  it('tela do gerente: igual à de hoje (só notificações)', () => {
    const t = telaDePermissoes('gestao', estados(), API_11, 0, permissoesExigidas('gestao', 'gerente'));
    expect(t).toEqual(telaDePermissoes('gestao', estados(), API_11));
  });
});

describe('R-20261120-052422: na abertura, as janelas do Android direto; a tela só com o que ficou faltando', () => {
  const campo = permissoesExigidas('campo');

  /** Aparelho simulado: cada pedido aplica a resposta do usuário ao estado e conta as janelas abertas. */
  function aparelho(inicial: EstadosPermissoes, responder: (p: PedidoDePermissao, e: EstadosPermissoes) => EstadosPermissoes) {
    let e = inicial;
    const pedidos: string[] = [];
    return {
      pedidos,
      ler: () => Promise.resolve(e),
      pedir: (p: PedidoDePermissao) => {
        pedidos.push(`${p.id}:${p.acao}`);
        e = responder(p, e);
        return Promise.resolve();
      },
    };
  }
  /** O usuário aceita tudo o que o Android pergunta. */
  const aceitaTudo = (p: PedidoDePermissao, e: EstadosPermissoes): EstadosPermissoes => {
    if (p.id === 'localizacao') {
      return p.acao === 'pedir'
        ? { ...e, localizacao: { ...e.localizacao, duranteUso: OK } }
        : { ...e, localizacao: { ...e.localizacao, tempoTodo: OK } };
    }
    return { ...e, [p.id]: OK };
  };

  it('tudo já concedido: nenhuma janela e nenhuma tela', async () => {
    const a = aparelho(TUDO_CONCEDIDO, aceitaTudo);
    const final = await pedirAsQueFaltam(campo, a.ler, a.pedir);
    expect(a.pedidos).toEqual([]);
    expect(permissoesLiberadas('campo', final, campo)).toBe(true);
    expect(telaDePermissoes('campo', final, API_11, 0, campo).linhas).toEqual([]);
  });

  it('1ª abertura com tudo aceito: as 5 janelas na ordem (localização em 2 passos) e nenhuma tela', async () => {
    const a = aparelho(estados(), aceitaTudo);
    const final = await pedirAsQueFaltam(campo, a.ler, a.pedir);
    expect(a.pedidos).toEqual(['notificacoes:pedir', 'localizacao:pedir', 'localizacao:pedir-tempo-todo', 'camera:pedir', 'galeria:pedir']);
    expect(permissoesLiberadas('campo', final, campo)).toBe(true);
  });

  it('uma negada: as outras seguem e a tela fica só com ela', async () => {
    const a = aparelho(estados(), (p, e) => (p.id === 'camera' ? { ...e, camera: FALTA } : aceitaTudo(p, e)));
    const final = await pedirAsQueFaltam(campo, a.ler, a.pedir);
    // cada janela sai uma vez só (a câmera recusada não volta em laço)
    expect(a.pedidos.filter((x) => x === 'camera:pedir')).toHaveLength(1);
    expect(a.pedidos).toContain('galeria:pedir');
    const t = telaDePermissoes('campo', final, API_11, 0, campo);
    expect(t.linhas.map((l) => l.id)).toEqual(['camera']);
    expect(t.botao).toEqual({ id: 'camera', acao: 'pedir', rotulo: ROTULO_PERMITIR });
  });

  it('"durante o uso" recusado: o passo "o tempo todo" não é pedido', async () => {
    const a = aparelho(estados(), (p, e) => (p.id === 'localizacao' ? e : aceitaTudo(p, e)));
    await pedirAsQueFaltam(campo, a.ler, a.pedir);
    expect(a.pedidos).not.toContain('localizacao:pedir-tempo-todo');
  });

  it('o que o Android não pergunta mais não abre janela (fica para a tela, com "Abrir configurações")', () => {
    expect(proximoPedidoAutomatico(campo, { ...TUDO_CONCEDIDO, camera: NEGADA }, [])).toBeNull();
    expect(proximoPedidoAutomatico(campo, { ...TUDO_CONCEDIDO, camera: NEGADA, galeria: FALTA }, [])).toEqual({ id: 'galeria', acao: 'pedir' });
    expect(proximoPedidoAutomatico(campo, { ...TUDO_CONCEDIDO, galeria: FALTA }, ['galeria:pedir'])).toBeNull();
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

describe('shell: permissões liberadas calculadas uma vez por render (RD-2443)', () => {
  const plataforma = readFileSync(fileURLToPath(new URL('../state/plataforma.tsx', import.meta.url)), 'utf8');

  it('um só cálculo no render, sem leitura do aparelho nada liberado; o ref e a tela leem o mesmo valor', () => {
    expect(plataforma).toMatch(
      /const permissoesOk = estadosPermissoes !== null && permissoesLiberadas\(variante, estadosPermissoes, permissoesDoUsuario\);/,
    );
    expect(plataforma).toMatch(/permissoesOkRef\.current = permissoesOk;/);
    expect(plataforma).toMatch(/estadosPermissoes && !permissoesOk && !pedidoAutomatico\s*\?\s*telaDePermissoes\(/);
    expect(plataforma.match(/permissoesLiberadas\(variante, estadosPermissoes,/g)).toHaveLength(1);
  });
});
