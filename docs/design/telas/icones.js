// Ícones de linha (traço 2) usados nas telas de aprovação; mesmos nomes do `Icon` do kit.
(function () {
  const P = {
    chevron: '<path d="M9 6l6 6-6 6"/>',
    voltar: '<path d="M15 6l-6 6 6 6"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5-2.7"/><path d="M14.5 10.4A10 10 0 0 1 19 12.9"/><path d="M2 9a15 15 0 0 1 4.2-2.6"/><path d="M11 5.1A15 15 0 0 1 22 9"/><circle cx="12" cy="20" r=".8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    filtro: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alerta: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6"/>',
    // barra de abas: os mesmos traços do `Icon` do kit (home, pin, users, clipboard, target, menu), como o shell monta
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    rota: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    linhas: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    arquivo: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    enviar: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    menu: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
    // pacote: o mesmo desenho do `pacote` do kit (packages/ui/src/mobile/icon.tsx), estoque por filial (R-20261115-084600)
    pacote: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5"/><path d="M12 12v9"/><path d="M8 5.25l8 4.5"/>',
    caixa: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4"/><path d="M12 12v8"/>',
    seta: '<path d="M6 9l6 6 6-6"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    // 10/11 (T-0145, T-0147, T-0148)
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    galeria: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
    sino: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    cadeado: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    fone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    chat: '<path d="M4 19l1.4-4A8 8 0 1 1 9 18.6z"/>',
    navegar: '<path d="M3 11l18-8-8 18-2-8z"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    nuvem: '<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4.8 4.8 0 0 1-.5 9.5z"/>',
    // 10/11 (T-0158)
    sair: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
    bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M4 12h3M17 12h3M5 18l2.5-1.5M19 18l-2.5-1.5M5 6l2.5 2M19 6l-2.5 2M9 7a3 3 0 0 1 6 0"/>',
    abrir: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  // Barra de abas do Campo (vendedor): 6 abas, Início · Rota · Clientes · Pedidos · Performance · Mais (apps/mobile lib/abas.ts,
  // MAX_ABAS_POR_VARIANTE.campo = 6 desde a T-0170; ordem das páginas: Rota 20, Clientes 30, Pedidos 40, Performance 50;
  // a Performance fica na barra, R-20261115-084500). Uso: <div class="barra-abas" data-ativa="pedidos"></div>.
  const ABAS = [['inicio', 'home', 'Início'], ['rota', 'rota', 'Rota'], ['clientes', 'users', 'Clientes'], ['pedidos', 'clipboard', 'Pedidos'], ['performance', 'alvo', 'Performance'], ['mais', 'linhas', 'Mais']];
  document.querySelectorAll('.barra-abas[data-ativa]').forEach((el) => {
    const ativa = el.getAttribute('data-ativa');
    el.innerHTML = ABAS.map(([id, ic, rot]) => {
      const on = id === ativa;
      return `<div${on ? ' class="ativa"' : ''}><i data-i="${ic}" data-t="22" data-w="${on ? 2.2 : 1.8}"></i>${rot}</div>`;
    }).join('');
  });
  document.querySelectorAll('i[data-i]').forEach((el) => {
    const nome = el.getAttribute('data-i');
    const t = el.getAttribute('data-t') || 18;
    const c = el.getAttribute('data-c') || 'currentColor';
    const w = el.getAttribute('data-w') || 2;
    el.outerHTML = `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block">${P[nome] || ''}</svg>`;
  });
})();
