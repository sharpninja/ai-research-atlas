import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const pages = new Map(readdirSync('dist/entries').map(slug => [slug, readFileSync(`dist/entries/${slug}/index.html`, 'utf8')]));
const bibliography = JSON.parse(readFileSync('bibliography-index.json', 'utf8').replace(/^\uFEFF/, ''));
const graph = JSON.parse(readFileSync('citation-links.json', 'utf8').replace(/^\uFEFF/, ''));
function section(slug, id) {
  const html = pages.get(slug);
  const found = html.match(new RegExp(`<section[^>]*aria-labelledby="${id}-title"[^>]*>([\\s\\S]*?)<\\/section>`));
  assert.ok(found, `${slug}: missing ${id} section`);
  return found[1];
}
function targets(slug, id) {
  return [...section(slug, id).matchAll(/href="\/entries\/([^/]+)\/"/g)].map(match => match[1]);
}

// Verified relationships from the memory and reasoning source audits.
const expected = new Map(Object.entries({
  perceptron: ['hebb'],
  hopfield: ['hebb', 'temporal-recall', 'persistent-neural-states', 'associative-memory', 'content-addressable-memories'],
  shrdlu: ['sir', 'student', 'resolution', 'semantic-memory', 'theorem-proving-question-answering', 'relational-long-term-memory', 'teachable-language-comprehender', 'qa3', 'planner', 'carps', 'samenlaq-ii'],
  lstm: ['dynamic-error-propagation', 'finding-structure-in-time', 'finite-state-recurrent-networks', 'focused-backpropagation', 'real-time-recurrent-sequences'],
  word2vec: ['finding-structure-in-time'],
  llama: ['finding-structure-in-time']
}));

test('every entry has clearly labeled Cited By and Citations sections before navigation and comments', () => {
  assert.equal(pages.size, 67);
  for (const [slug, html] of pages) {
    for (const [id, heading] of [['cited-by', 'Cited By'], ['citations', 'Citations']]) {
      assert.match(section(slug, id), new RegExp(`<h2 id="${id}-title">${heading}<\\/h2>`));
      assert.equal([...html.matchAll(new RegExp(`id="${id}-title"`, 'g'))].length, 1, slug);
      assert.ok(html.indexOf(`id="${id}-title"`) < html.indexOf('class="detail-pagination"'), slug);
      assert.ok(html.indexOf(`id="${id}-title"`) < html.indexOf('id="comments"'), slug);
    }
  }
});

test('all reviewed relationships appear in both directions and preserve the original 24 links', () => {
  let forward = 0; let reverse = 0;
  for (const slug of pages.keys()) {
    const citations = targets(slug, 'citations');
    const citedBy = targets(slug, 'cited-by');
    const expectedCitations = graph.Links.filter(link => link.Citing === slug).map(link => link.Cited);
    assert.deepEqual([...citations].sort(), expectedCitations.sort(), `${slug}: citations`);
    for (const cited of expected.get(slug) ?? []) assert.ok(citations.includes(cited), `${slug}: lost prior citation ${cited}`);
    const expectedCiting = graph.Links.filter(link => link.Cited === slug).map(link => link.Citing);
    assert.deepEqual([...citedBy].sort(), expectedCiting.sort(), `${slug}: cited by`);
    assert.equal(new Set(citations).size, citations.length, slug);
    assert.equal(new Set(citedBy).size, citedBy.length, slug);
    assert.ok(!citations.includes(slug) && !citedBy.includes(slug), `${slug}: self link`);
    forward += citations.length; reverse += citedBy.length;
  }
  assert.equal(forward, 148); assert.equal(reverse, forward);
  assert.ok(targets('student', 'citations').includes('sir'));
  assert.ok(targets('finite-state-recurrent-networks', 'citations').includes('backpropagation'));
  for (const slug of ['lisp', 'sir', 'theorem-proving-question-answering']) {
    assert.ok(!targets(slug, 'citations').includes('logic-theory-machine'), 'Do not conflate distinct 1957 papers with the 1956 report');
  }
  assert.ok(!targets('dynamic-error-propagation', 'citations').includes('backpropagation'), 'The PDP chapter is not the Nature paper');
});

test('empty citation sections describe recording coverage and both directions retain evidence and version notes', () => {
  assert.match(section('deepseek-r1', 'citations'), /No references to other Atlas entries have been recorded/);
  assert.match(section('deepseek-r1', 'cited-by'), /No Atlas entries are currently recorded as citing/);
  for (const [slug, direction] of [['shrdlu', 'citations'], ['resolution', 'cited-by']]) {
    const content = section(slug, direction);
    assert.match(content, /Reference 47 names this paper, but its issue and page details conflict with the original article/);
    assert.match(content, /href="https:\/\/dspace.mit.edu\/server\/api\/core\/bitstreams\/bd092d44-1552-4417-a19e-a4704c94d3ff\/content"/);
  }
  assert.match(section('word2vec', 'citations'), /later 1990 journal version/);
  assert.match(section('finding-structure-in-time', 'cited-by'), /later 1990 journal version/);
});

test('all 67 works have explicit bibliography coverage, source provenance and reviewed citation evidence', () => {
  assert.deepEqual(bibliography.Entries.map(entry => entry.Slug).sort(), [...pages.keys()].sort());
  assert.equal(new Set(bibliography.Entries.map(entry => entry.Slug)).size, 67);
  const counts = {};
  for (const entry of bibliography.Entries) {
    counts[entry.Status] = (counts[entry.Status] ?? 0) + 1;
    assert.match(entry.SourceUrl, /^https:\/\//, entry.Slug);
    assert.ok(entry.Notes.length, entry.Slug);
    if (['indexed', 'partial'].includes(entry.Status)) assert.ok(entry.Sections.some(section => section.Text.trim()), entry.Slug);
    assert.match(section(entry.Slug, 'citations'), /Bibliography coverage/);
  }
  assert.deepEqual(counts, {indexed: 54, unavailable: 7, partial: 5, 'no-formal-bibliography': 1});
  for (const [slug, pageCount] of [['student', 4], ['focused-backpropagation', 2], ['shrdlu', 5]]) {
    const entry = bibliography.Entries.find(entry => entry.Slug === slug);
    assert.equal(entry.OcrPages.length, pageCount);
    for (const page of entry.OcrPages) {
      assert.equal(page.Receipt.Engine, 'Windows.Media.Ocr');
      assert.match(page.Receipt.TextSha256, /^[A-F0-9]{64}$/);
      assert.ok(page.Text.length > 50);
    }
  }
  assert.equal(bibliography.Entries.find(entry => entry.Slug === 'logic-theory-machine').OcrPageCount, 64);
  const pairs = new Set();
  for (const link of graph.Links) {
    assert.ok(pages.has(link.Citing) && pages.has(link.Cited));
    assert.notEqual(link.Citing, link.Cited);
    assert.ok(link.Evidence && link.Note && link.Verification);
    assert.match(link.SourceUrl, /^https:\/\//);
    assert.ok(!pairs.has(`${link.Citing}|${link.Cited}`)); pairs.add(`${link.Citing}|${link.Cited}`);
  }
});

test('published bibliography and citation data match the reviewed sources', () => {
  assert.deepEqual(JSON.parse(readFileSync('dist/bibliography-index.json', 'utf8').replace(/^\uFEFF/, '')), bibliography);
  assert.deepEqual(JSON.parse(readFileSync('dist/citation-links.json', 'utf8').replace(/^\uFEFF/, '')), graph);
});
