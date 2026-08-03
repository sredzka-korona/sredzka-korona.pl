(function canonicalizeIndexUrl() {
  var indexSuffix = "/index.html";
  var pathname = window.location.pathname;

  if (!pathname.endsWith(indexSuffix)) {
    return;
  }

  var canonicalPath = pathname.slice(0, -"index.html".length) || "/";
  window.location.replace(canonicalPath + window.location.search + window.location.hash);
})();
