import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSafety,
  validateActivity,
  validateDiagnosticActivity,
  validateAssessment,
  validatePlan,
} from '../js/validators.js';

// -- Helpers ------------------------------------------------------------------

function validActivity(overrides = {}) {
  return {
    instruction: '1. Write a short paragraph about your goals\n2. Hit Record to capture your screen.',
    tips: ['Be specific', 'Keep it brief'],
    ...overrides,
  };
}

function validAssessment(overrides = {}) {
  return {
    score: 0.8,
    recommendation: 'advance',
    feedback: 'Great work on this activity.',
    strengths: ['Clear writing'],
    improvements: ['Add more detail'],
    ...overrides,
  };
}

function validPlan(activityCount, overrides = {}) {
  const types = ['explore', 'apply', 'create', 'final'];
  const activities = Array.from({ length: activityCount }, (_, i) => ({
    type: i === activityCount - 1 ? 'final' : types[i % 3],
    goal: `Objective ${i + 1}`,
  }));
  // Ensure no consecutive duplicates
  for (let i = 1; i < activities.length - 1; i++) {
    if (activities[i].type === activities[i - 1].type) {
      activities[i].type = activities[i].type === 'explore' ? 'apply' : 'explore';
    }
  }
  return {
    activities,
    finalWorkProductDescription: 'A completed project',
    workProductTool: 'WordPress',
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

// -- validateDiagnosticActivity -----------------------------------------------

describe('validateDiagnosticActivity', () => {
  it('accepts valid diagnostic activity', () => {
    assert.equal(validateDiagnosticActivity({ instruction: 'Do the thing', tips: ['tip1'] }), null);
  });

  it('rejects missing instruction', () => {
    assert.ok(validateDiagnosticActivity({ tips: ['tip1'] }));
  });

  it('rejects non-string instruction', () => {
    assert.ok(validateDiagnosticActivity({ instruction: 123, tips: [] }));
  });

  it('rejects missing tips array', () => {
    assert.ok(validateDiagnosticActivity({ instruction: 'Do it', tips: 'not an array' }));
  });

  it('rejects unsafe content in instruction', () => {
    assert.ok(validateDiagnosticActivity({ instruction: 'how to hack a server', tips: [] }));
  });

  it('rejects unsafe content in tips', () => {
    assert.ok(validateDiagnosticActivity({ instruction: 'Do the thing', tips: ['kill yourself'] }));
  });
});

// -- validateActivity ---------------------------------------------------------

describe('validateActivity', () => {
  it('accepts a valid activity', () => {
    assert.equal(validateActivity(validActivity()), null);
  });

  it('rejects missing instruction', () => {
    assert.ok(validateActivity(validActivity({ instruction: undefined })));
  });

  it('rejects missing tips', () => {
    assert.ok(validateActivity(validActivity({ tips: 'nope' })));
  });

  it('rejects instruction not ending with Record', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Write something\n2. Submit your work.',
    })));
  });

  it('rejects too many steps (>5 total)', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Step one\n2. Step two\n3. Step three\n4. Step four\n5. Step five\n6. Hit Record to capture your screen.',
    })));
  });

  it('allows up to 5 steps (4 content + Record)', () => {
    assert.equal(validateActivity(validActivity({
      instruction: '1. Write a heading\n2. Add a paragraph\n3. Edit the layout\n4. Create a footer\n5. Hit Record to capture your screen.',
    })), null);
  });

  it('rejects platform-specific shortcuts', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Press Ctrl+Shift+I to open tools\n2. Write something\n3. Hit Record to capture your screen.',
    })));
  });

  it('rejects multi-site instructions', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Visit google.com then visit bing.com\n2. Write your findings\n3. Hit Record to capture your screen.',
    })));
  });

  it('rejects non-browser apps', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Open your terminal\n2. Type a command\n3. Hit Record to capture your screen.',
    })));
  });

  it('rejects DevTools references', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Open DevTools\n2. Write something\n3. Hit Record to capture your screen.',
    })));
  });

  it('rejects activity with no visible work', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Visit the homepage\n2. Look around\n3. Hit Record to capture your screen.',
    })));
  });

  it('rejects unsafe content', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Write about how to steal passwords\n2. Hit Record to capture your screen.',
    })));
  });
});

// -- validateAssessment -------------------------------------------------------

describe('validateAssessment', () => {
  it('accepts a valid assessment', () => {
    assert.equal(validateAssessment(validAssessment()), null);
  });

  it('rejects score below 0', () => {
    assert.ok(validateAssessment(validAssessment({ score: -0.1 })));
  });

  it('rejects score above 1', () => {
    assert.ok(validateAssessment(validAssessment({ score: 1.1 })));
  });

  it('rejects non-number score', () => {
    assert.ok(validateAssessment(validAssessment({ score: '0.5' })));
  });

  it('rejects invalid recommendation', () => {
    assert.ok(validateAssessment(validAssessment({ recommendation: 'skip' })));
  });

  it('accepts all valid recommendations', () => {
    for (const rec of ['advance', 'revise', 'continue']) {
      assert.equal(validateAssessment(validAssessment({ recommendation: rec })), null);
    }
  });

  it('rejects missing feedback', () => {
    assert.ok(validateAssessment(validAssessment({ feedback: null })));
  });

  it('rejects missing strengths array', () => {
    assert.ok(validateAssessment(validAssessment({ strengths: 'good' })));
  });

  it('rejects missing improvements array', () => {
    assert.ok(validateAssessment(validAssessment({ improvements: 'more' })));
  });

  it('rejects unsafe content in feedback', () => {
    assert.ok(validateAssessment(validAssessment({ feedback: 'kill yourself for this work' })));
  });
});

// -- validatePlan -------------------------------------------------------------

describe('validatePlan', () => {
  it('accepts a valid plan', () => {
    assert.equal(validatePlan(validPlan(3), 3), null);
  });

  it('rejects wrong activity count', () => {
    assert.ok(validatePlan(validPlan(3), 4));
  });

  it('rejects missing activities array', () => {
    assert.ok(validatePlan({ finalWorkProductDescription: 'x', workProductTool: 'y' }, 1));
  });

  it('rejects missing finalWorkProductDescription', () => {
    const plan = validPlan(2);
    delete plan.finalWorkProductDescription;
    assert.ok(validatePlan(plan, 2));
  });

  it('rejects missing workProductTool', () => {
    const plan = validPlan(2);
    delete plan.workProductTool;
    assert.ok(validatePlan(plan, 2));
  });

  it('rejects plan where last activity is not type final', () => {
    const plan = validPlan(3);
    plan.activities[2].type = 'explore';
    assert.ok(validatePlan(plan, 3));
  });

  it('rejects consecutive duplicate activity types', () => {
    const plan = validPlan(4);
    plan.activities[0].type = 'explore';
    plan.activities[1].type = 'explore';
    assert.ok(validatePlan(plan, 4));
  });

  it('accepts single-activity plan with type final', () => {
    const plan = {
      activities: [{ type: 'final', goal: 'Do the thing' }],
      finalWorkProductDescription: 'A thing',
      workProductTool: 'Browser',
    };
    assert.equal(validatePlan(plan, 1), null);
  });
});
