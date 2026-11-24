// شريط تنقل مشترك بين الصفحات، بهوية MSMMK البصرية. كل صفحة بتضيف سطر واحد: <script src="/nav.js"></script> قبل </body>
(function () {
  if (!document.querySelector('link[href="/theme.css"]')) {
    var themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.href = '/theme.css';
    document.head.appendChild(themeLink);
  }
  var links = [['/', 'الرئيسية (SEC)'], ['/california.html', 'شركات كاليفورنيا'], ['/farm.html', 'فرص الأرض الزراعية'], ['/claim.html', 'My Company']];
  var here = location.pathname.replace(/\/index\.html$/, '/');
  var nav = document.createElement('nav');
  nav.className = 'msmmk-nav';
  nav.setAttribute('aria-label', 'التنقل');
  var brand = '<a href="/" class="msmmk-brand">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="9" cy="9" r="6.5" fill="var(--msmmk-blue)" fill-opacity="0.82"/>' +
    '<circle cx="15" cy="9" r="6.5" fill="var(--msmmk-blue-dark)" fill-opacity="0.82"/>' +
    '<circle cx="12" cy="15" r="6.5" fill="var(--msmmk-blue-light)" fill-opacity="0.82"/>' +
    '</svg>' +
    'MSMMK</a>';
  var linksHtml = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (here === l[0] ? ' class="active"' : '') + '>' + l[1] + '</a>';
  }).join('');
  nav.innerHTML = brand + linksHtml;
  document.body.insertBefore(nav, document.body.firstChild);
})();
