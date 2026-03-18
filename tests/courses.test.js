import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const courses = JSON.parse(readFileSync(resolve(root, 'data', 'courses.json'), 'utf8'));

describe('courses.json', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(courses));
    assert.ok(courses.length > 0, 'No courses defined');
  });

  it('every course has required fields', () => {
    for (const course of courses) {
      assert.ok(course.courseId && typeof course.courseId === 'string',
        `Course missing courseId: ${JSON.stringify(course)}`);
      assert.ok(course.name && typeof course.name === 'string',
        `Course ${course.courseId} missing name`);
      assert.ok(course.description && typeof course.description === 'string',
        `Course ${course.courseId} missing description`);
      assert.ok(Array.isArray(course.learningObjectives) && course.learningObjectives.length > 0,
        `Course ${course.courseId} must have at least one learning objective`);
      for (const obj of course.learningObjectives) {
        assert.ok(typeof obj === 'string' && obj.length > 0,
          `Course ${course.courseId} has invalid learning objective`);
      }
    }
  });

  it('courseId values are unique', () => {
    const ids = courses.map(c => c.courseId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate courseIds: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  it('dependsOn references a valid courseId or is null', () => {
    const ids = new Set(courses.map(c => c.courseId));
    for (const course of courses) {
      if (course.dependsOn !== null && course.dependsOn !== undefined) {
        assert.ok(ids.has(course.dependsOn),
          `Course ${course.courseId} depends on unknown courseId: ${course.dependsOn}`);
      }
    }
  });

  it('has no circular dependencies', () => {
    const depMap = Object.fromEntries(courses.map(c => [c.courseId, c.dependsOn]));
    for (const course of courses) {
      const visited = new Set();
      let current = course.courseId;
      while (current) {
        assert.ok(!visited.has(current),
          `Circular dependency detected involving ${current}`);
        visited.add(current);
        current = depMap[current];
      }
    }
  });
});
