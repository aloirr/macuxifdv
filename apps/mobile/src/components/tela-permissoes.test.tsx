/**
 * T-0145 — tela "Permissões" pela imagem aprovada (R-20261110-093125, `docs/design/telas/T-0145-permissoes.png`), renderizada
 * com `react-dom/server` e `react-native`/kit simulados:
 * - quadro 1 (Campo): 4 linhas com ícone, nome, motivo e situação; o link "Como usamos a localização"; botão "Permitir" sem ícone;
 * - quadro 2: cartão dos 2 passos ("Durante o uso" feito; passo 2 com os nomes do Android em negrito); botão com o ícone;
 * - quadro 3: negada, o motivo vira a ação e o botão "Abrir configurações";
 * - quadro 4 (Gestão): só notificações, sem o link da localização.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { telaDePermissoes, TUDO_CONCEDIDO, type EstadoPermissao, type EstadosPermissoes } from '@/lib/permissoes';

type Props = { children?: ReactNode; testID?: string; style?: unknown };
const host = (tag: string) =>
  function Host({ children, testID, style }: Props) {
    const forte = Array.isArray(style) ? false : (style as { fontFamily?: string } | null)?.fontFamily === 'forte';
    return createElement(forte ? 'b' : tag, testID ? { 'data-testid': testID } : {}, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  Pressable: host('button'),
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
  TOUCH: 48,
  Card: host('section'),
  Icon: ({ name }: { name: string }) => createElement('i', { 'data-icone': name }),
  Button: ({ label, testID, icon }: { label: string; testID: string; icon?: string }) =>
    createElement('button', { 'data-testid': testID, 'data-icone': icon ?? '' }, label),
  Folha: ({ visivel, titulo, children, testID }: { visivel: boolean; titulo: string; children: ReactNode; testID: string }) =>
    createElement('dialog', { 'data-testid': testID, 'data-visivel': String(visivel) }, titulo, children),
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
  it('quadro 1 (Campo, faltam 3): marca, título, subtítulo, 4 linhas com ícone e situação, link e "Permitir" sem ícone', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, localizacao: { duranteUso: FALTA, tempoTodo: FALTA }, camera: FALTA, galeria: FALTA });
    expect(html).toContain('Macuxi Campo');
    expect(html).toContain('Permissões');
    expect(html).toContain('Sem elas o app não funciona.');
    for (const nome of ['Notificações', 'Localização o tempo todo', 'Câmera', 'Fotos e galeria']) expect(html).toContain(nome);
    expect(html).toContain('Pedidos, aprovações e recados.');
    expect(html).toMatch(/data-icone="bell"/);
    expect(html).toMatch(/data-icone="pin"/);
    // a linha permitida leva o ✓ antes de "Permitida"
    expect(html).toMatch(/data-testid="permissao-notificacoes".*data-icone="check".*Permitida/);
    expect(html).toMatch(/data-testid="permissao-camera-situacao"[^>]*>Falta</);
    expect(html).toContain('data-testid="permissoes-como-usamos"');
    expect(html).toContain('Como usamos a localização');
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="">Permitir</);
    expect(html).not.toContain('data-testid="permissao-passos-localizacao"');
    // o aviso (folha) só abre pelo link
    expect(html).toMatch(/data-testid="permissoes-aviso-localizacao" data-visivel="false"/);
    expect(html).toContain('Fora do expediente, nada é registrado.');
  });

  it('quadro 2 (passo 2 de 2): cartão dos passos com os nomes do Android em negrito e "Abrir configurações" com ícone', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, localizacao: { duranteUso: OK, tempoTodo: FALTA } });
    expect(html).toContain('data-testid="permissao-passos-localizacao"');
    expect(html).toContain('Durante o uso');
    expect(html).toContain('<b>Permissões › Localização</b>');
    expect(html).toContain('<b>Permitir o tempo todo</b>');
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="[a-z]+">Abrir configurações</);
  });

  it('quadro 3 (negada duas vezes): motivo vira a ação, "Negada" e o botão abre as configurações', async () => {
    const html = await render('Macuxi Campo', { ...TUDO_CONCEDIDO, camera: NEGADA });
    expect(html).toContain('Em Permissões › Câmera, marque Permitir.');
    expect(html).toMatch(/data-testid="permissao-camera-situacao"[^>]*>Negada</);
    expect(html).toMatch(/data-testid="permissoes-botao" data-icone="[a-z]+">Abrir configurações</);
  });

  it('quadro 4 (Gestão): só notificações, "Sem ela", sem o link da localização', async () => {
    const html = await render('Macuxi Gestão', { ...TUDO_CONCEDIDO, notificacoes: FALTA }, 'gestao');
    expect(html).toContain('Macuxi Gestão');
    expect(html).toContain('Sem ela o app não funciona.');
    expect(html).toContain('Pedidos para aprovar e recados.');
    expect(html).not.toContain('Câmera');
    expect(html).not.toContain('Como usamos a localização');
    expect(html).not.toContain('permissoes-aviso-localizacao');
  });
});
