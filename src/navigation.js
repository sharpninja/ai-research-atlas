const returnToTop = document.querySelector('.return-to-top');
if (returnToTop) {
  const updateVisibility = () => { returnToTop.hidden = window.scrollY <= 1; };
  updateVisibility();
  window.addEventListener('scroll', updateVisibility, {passive: true});
  window.addEventListener('pageshow', updateVisibility);
}
