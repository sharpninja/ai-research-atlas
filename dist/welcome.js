const oldSections = new Set(['foundations','representations','learning-at-scale','deep-learning','transformers','scale-and-generation','alignment-and-reasoning','foundation-models','methodology']);
if (oldSections.has(location.hash.slice(1))) location.replace('/timeline/' + location.hash);
