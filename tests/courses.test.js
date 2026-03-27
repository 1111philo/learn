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
      assert.ok(unit.unitId && typeof unit.unitId === 'string',
        `Unit missing unitId: ${JSON.stringify(unit)}`);
      assert.ok(unit.name && typeof unit.name === 'string',
        `Unit ${unit.unitId} missing name`);
      assert.ok(unit.description && typeof unit.description === 'string',
        `Unit ${unit.unitId} missing description`);
      assert.ok(Array.isArray(unit.learningObjectives) && unit.learningObjectives.length > 0,
        `Unit ${unit.unitId} must have at least one learning objective`);
      for (const obj of unit.learningObjectives) {
        assert.ok(typeof obj === 'string' && obj.length > 0,
          `Unit ${unit.unitId} has invalid learning objective`);
      }
      // format must be "text" or "screenshot"
      assert.ok(unit.format === 'text' || unit.format === 'screenshot',
        `Unit ${unit.unitId} format must be "text" or "screenshot", got: ${unit.format}`);
      // exemplar must be a non-empty string
      assert.ok(unit.exemplar && typeof unit.exemplar === 'string',
        `Unit ${unit.unitId} missing exemplar`);
    }
  });

  it('courseId and unitId values are unique across groups and units', () => {
    const ids = [
      ...courseGroups.map(g => g.courseId),
      ...allUnits.map(u => u.unitId)
    ];
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  it('dependsOn references a valid unit unitId or is null', () => {
    const ids = new Set(allUnits.map(u => u.unitId));
    for (const unit of allUnits) {
      if (unit.dependsOn !== null && unit.dependsOn !== undefined) {
        assert.ok(ids.has(unit.dependsOn),
          `Unit ${unit.unitId} depends on unknown unitId: ${unit.dependsOn}`);
      }
    }
  });

  it('has no circular dependencies', () => {
    const depMap = Object.fromEntries(allUnits.map(u => [u.unitId, u.dependsOn]));
    for (const unit of allUnits) {
      const visited = new Set();
      let current = unit.unitId;
      while (current) {
        assert.ok(!visited.has(current),
          `Circular dependency detected involving ${current}`);
        visited.add(current);
        current = depMap[current];
      }
    }
  });
});
