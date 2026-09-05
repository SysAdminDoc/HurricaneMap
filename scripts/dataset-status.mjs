export const DATASET_STATUS_VALUES = Object.freeze(['active', 'closed', 'deprecated']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDatasetStatuses(datasets, knownPaths = new Set()) {
  const errors = [];
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return ['metadata.datasets must contain at least one dataset status entry.'];
  }
  const ids = new Set();
  const paths = new Set();
  for (const [index, dataset] of datasets.entries()) {
    const label = `metadata.datasets[${index}]`;
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof dataset.id !== 'string' || !dataset.id) errors.push(`${label}.id is required.`);
    if (ids.has(dataset.id)) errors.push(`${label}.id is duplicated.`);
    ids.add(dataset.id);
    if (typeof dataset.label !== 'string' || !dataset.label) errors.push(`${label}.label is required.`);
    if (!Array.isArray(dataset.paths) || dataset.paths.length === 0) {
      errors.push(`${label}.paths must contain at least one data/ path.`);
    } else {
      for (const relative of dataset.paths) {
        if (typeof relative !== 'string' || !relative.startsWith('data/')) {
          errors.push(`${label}.paths must contain only data/ paths.`);
          continue;
        }
        if (paths.has(relative)) errors.push(`${label}.paths contains a duplicate path: ${relative}.`);
        paths.add(relative);
        if (knownPaths.size && !knownPaths.has(relative)) errors.push(`${label}.paths references missing file ${relative}.`);
      }
    }
    if (!DATASET_STATUS_VALUES.includes(dataset.status)) {
      errors.push(`${label}.status must be active, closed, or deprecated.`);
    }
    if (dataset.end_date !== null && (typeof dataset.end_date !== 'string' || !ISO_DATE.test(dataset.end_date))) {
      errors.push(`${label}.end_date must be an ISO date or null.`);
    }
    const citation = dataset.retirement_citation;
    if (citation !== null && (!citation || typeof citation !== 'object' || Array.isArray(citation))) {
      errors.push(`${label}.retirement_citation must be an object or null.`);
    } else if (citation) {
      if (typeof citation.title !== 'string' || !citation.title) errors.push(`${label}.retirement_citation.title is required.`);
      if (typeof citation.date !== 'string' || !ISO_DATE.test(citation.date)) errors.push(`${label}.retirement_citation.date must be an ISO date.`);
      if (typeof citation.url !== 'string' || !/^https:\/\//.test(citation.url)) errors.push(`${label}.retirement_citation.url must be HTTPS.`);
      // Optional, but if a retired series names where the work continued, that
      // pointer has to be as complete as the retirement notice itself.
      const successor = citation.successor;
      if (successor !== undefined && successor !== null) {
        const successorLabel = `${label}.retirement_citation.successor`;
        if (typeof successor !== 'object' || Array.isArray(successor)) {
          errors.push(`${successorLabel} must be an object or null.`);
        } else {
          if (typeof successor.title !== 'string' || !successor.title) errors.push(`${successorLabel}.title is required.`);
          if (typeof successor.date !== 'string' || !ISO_DATE.test(successor.date)) errors.push(`${successorLabel}.date must be an ISO date.`);
          if (typeof successor.url !== 'string' || !/^https:\/\//.test(successor.url)) errors.push(`${successorLabel}.url must be HTTPS.`);
        }
      }
    }
    if ((dataset.status === 'closed' || dataset.status === 'deprecated') && (!dataset.end_date || !citation)) {
      errors.push(`${label} must include end_date and retirement_citation when status is ${dataset.status}.`);
    }
    if (dataset.status === 'active' && citation !== null) {
      errors.push(`${label}.retirement_citation must be null while status is active.`);
    }
  }
  if (knownPaths.size) {
    for (const relative of knownPaths) {
      if (!paths.has(relative)) errors.push(`bundled data file ${relative} has no dataset status entry.`);
    }
  }
  return errors;
}

export function validateClosedSeriesRows(dataset, rows, {
  dateFields = ['begin', 'end'],
  idLabel = 'row',
} = {}) {
  if (dataset?.status !== 'closed') return [];
  const endDate = dataset.end_date;
  if (!ISO_DATE.test(endDate || '')) return [`${dataset?.id || 'dataset'} has no valid closed-series end_date.`];
  const errors = [];
  for (const [index, row] of Object.entries(rows || {})) {
    if (!row || typeof row !== 'object') continue;
    for (const field of dateFields) {
      const value = row[field];
      if (typeof value === 'string' && ISO_DATE.test(value) && value > endDate) {
        errors.push(`${idLabel} ${index} has ${field} ${value} after closed series end_date ${endDate}.`);
      }
    }
  }
  return errors;
}
