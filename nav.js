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
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<path d="M12 7L6.5 15M12 7l5.5 8M7 17h10" stroke-linecap="round"/>' +
    '<circle cx="12" cy="5" r="2.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="18" r="2.2" fill="currentColor" stroke="none"/>' +
    '</svg>' +
    'MSMMK</a>';
  var linksHtml = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (here === l[0] ? ' class="active"' : '') + '>' + l[1] + '</a>';
  }).join('');
  nav.innerHTML = brand + linksHtml;
  document.body.insertBefore(nav, document.body.firstChild);
})();
