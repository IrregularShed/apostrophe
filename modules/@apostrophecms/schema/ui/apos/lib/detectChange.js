// Detect whether a document or document field has been changed,
// in a way that warrants confirmation before exiting a modal,
// or emitting an update event

import { isEqual } from 'lodash';

export function detectDocChange(schema, v1, v2) {
  return schema.some(field => {
    return detectFieldChange(field, v1[field.name], v2[field.name]);
  });
}

export function detectFieldChange(field, v1, v2) {
  v1 = relevant(v1);
  v2 = relevant(v2);
  if (isEqual(v1, v2)) {
    return false;
  } else if (!v1 && !v2) {
    return false;
  } else if (!v1 && Array.isArray(v2) && v2.length === 0) {
    return false;
  } else {
    return true;
  }
  function relevant(o) {
    if ((o != null) && ((typeof o) === 'object')) {
      const newObject = {};
      for (const [ key, val ] of Object.entries(o)) {
        if (key === '_docId') {
          newObject._docId = o._docId.replace(/:.*$/, '');
        } else if (key === '_id') {
          newObject._id = o._id;
        } else if (key.substring(0, 1) === '_') {
          // Different results for temporary properties
          // don't matter
          continue;
        } else {
          newObject[key] = relevant(val);
        }
      }
      return newObject;
    }
    return o;
  }
}
