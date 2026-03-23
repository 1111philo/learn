import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const courseGroups = JSON.parse(readFileSync(resolve(root, 'data', 'courses.json'), 'utf8'));

// Flatten all playable units/courses
const allUnits = [];
for (const group of courseGroups) {
  if (group.units) {
    allUnits.push(...group.units);
  } else {
    allUnits.push(group);
  }
}

describe('courses.json', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(courseGroups));
    assert.ok(courseGroups.length > 0, 'No courses defined');
  });

  it('every course group has required fields', () => {
    for (const group of courseGroups) {
      assert.ok(group.courseId && typeof group.courseId === 'string',
        `Course group missing courseId: ${JSON.stringify(group)}`);
      assert.ok(group.name && typeof group.name === 'string',
        `Course group ${group.courseId} missing name`);
      assert.ok(group.description && typeof group.description === 'string',
        `Course group ${group.courseId} missing description`);
      // Must have either units or learningObjectives (standalone course)
      const hasUnits = Array.isArray(group.units) && group.units.length > 0;
      const hasObjectives = Array.isArray(group.learningObjectives) && group.learningObjectives.length > 0;
      assert.ok(hasUnits || hasObjectives,
        `Course group ${group.courseId} must have either units or learningObjectives`);
    }
  });

  it('every unit has required fields', () => {
    for (const unit of allUnits) {
      assert.ok(unit.courseId && typeof unit.courseId === 'string',
        `Unit missing courseId: ${JSON.stringify(unit)}`);
      assert.ok(unit.name && typeof unit.name === 'string',
        `Unit ${unit.courseId} missing name`);
      assert.ok(unit.description && typeof unit.description === 'string',
        `Unit ${unit.courseId} missing description`);
      assert.ok(Array.isArray(unit.learningObjectives) && unit.learningObjectives.length > 0,
        `Unit ${unit.courseId} must have at least one learning objective`);
      for (const obj of unit.learningObjectives) {
        assert.ok(typeof obj === 'string' && obj.length > 0,
          `Unit ${unit.courseId} has invalid learning objective`);
      }
    }
  });

  it('courseId values are unique across groups and units', () => {
    const ids = [
      ...courseGroups.map(g => g.courseId),
      ...allUnits.map(u => u.courseId)
    ];
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate courseIds: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  it('dependsOn references a valid unit courseId or is null', () => {
    const ids = new Set(allUnits.map(u => u.courseId));
    for (const unit of allUnits) {
      if (unit.dependsOn !== null && unit.dependsOn !== undefined) {
        assert.ok(ids.has(unit.dependsOn),
          `Unit ${unit.courseId} depends on unknown courseId: ${unit.dependsOn}`);
      }
    }
  });

  it('has no circular dependencies', () => {
    const depMap = Object.fromEntries(allUnits.map(u => [u.courseId, u.dependsOn]));
    for (const unit of allUnits) {
      const visited = new Set();
      let current = unit.courseId;
      while (current) {
        assert.ok(!visited.has(current),
          `Circular dependency detected involving ${current}`);
        visited.add(current);
        current = depMap[current];
      }
    }
  });
});
