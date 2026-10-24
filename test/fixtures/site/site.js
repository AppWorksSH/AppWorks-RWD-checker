document.addEventListener('DOMContentLoaded', function () {
  var burger = document.querySelector('.burger[data-works]');
  var nav = document.querySelector('header nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    });
  }
  var cookie = document.querySelector('.cookie');
  if (cookie && document.cookie.indexOf('consent=1') === -1) {
    cookie.hidden = false;
    cookie.querySelector('button').addEventListener('click', function () {
      document.cookie = 'consent=1; path=/';
      cookie.hidden = true;
    });
  }
});
