// Dublê genérico dos módulos nativos (expo-*, sensores, câmera...): qualquer propriedade é uma função vazia que também serve de componente.
function fazer(nome) {
  const f = function () { return null; };
  return new Proxy(f, {
    get(alvo, p) {
      if (p === '__esModule') return true;
      if (p === 'default') return fazer(nome + '.default');
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'prototype') return alvo.prototype;
      return fazer(nome + '.' + String(p));
    },
    apply() { return undefined; },
    construct() { return {}; },
  });
}
module.exports = fazer('nativo');
