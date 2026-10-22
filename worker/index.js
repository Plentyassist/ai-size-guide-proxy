// Cloudflare-Worker-Version des Proxys (Ersatz für server.js auf Railway).
// Secrets (per `wrangler secret put`): CLAUDE_API_KEY, SUPABASE_SERVICE_KEY, DASHBOARD_PASSWORD
// Variable (wrangler.jsonc): SUPABASE_URL
// public/dashboard.html wird als Static Asset ausgeliefert, sonst nichts aus dem Repo.

import SYSTEM_PROMPT from './system-prompt.txt';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-dashboard-password',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function extractPrimarySize(text) {
  if (!text) return null;
  const sentences = text.split('.').map(s => s.trim()).filter(s => s.length > 0);
  const keywords = ['empfehle', 'empfohlen', 'passt', 'ideal', 'perfekt', 'waehle', 'nimm'];
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    var hasKeyword = keywords.some(function(k) { return s.toLowerCase().includes(k); });
    if (hasKeyword) {
      for (var j = 0; j < SIZES.length; j++) {
        if (new RegExp('\\b' + SIZES[j] + '\\b').test(s)) return SIZES[j];
      }
    }
  }
  for (var i = 0; i < sentences.length; i++) {
    for (var j = 0; j < SIZES.length; j++) {
      if (new RegExp('\\b' + SIZES[j] + '\\b').test(sentences[i])) return SIZES[j];
    }
  }
  return null;
}

function isValidAlternative(recommended, alternative, availableSizes) {
  var recIdx = availableSizes.indexOf(recommended);
  var altIdx = availableSizes.indexOf(alternative);
  if (recIdx === -1 || altIdx === -1) return false;
  return Math.abs(recIdx - altIdx) === 1;
}

function getNextSize(size, sizes) {
  var idx = sizes.indexOf(size);
  if (idx === -1 || idx === sizes.length - 1) return null;
  return sizes[idx + 1];
}

function getPrevSize(size, sizes) {
  var idx = sizes.indexOf(size);
  if (idx <= 0) return null;
  return sizes[idx - 1];
}

function supabaseHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
  };
}

async function saveToSupabase(env, data) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/recommendations', {
      method: 'POST',
      headers: {
        ...supabaseHeaders(env),
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    });
    if (!r.ok) console.error('Supabase write error:', r.status, await r.text());
  } catch (e) {
    console.error('Supabase write error:', e.message);
  }
}

async function sizeRecommendation(request, env, ctx) {
  try {
    const { profile, measurements } = await request.json();
    const availableSizes = (measurements && measurements.sizes) ? measurements.sizes : SIZES;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Produktmasse: ${JSON.stringify(measurements)}`,
              cache_control: { type: 'ephemeral' }
            },
            {
              type: 'text',
              text: `Kundenprofil: ${JSON.stringify(profile)}\n\nAntworte NUR mit einem JSON-Objekt ohne Markdown:\n{"recommendedSize":"...","alternativeSize":"...","explanation":"...","fitNote":"..."}`
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', response.status, JSON.stringify(data.error || data));
      throw new Error('Claude API ' + response.status);
    }

    if (data.usage) {
      console.log('Cache stats:', {
        cache_creation: data.usage.cache_creation_input_tokens || 0,
        cache_read: data.usage.cache_read_input_tokens || 0,
        input: data.usage.input_tokens,
        output: data.usage.output_tokens
      });
    }

    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    const extractedSize = extractPrimarySize(result.explanation);
    if (extractedSize && extractedSize !== result.recommendedSize) {
      result.recommendedSize = extractedSize;
    }

    if (!isValidAlternative(result.recommendedSize, result.alternativeSize, availableSizes)) {
      const prev = getPrevSize(result.recommendedSize, availableSizes);
      result.alternativeSize = prev || getNextSize(result.recommendedSize, availableSizes);
    }

    // Supabase logging, läuft nach der Antwort weiter
    ctx.waitUntil(saveToSupabase(env, {
      product_id: measurements ? measurements.product_id : null,
      product_title: measurements ? measurements.name : null,
      recommended_size: result.recommendedSize,
      alternative_size: result.alternativeSize,
      height: profile ? parseFloat(profile.height) || null : null,
      weight: profile ? parseFloat(profile.weight) || null : null,
      cup_size: profile ? profile.cup : null,
      figure_type: profile ? profile.figure : null,
      waist: profile ? parseFloat(profile.waist) || null : null,
      hip: profile ? parseFloat(profile.hip) || null : null,
      inseam: profile ? parseFloat(profile.inseam) || null : null,
      explanation: result.explanation,
      fit_note: result.fitNote
    }));

    return json(result);
  } catch (e) {
    return json({
      error: e.message,
      userMessage: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.'
    }, 500);
  }
}

async function dashboardData(request, env) {
  const pwd = request.headers.get('x-dashboard-password');
  if (!env.DASHBOARD_PASSWORD || pwd !== env.DASHBOARD_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    let allData = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const r = await fetch(env.SUPABASE_URL + '/rest/v1/recommendations?select=*&order=created_at.desc', {
        headers: { ...supabaseHeaders(env), Range: offset + '-' + (offset + pageSize - 1), 'Range-Unit': 'items', 'Prefer': 'count=none' }
      });
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      allData = allData.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return json(allData);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (pathname === '/api/size-recommendation' && request.method === 'POST') {
      return sizeRecommendation(request, env, ctx);
    }
    if (pathname === '/api/dashboard-data' && request.method === 'GET') {
      return dashboardData(request, env);
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }
};
