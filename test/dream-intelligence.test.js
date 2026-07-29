const { test } = require('node:test');
const assert = require('node:assert');

const dream = require('../src/dream');

test('dream prompt asks for emotional, contextual, curious, and helpful intelligence', () => {
  const prompt = dream.buildDreamSystem('Sam');
  assert.match(prompt, /EMOTIONAL INTELLIGENCE/);
  assert.match(prompt, /CURIOSITY/);
  assert.match(prompt, /HELPFULNESS/);
  assert.match(prompt, /next_day_offer/);
  assert.match(prompt, /standing permission to THINK/);
  assert.match(prompt, /Permission is required at the DISCUSSION boundary/);
  assert.match(prompt, /Sam/);
});

test('dream reading is default companion behavior but pauses cleanly and never identifies the person', () => {
  const candidate = {
    research_request: {
      topic: 'interaction design',
      question: 'What makes a desktop companion feel present?',
      why_now: 'A repeated interest',
      evidence: 'It appeared in three conversations.',
      confidence: 0.9,
    },
  };

  assert.equal(dream.chooseResearchRequest(candidate, null, { research_enabled: false }), null);
  assert.equal(
    dream.chooseResearchRequest(candidate, null, { research_enabled: true }).topic,
    'interaction design'
  );

  const emotionallyRelevant = {
    research_request: {
      topic: 'grief and companionship',
      question: 'What does evidence say makes quiet support feel supportive?',
      evidence: 'The person has returned to the role of quiet company.',
      confidence: 0.99,
    },
  };
  assert.equal(
    dream.chooseResearchRequest(emotionallyRelevant, null, { research_enabled: true }, 'Sam').topic,
    'grief and companionship',
    'serious subjects are allowed as general learning'
  );

  const identifying = {
    research_request: {
      topic: 'Sam’s private situation',
      question: 'What diagnosis explains Sam?',
      evidence: 'A recent conversation.',
      confidence: 0.99,
    },
  };
  assert.equal(
    dream.chooseResearchRequest(identifying, null, { research_enabled: true }, 'Sam'),
    null,
    'autonomous web queries never name or investigate the person'
  );

  const queued = dream.chooseResearchRequest(
    emotionallyRelevant,
    { id: 'q1', topic: 'sleep research', question: 'What does the evidence say about naps?' },
    { research_enabled: false }
  );
  assert.equal(queued.requested, true);
  assert.equal(queued.queueId, 'q1');
  assert.equal(queued.topic, 'sleep research');
});

test('web research parsing preserves fact/opinion structure and safe citations', () => {
  const parsed = dream.parseResearchResponse(
    {
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              { title: 'Primary paper', url: 'https://example.org/paper' },
              { title: 'unsafe', url: 'file:///tmp/nope' },
            ],
          },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text:
                'SUMMARY: The evidence points one way.\nTAKE: I think restraint matters.\nCOUNTERPOINT: More initiative can improve discovery.\nOPEN QUESTION: Where is the right boundary?\nOPENER: I found a useful tension. Want the duck-sized version?',
              annotations: [
                {
                  type: 'url_citation',
                  title: 'Primary paper',
                  url: 'https://example.org/paper',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      topic: 'agent restraint',
      question: 'How proactive should a companion be?',
      requested: false,
    }
  );

  assert.equal(parsed.summary, 'The evidence points one way.');
  assert.equal(parsed.take, 'I think restraint matters.');
  assert.equal(parsed.counterpoint, 'More initiative can improve discovery.');
  assert.equal(parsed.openQuestion, 'Where is the right boundary?');
  assert.match(parsed.opener, /duck-sized/);
  assert.deepEqual(parsed.sources, [
    { title: 'Primary paper', url: 'https://example.org/paper' },
  ]);
});

test('research uses the Responses web-search tool and never puts content in diagnostics', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text:
                  'SUMMARY: A compact fact.\nTAKE: A tentative take.\nCOUNTERPOINT: A fair objection.\nOPEN QUESTION: One uncertainty.\nOPENER: I found something. Want it?',
                annotations: [],
              },
            ],
          },
        ],
      }),
    };
  };
  const logs = [];
  try {
    const brief = await dream.researchCuriosity({
      apiKey: 'test-key',
      model: 'test-model',
      request: {
        topic: 'gentle agents',
        question: 'What makes proactivity welcome?',
        requested: true,
      },
      logEvent: (type, data) => logs.push({ type, data }),
    });
    assert.ok(brief);
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(request.body.tools, [{ type: 'web_search', search_context_size: 'low' }]);
    assert.equal(request.body.tool_choice, 'required');
    assert.deepEqual(request.body.include, ['web_search_call.action.sources']);
    assert.deepEqual(logs, [
      { type: 'dream-research', data: { ok: true, count: 0, mode: 'requested' } },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
