/**
 * Course loading, flattening, and prerequisite checking.
 */

let coursesCache = null;

export async function loadCourses() {
  if (coursesCache) return coursesCache;
  const resp = await fetch(chrome.runtime.getURL('data/courses.json'));
  coursesCache = await resp.json();
  return coursesCache;
}

/**
 * Flatten course groups into a flat array of all playable courses (units).
 * Standalone courses (no units array) are included directly.
 * Units within course groups are extracted and included.
 */
export function flattenCourses(courseGroups) {
  const result = [];
  for (const group of courseGroups) {
    if (group.units) {
      result.push(...group.units);
    } else {
      result.push(group);
    }
  }
  return result;
}

export function checkPrerequisite(unit, allProgress) {
  if (!unit.dependsOn) return true;
  const dep = allProgress[unit.dependsOn];
  return dep && dep.status === 'completed';
}
