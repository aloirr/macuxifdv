/**
 * T-0145 — tela "Permissões" pela imagem aprovada (R-20261110-093125, `docs/design/telas/T-0145-permissoes.png`), renderizada
 * com `react-dom/server` e `react-native`/kit simulados. R-20261120-052422: a tela lista só as que faltam e não tem mais o
 * link "Como usamos a localização".
 * - quadro 1 (Campo): só as linhas que faltam, com ícone, nome e motivo, sem rótulo de situação (RD-2466); botão "Permitir" sem ícone;
 * - quadro 2: cartão dos 2 passos ("Durante o uso" feito; passo 2 com os nomes do Android em negrito); botão com o ícone;
 * - quadro 3: negada, com "Negada", o motivo vira a ação e o botão "Abrir configurações";
 * - quadro 4 (Gestão): só notificações.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { telaDePermissoes, TUDO_CONCEDIDO, type EstadoPermissao, type EstadosPermissoes } from '@/lib/permissoes';

type Props = { children?: ReactNode; testID?: string; style?: unknown; accessibilityLabel?: string };
const host = (tag: string) =>
  function Host({ children, testID, style, accessibilityLabel }: Props) {
    const forte = Array.isArray(style) ? false : (style as { fontFamily?: string } | null)?.fontFamily === 'forte';
    const atributos = { ...(testID ? { 'data-testid': testID } : {}), ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}) };
    return createElement(forte ? 'b' : tag, atributos, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  ScrollView: host('main'),
  StyleSheet: { create: <T,>(s: T) => s, absoluteFill: {}, hairlineWidth: 1 },
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  BackHandler: { addEventListener: () => ({ remove: () => undefined }), exitApp: () => undefined },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  // `bold` marca o trecho forte do passo 2 (o host vira <b>)
  fonte: new Proxy({}, { get: (_t, k) => (k === 'bold' ? { fontFamily: 'forte' } : {}) }),
  type: new Proxy({}, { get: () => ({}) }),
  Card: host('section'),
  Icon: ({ name }: { name: string }) => createElement('i', { 'data-icone': name }),
  Button: ({ label, testID, icon }: { label: string; testID: string; icon?: string }) =>
    createElement('button', { 'data-testid': testID, 'data-icone': icon ?? '' }, label),
}));

const OK: EstadoPermissao = { concedida: true, podePerguntar: true };
const FALTA: EstadoPermissao = { concedida: false, podePerguntar: true };
const NEGADA: EstadoPermissao = { concedida: false, podePerguntar: false };
const API_11 = 30;

async function render(marca: string, e: EstadosPermissoes, variante: 'campo' | 'gestao' = 'campo'): Promise<string> {
  // importado depois das simulações (o kit simulado usa o `host` deste arquivo)
  const { TelaPermissoes } = await import('./tela-permissoes');
  return renderToStaticMarkup(
    createElement(TelaPermissoes, { marca, tela: telaDePermissoes(variante, e, API_11), pedindo: false, onBotao: () => undefined }),
  );
}

describe('TelaPermissoes — imagem aprovada T-0145', () => {
  it('quadro 1 (Campo, faltam 3): marca, título, subtítulo, só as 3 linhas que faltam e "Permitir" sem ícone', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, localizacao: { duranteUso: FALTA, tempoTodo: FALTA }, camera: FALTA, galeria: FALTA });
    expect(html).toContain('Macuxi Campo');
    expect(html).toContain('Permissões');
    expect(html).toContain('Sem elas o app não funciona.');
    for (const nome of ['Localização o tempo todo', 'Câmera', 'Fotos e galeria']) expect(html).toContain(nome);
    // a concedida não aparece
    expect(html).not.toContain('data-testid="permissao-notificacoes"');
    expect(html).not.toContain('Notificações');
    expect(html).not.toContain('Permitida');
    expect(html).toMatch(/data-icone="pin"/);
    // RD-2466: a lista já é só do que falta; a linha "falta" não repete a situação (nem na leitura de tela)
    expect(html).not.toContain('-situacao"');
    expect(html).not.toContain('Falta');
    expect(html).toContain('aria-label="Câmera. Fotos do PDV e da gôndola."');
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="">Permitir</);
    expect(html).not.toContain('data-testid="permissao-passos-localizacao"');
  });

  it('R-20261120-052422: sem o link "Como usamos a localização" nem o aviso dele', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, localizacao: { duranteUso: NEGADA, tempoTodo: NEGADA } });
    expect(html).not.toContain('Como usamos a localização');
    expect(html).not.toContain('permissoes-como-usamos');
    expect(html).not.toContain('permissoes-aviso-localizacao');
    expect(html).not.toContain('Fora do expediente');
  });

  it('quadro 2 (passo 2 de 2): cartão dos passos com os nomes do Android em negrito e "Abrir configurações" com ícone', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, localizacao: { duranteUso: OK, tempoTodo: FALTA } });
    expect(html).toContain('data-testid="permissao-passos-localizacao"');
    expect(html).toContain('Durante o uso');
    expect(html).toContain('<b>Permissões › Localização</b>');
    expect(html).toContain('<b>Permitir o tempo todo</b>');
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="[a-z]+">Abrir configurações</);
  });

  it('quadro 3 (uma negada): tela só com ela, o motivo vira a ação, "Negada" e o botão abre as configurações', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, camera: NEGADA });
    expect(html.match(/data-testid="permissao-[a-z]+"/g)).toEqual(['data-testid="permissao-camera"']);
    expect(html).toContain('Sem ela o app não funciona.');
    expect(html).toContain('Em Permissões › Câmera, marque Permitir.');
    expect(html).toMatch(/data-testid="permissao-camera-situacao"[^>]*>Negada</);
    expect(html).toContain('aria-label="Câmera. Em Permissões › Câmera, marque Permitir. Negada."');
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="[a-z]+">Abrir configurações</);
  });

  it('quadro 4 (Gestão): só notificações, "Sem ela"', async () => {
    const html = await render('Macuxi Gestão', { ...TUDO_CONCEDIDO, notificacoes: FALTA }, 'gestao');
    expect(html).toContain('Macuxi Gestão');
    expect(html).toContain('Sem ela o app não funciona.');
    expect(html).toContain('Pedidos para aprovar e recados.');
    expect(html).not.toContain('Câmera');
  });
});
