(() => {
  const form = document.querySelector('#topic-filter-form');
  if (!form) return;
  const select = document.querySelector('#topic-select');
  const status = document.querySelector('#topic-results');
  const clear = document.querySelector('#topic-clear');
  const empty = document.querySelector('#topic-empty');
  const rows = [...document.querySelectorAll('[data-entry-tags]')];
  const groups = [...document.querySelectorAll('.era-section')];
  const navigation = [...document.querySelectorAll('[data-topic-era]')];
  const labels = new Map([...select.options].filter(option => option.value)
    .map(option => [option.value, option.dataset.topicLabel]));
  const memberships = new Map(rows.map(row => [row, new Set(row.dataset.entryTags.split(' '))]));

  function render() {
    const requested = new URL(location.href).searchParams.get('tag') || '';
    const unknown = !!requested && !labels.has(requested);
    const tag = unknown ? '' : requested;
    select.value = tag;
    let visible = 0;
    for (const row of rows) {
      row.hidden = !!tag && !memberships.get(row).has(tag);
      if (!row.hidden) visible++;
    }
    for (const group of groups) {
      const count = [...group.querySelectorAll('[data-entry-tags]')].filter(row => !row.hidden).length;
      group.hidden = count === 0;
      group.querySelector('.era-count').textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
      const link = navigation.find(item => item.dataset.topicEra === group.id);
      if (link) link.hidden = group.hidden;
    }
    status.textContent = unknown
      ? `Unknown topic. Showing all ${rows.length} entries.`
      : `${visible} of ${rows.length} entries${tag ? ' tagged ' + labels.get(tag) : ''}.`;
    clear.hidden = !requested;
    empty.hidden = visible > 0;
  }

  function choose(tag) {
    const url = new URL(location.href);
    if (tag) url.searchParams.set('tag', tag);
    else url.searchParams.delete('tag');
    url.hash = 'topic-filter';
    if (url.href !== location.href) history.pushState(null, '', url.href);
    render();
  }
  select.addEventListener('change', () => choose(select.value));
  form.addEventListener('submit', event => { event.preventDefault(); choose(select.value); });
  clear.addEventListener('click', () => choose(''));
  window.addEventListener('popstate', render);
  form.hidden = false;
  render();
})();
