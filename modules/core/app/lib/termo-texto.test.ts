import { describe, expect, it } from 'vitest';
import { blocosDoTermo, partesComLinkDoTrajeto, partesDaLinha } from './termo-texto';

describe('RN-CORE-13: texto do termo de ciência na tela', () => {
  it('RN-CORE-13: parágrafos, itens de lista e negrito, sem cortar nada', () => {
    const b = blocosDoTermo('A empresa **Distribuidora Norte** registra a sua localização.\nNo expediente.\n\n- Só no expediente\n• Nunca em folga\n\nFim.');
    expect(b.map((x) => x.tipo)).toEqual(['paragrafo', 'item', 'item', 'paragrafo']);
    expect(b[0]!.partes).toEqual([
      { texto: 'A empresa ', negrito: false },
      { texto: 'Distribuidora Norte', negrito: true },
      { texto: ' registra a sua localização. No expediente.', negrito: false },
    ]);
    expect(b[1]!.partes).toEqual([{ texto: 'Só no expediente', negrito: false }]);
  });
  it('marcador de negrito sem par fica como texto; texto vazio não gera bloco', () => {
    expect(partesDaLinha('a ** b')).toEqual([{ texto: 'a ** b', negrito: false }]);
    expect(blocosDoTermo('  \n\n ')).toEqual([]);
  });
  it('"Meu trajeto" vira link no termo só leitura', () => {
    expect(partesComLinkDoTrajeto('Veja em Meu trajeto o seu dia.')).toEqual([
      { texto: 'Veja em ', link: false },
      { texto: 'Meu trajeto', link: true },
      { texto: ' o seu dia.', link: false },
    ]);
  });
});
