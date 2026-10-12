// Проверка обновлений через релизы GitHub
window.UPD = (function () {
  const U = { latest: null };

  // vДДММГГ.НОМЕР → [ГГММДД, НОМЕР]
  function parse(tag) {
    const m = /^v?(\d{2})(\d{2})(\d{2})\.(\d+)$/.exec(String(tag || '').trim());
    if (!m) return null;
    return [+(m[3] + m[2] + m[1]), +m[4]];
  }
  U.isNewer = function (remote, local) {
    const a = parse(remote), b = parse(local);
    if (!a || !b) return false;
    return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
  };

  U.check = async function () {
    try {
      const r = await fetch(`https://api.github.com/repos/${window.GAME_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return null;
      const rel = await r.json();
      const asset = (rel.assets || []).find(a => /\.zip$/i.test(a.name));
      U.latest = {
        tag: rel.tag_name, name: rel.name || rel.tag_name, notes: rel.body || '',
        url: asset ? asset.browser_download_url : rel.html_url, page: rel.html_url,
        newer: U.isNewer(rel.tag_name, window.GAME_VERSION),
      };
      return U.latest;
    } catch (e) { return null; }
  };

  U.open = function (url) {
    if (window.desktop && window.desktop.openExternal) window.desktop.openExternal(url);
    else window.open(url, '_blank');
  };
  return U;
})();
