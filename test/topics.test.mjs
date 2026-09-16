import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

const timeline = () => readFileSync('dist/timeline/index.html', 'utf8');
const rowsFrom = html => [...html.matchAll(/<li class="entry" data-entry-slug="([^"]+)" data-entry-tags="([^"]+)"/g)]
  .map(([, slug, tags]) => ({slug, dataset: {entryTags: tags}, hidden: false}));

test('all 60 entries have topic clouds that agree with the timeline and its filter options', () => {
  const html = timeline();
  const rows = rowsFrom(html);
  assert.equal(rows.length, 60);
  const options = new Set([...html.matchAll(/<option value="([^"]+)" data-topic-label=/g)].map(m => m[1]));
  for (const row of rows) {
    const entry = readFileSync(`dist/entries/${row.slug}/index.html`, 'utf8');
    const cloud = entry.match(/<nav class="topic-cloud" aria-label="AI topics">([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(cloud, row.slug);
    const tags = [...cloud.matchAll(/href="\/timeline\/\?tag=([^"&]+)#topic-filter"/g)].map(m => m[1]);
    assert.deepEqual(tags, row.dataset.entryTags.split(' '), row.slug);
    assert.ok(tags.length >= 2 && new Set(tags).size === tags.length, row.slug);
    for (const tag of tags) assert.ok(options.has(tag), `${row.slug}: ${tag}`);
    assert.ok(entry.indexOf('class="topic-cloud"') < entry.indexOf('id="comments"'), row.slug);
    assert.ok(entry.indexOf('class="detail-pagination"') < entry.indexOf('id="comments"'), row.slug);
  }
  assert.equal(readdirSync('dist/entries').length, 60);
  assert.match(html, /<label for="topic-select">/);
  assert.match(html, /id="topic-results"[^>]*role="status"/);
  assert.match(html, /<script src="\/topics.js" defer><\/script>/);
});

function fixture(search = '') {
  const html = timeline();
  const element = extra => ({hidden: false, textContent: '', handlers: {}, addEventListener(type, fn) {this.handlers[type] = fn;}, ...extra});
  const select = element({value: '', options: [...html.matchAll(/<option value="([^"]*)"(?: data-topic-label="([^"]*)")?/g)]
    .map(([, value, label]) => ({value, dataset: {topicLabel: label}}))});
  const status = element(); const clear = element(); const form = element(); const empty = element();
  const groups = [...html.matchAll(/<section class="era-section" id="([^"]+)"[\s\S]*?<\/section>/g)].map(([source, id]) => {
    const count = element(); const rows = rowsFrom(source);
    return {id, rows, count, hidden: false, querySelector: () => count, querySelectorAll: () => rows};
  });
  const rows = groups.flatMap(group => group.rows);
  const nav = groups.map(group => ({dataset: {topicEra: group.id}, hidden: false}));
  const nodes = {'#topic-select': select, '#topic-results': status, '#topic-clear': clear, '#topic-filter-form': form, '#topic-empty': empty};
  const location = {href: `https://atlas.example/timeline/${search}`};
  const changes = [];
  const history = {pushState(_s, _t, url) {location.href = String(url); changes.push(String(url));}};
  const window = element();
  const document = {querySelector: selector => nodes[selector], querySelectorAll: selector => ({'[data-entry-tags]': rows, '.era-section': groups, '[data-topic-era]': nav}[selector])};
  runInNewContext(readFileSync('dist/topics.js', 'utf8'), {document, window, location, history, URL, Set, Map});
  return {rows, groups, nav, select, status, clear, form, empty, location, changes, window};
}

test('a bookmarked memory filter matches exact tags, counts results, and hides empty eras', () => {
  const f = fixture('?tag=memory#topic-filter');
  assert.equal(f.select.value, 'memory');
  const visible = f.rows.filter(row => !row.hidden);
  assert.ok(visible.some(row => row.slug === 'hebb'));
  assert.ok(visible.some(row => row.slug === 'lstm'));
  assert.ok(!visible.some(row => row.slug === 'alexnet'));
  for (const row of f.rows) assert.equal(!row.hidden, row.dataset.entryTags.split(' ').includes('memory'));
  assert.match(f.status.textContent, new RegExp(`^${visible.length} of 60 entries`));
  for (const group of f.groups) {
    const count = group.rows.filter(row => !row.hidden).length;
    assert.equal(group.hidden, count === 0);
    assert.equal(f.nav.find(item => item.dataset.topicEra === group.id).hidden, count === 0);
    assert.equal(group.count.textContent, `${count} ${count === 1 ? 'entry' : 'entries'}`);
  }
  assert.equal(f.changes.length, 0, 'initial rendering must not add browser history');
});

test('changing and clearing topics updates the URL, and browser Back restores the filter', () => {
  const f = fixture('?source=bookmark');
  f.select.value = 'reinforcement-learning'; f.select.handlers.change();
  assert.match(f.location.href, /source=bookmark/);
  assert.match(f.location.href, /tag=reinforcement-learning/);
  assert.ok(f.rows.filter(row => !row.hidden).some(row => row.slug === 'alphago'));
  f.clear.handlers.click();
  assert.equal(f.rows.filter(row => !row.hidden).length, 60);
  assert.equal(new URL(f.location.href).searchParams.has('tag'), false);
  f.location.href = 'https://atlas.example/timeline/?tag=recall#topic-filter';
  f.window.handlers.popstate();
  assert.equal(f.select.value, 'recall');
  assert.ok(f.rows.filter(row => !row.hidden).every(row => row.dataset.entryTags.split(' ').includes('recall')));
  let prevented = false; f.form.handlers.submit({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
});

test('unknown or hostile tag values safely show all entries and offer a reset', () => {
  const f = fixture('?tag=%3Cscript%3E');
  assert.equal(f.rows.filter(row => !row.hidden).length, 60);
  assert.match(f.status.textContent, /Unknown topic/);
  assert.doesNotMatch(f.status.textContent, /<script>/);
  assert.equal(f.clear.hidden, false);
  f.clear.handlers.click();
  assert.equal(new URL(f.location.href).searchParams.has('tag'), false);
  assert.equal(f.clear.hidden, true);
});

test('the deployed Worker artifact serves the filter script and bookmarked timeline routes', async () => {
  const asset = await worker.fetch(new Request('https://atlas.example/topics.js'), {});
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  const page = await worker.fetch(new Request('https://atlas.example/timeline/?tag=memory'), {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="topic-filter"/);
});
