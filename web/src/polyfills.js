// Small polyfills for older Android TV WebViews (Chrome 53+).
(function () {
  function mix(proto) {
    if (!proto.append) {
      proto.append = function () {
        for (var i = 0; i < arguments.length; i++) {
          var n = arguments[i];
          this.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
        }
      };
    }
    if (!proto.prepend) {
      proto.prepend = function () {
        var f = document.createDocumentFragment();
        for (var i = 0; i < arguments.length; i++) {
          var n = arguments[i];
          f.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
        }
        this.insertBefore(f, this.firstChild);
      };
    }
  }
  mix(Element.prototype);
  mix(Document.prototype);
  mix(DocumentFragment.prototype);
  if (window.NodeList && !NodeList.prototype.forEach) NodeList.prototype.forEach = Array.prototype.forEach;
  if (!window.requestIdleCallback) window.requestIdleCallback = function (fn) { return setTimeout(fn, 50); };
})();
