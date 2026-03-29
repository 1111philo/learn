import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSafety,
  validateActivity,
  validateAssessment,
  validateCourseKB,
} from '../js/validators.js';

// -- Helpers ------------------------------------------------------------------

function validActivity(overrides = {}) {
  return {
    instruction: '1. Write a short paragraph about your goals\n2. Hit Capture to capture your screen.',
    tips: ['Be specific', 'Keep it brief'],
    ...overrides,
  };
}

function validAssessment(overrides = {}) {
  return {
    achieved: false,
    demonstrates: 'Shows understanding of basic concepts.',
    strengths: ['Clear writing'],
    moved: null,
    needed: 'Connect personal values to professional context.',
    courseKBUpdate: {
      insights: ['Strong reflective writing but stays personal'],
      learnerPosition: 'Beginner — strong writer, needs professional framing.',
    },
    ...overrides,
  };
}

function validCourseKB(overrides = {}) {
  return {
    exemplar: 'A professional portfolio published on WordPress...',
    objectives: [
      { objective: 'Can identify interests and values', evidence: 'Written reflection connecting values to professional context' },
      { objective: 'Can launch WordPress Playground', evidence: 'Published post on Playground instance' },
    ],
    learnerPosition: 'New learner, no activities completed yet.',
    insights: [],
    activitiesCompleted: 0,
    status: 'active',
    ...overrides,
  };
}

// -- validateSafety -----------------------------------------------------------

describe('validateSafety', () => {
  it('returns null for safe text', () => {
    assert.equal(validateSafety('Write a blog post about cooking'), null);
  });

  it('flags unsafe content', () => {
    assert.ok(validateSafety('how to hack a website'));
    assert.ok(validateSafety('kill yourself'));
    assert.ok(validateSafety('self-harm methods'));
  });
});

// -- validateActivity ---------------------------------------------------------

describe('validateActivity', () => {
  it('accepts a valid activity ending with Capture', () => {
    assert.equal(validateActivity(validActivity()), null);
  });

  it('accepts a valid activity ending with Submit', () => {
    assert.equal(validateActivity(validActivity({
      instruction: '1. Write a short paragraph about your goals\n2. Hit Submit to submit your response.',
    })), null);
  });

  it('rejects missing instruction', () => {
    assert.ok(validateActivity(validActivity({ instruction: undefined })));
  });

  it('rejects missing tips', () => {
    assert.ok(validateActivity(validActivity({ tips: 'nope' })));
  });

  it('accepts activity with any closing step', () => {
    assert.equal(validateActivity(validActivity({
      instruction: '1. Write a short paragraph about your goals\n2. Share your response.',
    })), null);
  });

  it('rejects too many steps (>5 total)', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Step one\n2. Step two\n3. Step three\n4. Step four\n5. Step five\n6. Hit Capture to capture your screen.',
    })));
  });

  it('allows up to 5 steps (4 content + Capture)', () => {
    assert.equal(validateActivity(validActivity({
      instruction: '1. Write a heading\n2. Add a paragraph\n3. Edit the layout\n4. Create a footer\n5. Hit Capture to capture your screen.',
    })), null);
  });

  it('rejects platform-specific shortcuts', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Press Ctrl+Shift+I to open tools\n2. Write something\n3. Hit Capture to capture your screen.',
    })));
  });

  it('rejects multi-site instructions', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Visit google.com then visit bing.com\n2. Write your findings\n3. Hit Capture to capture your screen.',
    })));
  });

  it('rejects non-browser apps', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Open your terminal\n2. Type a command\n3. Hit Capture to capture your screen.',
    })));
  });

  it('rejects DevTools references', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Open DevTools\n2. Write something\n3. Hit Capture to capture your screen.',
    })));
  });

  it('rejects activity with no visible work', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Visit the homepage\n2. Look around\n3. Hit Capture to capture your screen.',
    })));
  });

  it('rejects unsafe content', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Write about how to steal passwords\n2. Hit Capture to capture your screen.',
    })));
  });
});

// -- validateAssessment -------------------------------------------------------

describe('validateAssessment', () => {
  it('accepts a valid assessment', () => {
    assert.equal(validateAssessment(validAssessment()), null);
  });

  it('rejects non-boolean achieved', () => {
    assert.ok(validateAssessment(validAssessment({ achieved: 1 })));
  });

  it('rejects missing demonstrates', () => {
    assert.ok(validateAssessment(validAssessment({ demonstrates: '' })));
  });

  it('rejects missing strengths array', () => {
    assert.ok(validateAssessment(validAssessment({ strengths: 'good' })));
  });

  it('rejects missing moved', () => {
    const a = validAssessment();
    delete a.moved;
    assert.ok(validateAssessment(a));
  });

  it('accepts null moved (first activity)', () => {
    assert.equal(validateAssessment(validAssessment({ moved: null })), null);
  });

  it('rejects missing needed', () => {
    assert.ok(validateAssessment(validAssessment({ needed: '' })));
  });

  it('rejects missing courseKBUpdate', () => {
    assert.ok(validateAssessment(validAssessment({ courseKBUpdate: null })));
  });

  it('rejects missing courseKBUpdate.insights', () => {
    assert.ok(validateAssessment(validAssessment({
      courseKBUpdate: { insights: 'not array', learnerPosition: 'ok' },
    })));
  });

  it('rejects missing courseKBUpdate.learnerPosition', () => {
    assert.ok(validateAssessment(validAssessment({
      courseKBUpdate: { insights: [], learnerPosition: '' },
    })));
  });

  it('rejects unsafe content', () => {
    assert.ok(validateAssessment(validAssessment({
      demonstrates: 'kill yourself for this work',
    })));
  });
});

// -- validateCourseKB ---------------------------------------------------------

describe('validateCourseKB', () => {
  it('accepts a valid course KB', () => {
    assert.equal(validateCourseKB(validCourseKB()), null);
  });

  it('rejects missing exemplar', () => {
    assert.ok(validateCourseKB(validCourseKB({ exemplar: '' })));
  });

  it('rejects empty objectives', () => {
    assert.ok(validateCourseKB(validCourseKB({ objectives: [] })));
  });

  it('rejects objective missing evidence', () => {
    assert.ok(validateCourseKB(validCourseKB({
      objectives: [{ objective: 'Can do X', evidence: '' }],
    })));
  });

  it('rejects missing learnerPosition', () => {
    assert.ok(validateCourseKB(validCourseKB({ learnerPosition: '' })));
  });

  it('rejects missing insights array', () => {
    assert.ok(validateCourseKB(validCourseKB({ insights: 'not array' })));
  });

  it('rejects missing activitiesCompleted', () => {
    assert.ok(validateCourseKB(validCourseKB({ activitiesCompleted: 'zero' })));
  });

  it('rejects missing status', () => {
    assert.ok(validateCourseKB(validCourseKB({ status: '' })));
  });

  it('rejects unsafe content in exemplar', () => {
    assert.ok(validateCourseKB(validCourseKB({ exemplar: 'how to hack a database' })));
  });
});
