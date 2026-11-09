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
    inicio: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14c2 .8 3 2.8 3 6"/>',
    pedidos: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    mais: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    arquivo: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    enviar: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    menu: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
    caixa: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4"/><path d="M12 12v8"/>',
    seta: '<path d="M6 9l6 6 6-6"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  };
  document.querySelectorAll('i[data-i]').forEach((el) => {
    const nome = el.getAttribute('data-i');
    const t = el.getAttribute('data-t') || 18;
    const c = el.getAttribute('data-c') || 'currentColor';
    const w = el.getAttribute('data-w') || 2;
    el.outerHTML = `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block">${P[nome] || ''}</svg>`;
  });
})();
