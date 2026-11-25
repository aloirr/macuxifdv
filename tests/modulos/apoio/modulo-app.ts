/**
 * Leitura do `app/index.ts` de um módulo como texto (o app importa React Native e não roda no Node): páginas e extensões
 * declaradas no fonte. Uma leitura, um lugar: promotor-sem-pedido.test.ts e catalogo-no-pedido-r20261124.test.ts importam daqui.
 */
export interface ItemLido {
  tipo: 'pagina' | 'extensao';
  id: string;
  slot?: string;
  caminho?: string;
  navegacao?: string;
  acao?: string;
  apps?: string[];
  /** T-0077: a página declara `perfis: PERFIS_PAGINAS` (= `manifest.perfis` do Vendedor, sem promotor). */
  perfisDoManifesto?: boolean;
  /** R-20261124-110151: `payload.onde` da ação de produto (`pedido` = Catálogo aberto do Novo pedido; `consulta` = Catálogo da aba) */
  onde?: 'pedido' | 'consulta';
}

/** Páginas (`{ id, caminho, ... }` numa linha) e extensões (`slot: ...` até o próximo `slot:`) declaradas no fonte. */
export function lerModuloApp(fonte: string): ItemLido[] {
  const itens: ItemLido[] = [];
  const paginas = fonte.slice(fonte.indexOf('paginas:'), fonte.indexOf('entidadesSync:'));
  for (const linha of paginas.split('\n')) {
    const id = /\bid: '([^']+)'/.exec(linha)?.[1];
    if (!id) continue;
    itens.push({
      tipo: 'pagina',
      id,
      caminho: /caminho: '([^']+)'/.exec(linha)?.[1],
      navegacao: /navegacao: '([^']+)'/.exec(linha)?.[1],
      acao: /\bacao: '([^']+)'/.exec(linha)?.[1],
      apps: /apps: \[([^\]]*)\]/.exec(linha)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)),
      perfisDoManifesto: /perfis: PERFIS_PAGINAS\b/.test(linha),
    });
  }
  const ext = fonte.slice(fonte.indexOf('extensoes:'));
  for (const bloco of ext.split(/slot: /).slice(1)) {
    itens.push({
      tipo: 'extensao',
      slot: /^'([^']+)'/.exec(bloco)?.[1],
      id: /\bid: '([^']+)'/.exec(bloco)?.[1] ?? '?',
      acao: /\bacao: '([^']+)'/.exec(bloco)?.[1],
      // T-0052: o `apps` da extensão entra no shell (o "Adicionar ao pedido" é só do Campo)
      apps: /\bapps: \[([^\]]*)\]/.exec(bloco)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)),
      // R-20261124-110151 (RN-VEN-49): em que tela do Catálogo a ação aparece (`AcaoProduto.onde`, filtro `acoesDaTela`)
      onde: /\bonde: '(pedido|consulta)'/.exec(bloco)?.[1] as ItemLido['onde'],
    });
  }
  return itens;
}
