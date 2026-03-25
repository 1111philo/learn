import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSafety,
  validateActivity,
  validateAssessment,
  validateSummative,
  validateSummativeAssessment,
  validateGapAnalysis,
  validateJourney,
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
    score: 0.8,
    recommendation: 'advance',
    feedback: 'Great work on this activity.',
    strengths: ['Clear writing'],
    improvements: ['Add more detail'],
    ...overrides,
  };
}

function validSummative(overrides = {}) {
  return {
    task: {
      steps: [
        { instruction: 'Create a professional portfolio page in Google Docs.' },
        { instruction: 'Add a header with your name and professional summary.' },
      ],
    },
    rubric: [
      {
        name: 'Professional communication',
        levels: {
          incomplete: 'No clear structure',
          approaching: 'Basic structure present',
          meets: 'Clear, professional structure',
          exceeds: 'Exceptional communication with consistent voice',
        },
      },
      {
        name: 'Technical proficiency',
        levels: {
          incomplete: 'Unable to use the tool',
          approaching: 'Basic tool usage',
          meets: 'Effective tool usage',
          exceeds: 'Advanced tool usage with creative solutions',
        },
      },
    ],
    exemplar: 'A well-structured portfolio page with clear headings, professional summary, and organized sections.',
    ...overrides,
  };
}

function validSummativeAssessment(overrides = {}) {
  return {
    criteriaScores: [
      { criterion: 'Professional communication', level: 'meets', score: 0.75, feedback: 'Good structure.' },
      { criterion: 'Technical proficiency', level: 'approaching', score: 0.5, feedback: 'Needs more practice.' },
    ],
    overallScore: 0.625,
    mastery: false,
    feedback: 'Good progress, keep working on technical skills.',
    nextSteps: ['Practice formatting', 'Review examples'],
    ...overrides,
  };
}

function validGapAnalysis(overrides = {}) {
  return {
    gaps: [
      { criterion: 'Technical proficiency', currentLevel: 'approaching', targetLevel: 'meets', priority: 'high' },
      { criterion: 'Professional communication', currentLevel: 'meets', targetLevel: 'exceeds', priority: 'medium' },
    ],
    ...overrides,
  };
}

