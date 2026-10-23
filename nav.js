// شريط تنقل مشترك بين الصفحات. كل صفحة بتضيف سطر واحد: <script src="/nav.js"></script> قبل </body>
(function () {
  var links = [['/', 'الرئيسية (SEC)'], ['/california.html', 'شركات كاليفورنيا'], ['/farm.html', 'فرص الأرض الزراعية']];
  var here = location.pathname.replace(/\/index\.html$/, '/');
  var nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'التنقل');
  nav.style.cssText = 'display:flex;gap:20px;justify-content:center;padding:10px 12px;border-bottom:1px solid var(--line);font-size:14px;overflow-x:auto;white-space:nowrap';
  nav.innerHTML = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (here === l[0] ? ' style="font-weight:700;color:var(--text)"' : '') + '>' + l[1] + '</a>';
  }).join('');
  document.body.insertBefore(nav, document.body.firstChild);
})();
