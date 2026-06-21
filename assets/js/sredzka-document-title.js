/**
 * Utrzymuje document.title zgodny z atrybutem data-sredzka-title na <html>.
 * Chroni przed nadpisaniem przez skrypty zewnętrzne / heurystyki przeglądarki.
 */
(function () {
  "use strict";
  var protocol = window.location.protocol || "";
  var canonicalHost = "sredzka-korona.pl";
  var currentHost = window.location.hostname || "";

  if ((protocol === "http:" || protocol === "https:") && currentHost === "www." + canonicalHost) {
    window.location.replace(
      "https://" +
        canonicalHost +
        window.location.pathname +
        window.location.search +
        window.location.hash
    );
    return;
  }

  var currentPath = window.location.pathname || "";
  if ((protocol === "http:" || protocol === "https:") && /\/index\.html$/i.test(currentPath)) {
    window.location.replace(
      window.location.origin +
        currentPath.replace(/index\.html$/i, "") +
        window.location.search +
        window.location.hash
    );
    return;
  }

  var locked = document.documentElement.getAttribute("data-sredzka-title");
  if (!locked) return;

  function sync() {
    if (document.title !== locked) {
      document.title = locked;
    }
  }

  sync();

  var titleEl = document.querySelector("title");
  if (titleEl && typeof MutationObserver !== "undefined") {
    new MutationObserver(sync).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  window.addEventListener("load", sync);
  document.addEventListener("visibilitychange", sync);
})();

/**
 * Dev link loader overlay (1:1 behavior with ELMET):
 * - click on "Design & Development by i-JANICKI"
 * - show animated overlay
 * - redirect after 1000ms
 */
(function () {
  "use strict";

  var DEV_LINK_TARGET = "https://i-janicki.pl";
  var DEV_LINK_STYLE_ID = "dev-loader-overlay-style";
  var DEV_LINK_OVERLAY_ID = "dev-loader-overlay";
  var REDIRECT_DELAY_MS = 1000;

  function ensureStyle() {
    if (document.getElementById(DEV_LINK_STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = DEV_LINK_STYLE_ID;
    style.textContent = [
      "#" + DEV_LINK_OVERLAY_ID + " {",
      "  position:fixed; inset:0; z-index:99999;",
      "  display:none;",
      "  align-items:center; justify-content:center;",
      "  background:rgba(6,8,15,0.92);",
      "  backdrop-filter:blur(12px);",
      "  -webkit-backdrop-filter:blur(12px);",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + ".active { display:flex; }",
      "",
      "#" + DEV_LINK_OVERLAY_ID + " .loader {",
      "  position: absolute;",
      "  top: 50%;",
      "  margin-left: -50px;",
      "  left: 50%;",
      "  animation: speeder 0.4s linear infinite;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .loader > span {",
      "  height: 5px;",
      "  width: 35px;",
      "  background: #ff6b9d;",
      "  position: absolute;",
      "  top: -19px;",
      "  left: 60px;",
      "  border-radius: 2px 10px 1px 0;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .base span {",
      "  position: absolute;",
      "  width: 0;",
      "  height: 0;",
      "  border-top: 6px solid transparent;",
      "  border-right: 100px solid #ff6b9d;",
      "  border-bottom: 6px solid transparent;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .base span:before {",
      "  content: \"\";",
      "  height: 22px;",
      "  width: 22px;",
      "  border-radius: 50%;",
      "  background: #c44dff;",
      "  position: absolute;",
      "  right: -110px;",
      "  top: -16px;",
      "  box-shadow: 0 0 15px rgba(196,77,255,0.6);",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .base span:after {",
      "  content: \"\";",
      "  position: absolute;",
      "  width: 0;",
      "  height: 0;",
      "  border-top: 0 solid transparent;",
      "  border-right: 55px solid #4d9eff;",
      "  border-bottom: 16px solid transparent;",
      "  top: -16px;",
      "  right: -98px;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .face {",
      "  position: absolute;",
      "  height: 12px;",
      "  width: 20px;",
      "  background: #c44dff;",
      "  border-radius: 20px 20px 0 0;",
      "  transform: rotate(-40deg);",
      "  right: -125px;",
      "  top: -15px;",
      "  box-shadow: 0 0 10px rgba(196,77,255,0.4);",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .face:after {",
      "  content: \"\";",
      "  height: 12px;",
      "  width: 12px;",
      "  background: #4d9eff;",
      "  right: 4px;",
      "  top: 7px;",
      "  position: absolute;",
      "  transform: rotate(40deg);",
      "  transform-origin: 50% 50%;",
      "  border-radius: 0 0 0 2px;",
      "  box-shadow: 0 0 8px rgba(77,158,255,0.4);",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .loader > span > span:nth-child(1) {",
      "  width: 30px;",
      "  height: 1px;",
      "  background: #ff6b9d;",
      "  position: absolute;",
      "  animation: fazer1 0.2s linear infinite;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .loader > span > span:nth-child(2) {",
      "  width: 30px;",
      "  height: 1px;",
      "  background: #c44dff;",
      "  position: absolute;",
      "  top: 3px;",
      "  animation: fazer2 0.4s linear infinite;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .loader > span > span:nth-child(3) {",
      "  width: 30px;",
      "  height: 1px;",
      "  background: #4d9eff;",
      "  position: absolute;",
      "  top: 1px;",
      "  animation: fazer3 0.4s linear infinite;",
      "  animation-delay: -1s;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .loader > span > span:nth-child(4) {",
      "  width: 30px;",
      "  height: 1px;",
      "  background: #ff6b9d;",
      "  position: absolute;",
      "  top: 4px;",
      "  animation: fazer4 1s linear infinite;",
      "  animation-delay: -1s;",
      "}",
      "@keyframes fazer1 {",
      "  0% { left: 0; }",
      "  100% { left: -80px; opacity: 0; }",
      "}",
      "@keyframes fazer2 {",
      "  0% { left: 0; }",
      "  100% { left: -100px; opacity: 0; }",
      "}",
      "@keyframes fazer3 {",
      "  0% { left: 0; }",
      "  100% { left: -50px; opacity: 0; }",
      "}",
      "@keyframes fazer4 {",
      "  0% { left: 0; }",
      "  100% { left: -150px; opacity: 0; }",
      "}",
      "@keyframes speeder {",
      "  0%   { transform: translate(2px, 1px) rotate(0deg); }",
      "  10%  { transform: translate(-1px, -3px) rotate(-1deg); }",
      "  20%  { transform: translate(-2px, 0px) rotate(1deg); }",
      "  30%  { transform: translate(1px, 2px) rotate(0deg); }",
      "  40%  { transform: translate(1px, -1px) rotate(1deg); }",
      "  50%  { transform: translate(-1px, 3px) rotate(-1deg); }",
      "  60%  { transform: translate(-1px, 1px) rotate(0deg); }",
      "  70%  { transform: translate(3px, 1px) rotate(-1deg); }",
      "  80%  { transform: translate(-2px, -1px) rotate(1deg); }",
      "  90%  { transform: translate(2px, 1px) rotate(0deg); }",
      "  100% { transform: translate(1px, -2px) rotate(-1deg); }",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers {",
      "  position: absolute;",
      "  width: 100%;",
      "  height: 100%;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers span {",
      "  position: absolute;",
      "  height: 2px;",
      "  width: 20%;",
      "  opacity: 0.5;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers span:nth-child(1) {",
      "  top: 20%;",
      "  background: #ff6b9d;",
      "  animation: lf 0.6s linear infinite;",
      "  animation-delay: -5s;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers span:nth-child(2) {",
      "  top: 40%;",
      "  background: #c44dff;",
      "  animation: lf2 0.8s linear infinite;",
      "  animation-delay: -1s;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers span:nth-child(3) {",
      "  top: 60%;",
      "  background: #4d9eff;",
      "  animation: lf3 0.6s linear infinite;",
      "}",
      "#" + DEV_LINK_OVERLAY_ID + " .longfazers span:nth-child(4) {",
      "  top: 80%;",
      "  background: #ff6b9d;",
      "  animation: lf4 0.5s linear infinite;",
      "  animation-delay: -3s;",
      "}",
      "@keyframes lf {",
      "  0% { left: 200%; }",
      "  100% { left: -200%; opacity: 0; }",
      "}",
      "@keyframes lf2 {",
      "  0% { left: 200%; }",
      "  100% { left: -200%; opacity: 0; }",
      "}",
      "@keyframes lf3 {",
      "  0% { left: 200%; }",
      "  100% { left: -100%; opacity: 0; }",
      "}",
      "@keyframes lf4 {",
      "  0% { left: 200%; }",
      "  100% { left: -100%; opacity: 0; }",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    var existing = document.getElementById(DEV_LINK_OVERLAY_ID);
    if (existing) return existing;

    var wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div id="' +
      DEV_LINK_OVERLAY_ID +
      '">' +
      '  <div class="loader">' +
      "    <span><span></span><span></span><span></span><span></span></span>" +
      '    <div class="base">' +
      "      <span></span>" +
      '      <div class="face"></div>' +
      "    </div>" +
      "  </div>" +
      '  <div class="longfazers">' +
      "    <span></span><span></span><span></span><span></span>" +
      "  </div>" +
      "</div>";

    var overlay = wrapper.firstElementChild;
    if (!overlay) return null;
    document.body.appendChild(overlay);
    return overlay;
  }

  function isDevLink(link) {
    if (!link) return false;

    var href = (link.getAttribute("href") || "").trim();
    if (!href) return false;
    var normalizedHref = href.replace(/\/+$/, "");
    if (normalizedHref !== DEV_LINK_TARGET) return false;

    var text = (link.textContent || "").toLowerCase();
    return text.indexOf("design") !== -1 && text.indexOf("igor janicki") !== -1;
  }

  function initDevLinkLoader() {
    var links = Array.prototype.filter.call(document.querySelectorAll("a[href]"), isDevLink);
    if (!links.length) return;

    ensureStyle();
    var overlay = ensureOverlay();
    if (!overlay) return;

    function resetLoader() {
      overlay.classList.remove("active");
    }

    resetLoader();
    window.addEventListener("pageshow", resetLoader);

    links.forEach(function (link) {
      if (link.dataset.devLoaderBound === "1") return;
      link.dataset.devLoaderBound = "1";

      link.addEventListener("click", function (event) {
        event.preventDefault();
        overlay.classList.add("active");
        setTimeout(function () {
          window.location.href = DEV_LINK_TARGET;
        }, REDIRECT_DELAY_MS);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDevLinkLoader);
  } else {
    initDevLinkLoader();
  }
})();
