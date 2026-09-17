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
  assert.equal(forward, 159); assert.equal(reverse, forward);
  assert.ok(targets('student', 'citations').includes('sir'));
  assert.ok(targets('finite-state-recurrent-networks', 'citations').includes('backpropagation'));
  assert.ok(!targets('dynamic-error-propagation', 'citations').includes('backpropagation'), 'The PDP chapter is not the Nature paper');
});

test('Logic Theory Machine connections identify the related 1957 papers in both directions', () => {
  const slugs = ['lisp', 'sir', 'theorem-proving-question-answering'];
  assert.deepEqual(targets('logic-theory-machine', 'cited-by').sort(), [...slugs].sort());
  const incoming = section('logic-theory-machine', 'cited-by');
  assert.match(incoming, /1957/);
  assert.match(incoming, /not direct citations to the 1956 report/);
  for (const slug of slugs) {
    assert.ok(targets(slug, 'citations').includes('logic-theory-machine'), slug);
    const link = graph.Links.find(edge => edge.Citing === slug && edge.Cited === 'logic-theory-machine');
    assert.equal(link.Relationship, 'related-system-publication', slug);
    assert.equal(link.CitedPublication.Year, 1957, slug);
    assert.match(link.CitedPublication.Title, /logic theory machine/i, slug);
    assert.match(link.Note, /1956/);
    assert.match(link.SourceUrl, /#page=\d+$/);
    const outgoing = section(slug, 'citations');
    for (const content of [incoming, outgoing]) {
      assert.match(content, /Related paper about this system/);
      assert.ok(content.includes(link.SourceUrl), `${slug}: missing evidence link`);
    }
  }
  assert.equal(graph.Links.filter(edge => edge.Relationship === 'related-system-publication').length, 3);
  assert.equal(graph.Links.filter(edge => edge.Relationship !== 'related-system-publication').length, 156);
  assert.match(pages.get('logic-theory-machine'), /RAND report P-868/);
  assert.match(pages.get('logic-theory-machine'), /12 July 1956/);
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
  assert.deepEqual(counts, {indexed: 65, partial: 1, unavailable: 1});
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

test('recovered bibliographies retain complete page boundaries, OCR receipts and edition provenance', () => {
  const bySlug = new Map(bibliography.Entries.map(entry => [entry.Slug, entry]));
  for (const slug of ['hebb', 'logic-theory-machine', 'semantic-memory', 'temporal-recall', 'perceptrons', 'teachable-language-comprehender', 'persistent-neural-states', 'associative-memory', 'content-addressable-memories', 'finding-structure-in-time', 'the-ai-toy']) {
    assert.equal(bySlug.get(slug).Status, 'indexed', slug);
  }
  for (const [slug, first, last] of [['hebb', 328, 342], ['semantic-memory', 175, 184], ['finding-structure-in-time', 31, 33]]) {
    const entry = bySlug.get(slug);
    assert.deepEqual(entry.OcrPages.map(page => page.PdfPage), Array.from({length: last - first + 1}, (_, i) => first + i));
    for (const page of entry.OcrPages) {
      assert.equal(page.Receipt.Engine, 'Windows.Media.Ocr');
      assert.match(page.Receipt.ImageSha256, /^[A-F0-9]{64}$/);
      assert.match(page.Receipt.TextSha256, /^[A-F0-9]{64}$/);
      assert.ok(page.Text.trim(), `${slug}: page ${page.PdfPage}`);
    }
  }
  assert.match(bySlug.get('hebb').Sections[0].Text, /Adams/);
  assert.match(bySlug.get('hebb').Sections[0].Text, /Zolling/);
  assert.match(bySlug.get('semantic-memory').Sections[0].Text, /Banerji/);
  assert.match(bySlug.get('semantic-memory').Sections[0].Text, /Comit Programmer/);
  assert.match(bySlug.get('associative-memory').Sections[0].Text, /147/);
  assert.match(bySlug.get('content-addressable-memories').Sections[0].Text, /6\.261/);
  assert.equal(bySlug.get('teachable-language-comprehender').ReferenceCount, 22);
  assert.equal(bySlug.get('temporal-recall').ReferenceCount, 4);
  assert.equal(bySlug.get('persistent-neural-states').ReferenceCount, 12);
  assert.match(bySlug.get('finding-structure-in-time').BibliographyEdition, /1990/);
  assert.match(bySlug.get('perceptrons').BibliographyEdition, /1988.*1972/);
  assert.match(bySlug.get('the-ai-toy').Sections[0].Text, /Wasserman/);
  assert.ok(!targets('the-ai-toy', 'citations').includes('backpropagation'), 'PDP books are distinct from the Nature paper');
  assert.ok(!targets('perceptrons', 'citations').includes('perceptron'), 'Rosenblatt 1959 and 1962 are distinct from his 1958 paper');
});
