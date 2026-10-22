// The Share button (Matt, 10/5/26): anyone texts the app to a new worker.
// What is shared is ALWAYS the one fixed address below, never location.href: a
// page's own address can carry a ?t= cache-buster, a file:// path on the laptop,
// or whatever odd link the sharer arrived by, and a saved QR once sent a worker
// somewhere that "kept bringing them to a development app". The path is
// Plow Command's own, /Plow/ (spec section 1), permanent like Shovel Command's /Sidewalk/
// (never rename or redirect it), so this text stays good.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowShare = factory();
})(this, function () {
  'use strict';

  var APP_URL = 'https://titanalaska.github.io/Plow/';

  // The link goes as the url, not inside the text: a share target that shows both
  // would otherwise print it twice.
  function message() {
    return 'Plow Command, the Titan plow truck app. Open this link on your phone, then Install it ' +
      '(or Add to Home screen). Pick your name and enter your PIN, or tap Type your name if you\'re new.';
  }

  // 'shared' (the share sheet took it), 'cancelled' (backed out of the sheet: not a
  // failure, so nothing is copied behind their back), 'copied' (no sheet, or it
  // refused: the text and link are on the clipboard), 'show' (nothing worked:
  // the page shows the link to copy by hand).
  function share(nav) {
    var n = nav || {};
    function copy() {
      if (!n.clipboard || typeof n.clipboard.writeText !== 'function') return Promise.resolve('show');
      return Promise.resolve().then(function () { return n.clipboard.writeText(message() + ' ' + APP_URL); })
        .then(function () { return 'copied'; }, function () { return 'show'; });
    }
    if (typeof n.share !== 'function') return copy();
    return Promise.resolve().then(function () { return n.share({ title: 'Plow Command', text: message(), url: APP_URL }); })
      .then(function () { return 'shared'; }, function (e) { return e && e.name === 'AbortError' ? 'cancelled' : copy(); });
  }

  return { APP_URL: APP_URL, message: message, share: share };
});