function validJourney(overrides = {}) {
  return {
    units: [
      {
        unitId: 'foundations-0-basic-wordpress',
        activities: [
          { type: 'explore', goal: 'Research portfolio layouts', rubricCriteria: ['Technical proficiency'] },
          { type: 'create', goal: 'Build a draft portfolio', rubricCriteria: ['Professional communication', 'Technical proficiency'] },
        ],
      },
    ],
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
  it('accepts a valid activity', () => {
    assert.equal(validateActivity(validActivity()), null);
  });

  it('rejects missing instruction', () => {
    assert.ok(validateActivity(validActivity({ instruction: undefined })));
  });

  it('rejects missing tips', () => {
    assert.ok(validateActivity(validActivity({ tips: 'nope' })));
  });

  it('rejects instruction not ending with Capture', () => {
    assert.ok(validateActivity(validActivity({
      instruction: '1. Write something\n2. Submit your work.',
    })));
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

// -- validateSummative --------------------------------------------------------

describe('validateSummative', () => {
  it('accepts a valid summative', () => {
    assert.equal(validateSummative(validSummative()), null);
  });

  it('rejects missing task', () => {
    assert.ok(validateSummative(validSummative({ task: null })));
  });

  it('rejects task with empty steps', () => {
    assert.ok(validateSummative(validSummative({ task: { steps: [] } })));
  });

  it('rejects step missing instruction', () => {
    assert.ok(validateSummative(validSummative({
      task: { steps: [{ instruction: 'Good' }, {}] },
    })));
  });

  it('rejects empty rubric', () => {
    assert.ok(validateSummative(validSummative({ rubric: [] })));
  });

  it('rejects rubric criterion missing name', () => {
    const s = validSummative();
    s.rubric[0].name = '';
    assert.ok(validateSummative(s));
  });

  it('rejects rubric criterion missing a level', () => {
    const s = validSummative();
    delete s.rubric[0].levels.exceeds;
    assert.ok(validateSummative(s));
  });

  it('rejects missing exemplar', () => {
    assert.ok(validateSummative(validSummative({ exemplar: '' })));
  });

  it('rejects unsafe content in exemplar', () => {
    assert.ok(validateSummative(validSummative({ exemplar: 'how to hack a database' })));
  });
});

// -- validateSummativeAssessment ----------------------------------------------

describe('validateSummativeAssessment', () => {
  it('accepts a valid summative assessment', () => {
    assert.equal(validateSummativeAssessment(validSummativeAssessment()), null);
  });

  it('rejects empty criteriaScores', () => {
    assert.ok(validateSummativeAssessment(validSummativeAssessment({ criteriaScores: [] })));
  });

  it('rejects criterion with invalid level', () => {
    const a = validSummativeAssessment();
    a.criteriaScores[0].level = 'expert';
    assert.ok(validateSummativeAssessment(a));
  });

  it('rejects criterion score out of range', () => {
    const a = validSummativeAssessment();
    a.criteriaScores[0].score = 1.5;
    assert.ok(validateSummativeAssessment(a));
  });

  it('rejects overallScore out of range', () => {
    assert.ok(validateSummativeAssessment(validSummativeAssessment({ overallScore: -0.1 })));
  });

  it('rejects non-boolean mastery', () => {
    assert.ok(validateSummativeAssessment(validSummativeAssessment({ mastery: 1 })));
  });

  it('rejects missing feedback', () => {
    assert.ok(validateSummativeAssessment(validSummativeAssessment({ feedback: '' })));
  });

  it('enforces ratchet rule — rejects lower score than prior attempt', () => {
    const priorAttempt = {
      criteriaScores: [
        { criterion: 'Professional communication', score: 0.8 },
        { criterion: 'Technical proficiency', score: 0.5 },
      ],
    };
    const current = validSummativeAssessment();
    current.criteriaScores[0].score = 0.7; // lower than prior 0.8
    assert.ok(validateSummativeAssessment(current, priorAttempt));
  });

  it('allows equal or higher scores with prior attempt', () => {
    const priorAttempt = {
      criteriaScores: [
        { criterion: 'Professional communication', score: 0.7 },
        { criterion: 'Technical proficiency', score: 0.4 },
      ],
    };
    assert.equal(validateSummativeAssessment(validSummativeAssessment(), priorAttempt), null);
  });

  it('passes with no prior attempt', () => {
    assert.equal(validateSummativeAssessment(validSummativeAssessment(), null), null);
  });
});

// -- validateGapAnalysis ------------------------------------------------------

describe('validateGapAnalysis', () => {
  it('accepts a valid gap analysis', () => {
    assert.equal(validateGapAnalysis(validGapAnalysis()), null);
  });

  it('rejects empty gaps', () => {
    assert.ok(validateGapAnalysis({ gaps: [] }));
  });

  it('rejects gap missing criterion', () => {
    const g = validGapAnalysis();
    g.gaps[0].criterion = '';
    assert.ok(validateGapAnalysis(g));
  });

  it('rejects invalid currentLevel', () => {
    const g = validGapAnalysis();
    g.gaps[0].currentLevel = 'expert';
    assert.ok(validateGapAnalysis(g));
  });

  it('rejects invalid priority', () => {
    const g = validGapAnalysis();
    g.gaps[0].priority = 'critical';
    assert.ok(validateGapAnalysis(g));
  });
});

// -- validateJourney ----------------------------------------------------------

describe('validateJourney', () => {
  it('accepts a valid journey', () => {
    assert.equal(validateJourney(validJourney()), null);
  });

  it('rejects empty units', () => {
    assert.ok(validateJourney({ units: [] }));
  });

  it('rejects unit missing unitId', () => {
    const j = validJourney();
    j.units[0].unitId = '';
    assert.ok(validateJourney(j));
  });

  it('rejects unit with no activities', () => {
    const j = validJourney();
    j.units[0].activities = [];
    assert.ok(validateJourney(j));
  });

  it('rejects activity missing type', () => {
    const j = validJourney();
    delete j.units[0].activities[0].type;
    assert.ok(validateJourney(j));
  });

  it('rejects activity missing goal', () => {
    const j = validJourney();
    delete j.units[0].activities[0].goal;
    assert.ok(validateJourney(j));
  });

  it('rejects activity with empty rubricCriteria', () => {
    const j = validJourney();
    j.units[0].activities[0].rubricCriteria = [];
    assert.ok(validateJourney(j));
  });
});
