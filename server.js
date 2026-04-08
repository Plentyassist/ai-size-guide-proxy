const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const PORT = process.env.PORT || 3000;

const SIZES = ['XXXL', 'XXL', 'XL', 'XS', 'S', 'M', 'L'];

function extractPrimarySize(text) {
  if (!text) return null;
  const sentences = text.split('.').map(s => s.trim()).filter(s => s.length > 0);
  const keywords = ['empfehle', 'empfohlen', 'passt', 'ideal', 'perfekt', 'wähle', 'nimm'];
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    var hasKeyword = keywords.some(function(k) { return s.toLowerCase().includes(k); });
    if (hasKeyword) {
      for (var j = 0; j < SIZES.length; j++) {
        var pattern = new RegExp('\\b' + SIZES[j] + '\\b');
        if (pattern.test(s)) return SIZES[j];
      }
    }
  }
  for (var i = 0; i < sentences.length; i++) {
    for (var j = 0; j < SIZES.length; j++) {
      var pattern = new RegExp('\\b' + SIZES[j] + '\\b');
      if (pattern.test(sentences[i])) return SIZES[j];
    }
  }
  return null;
}

function getNextSize(size, sizes) {
  var idx = sizes.indexOf(size);
  if (idx === -1 || idx === sizes.length - 1) return null;
  return sizes[idx + 1];
}

app.post('/api/size-recommendation', async (req, res) => {
  try {
    const { profile, measurements } = req.body;
    const availableSizes = (measurements && measurements.sizes) ? measurements.sizes : SIZES;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Du bist ein Passform-Assistent für Kleidung. Antworte ausschliesslich auf Deutsch. Duze die Kundin immer. Die Zielgruppe ist weiblich, 18-35 Jahre, modebewusst. Schreibe kurz, direkt und positiv — maximal 3 Sätze in der Erklärung.

Kundenprofil: ${JSON.stringify(profile)}
Produktmaße: ${JSON.stringify(measurements)}

Regeln:
- Halbmaße (half:true) müssen verdoppelt werden um den Umfang zu erhalten
- BH-Größe (z.B. 75C): Unterbrustmaß + Cup-Zugabe (A=+10, B=+12, C=+14, D=+16, E=+18, F=+20cm) = Brustumfang
- Berücksichtige construction_notes und fit_guidance aus den Produktdaten
- Dehnlogik: 5% Elastan = ca. 10% Dehnung. Ein Produktmaß das bis zu 5% kleiner ist als der Körperwert sitzt IDEAL. Erst ab mehr als 8% kleiner wird es zu eng. Empfehle die kleinste Größe bei der das Produktmaß mindestens 92% des Körperwertes erreicht.
- WICHTIGSTE REGEL: Das Feld "recommendedSize" MUSS exakt die Größe enthalten die du im Erklärungstext als beste Wahl nennst. Die "alternativeSize" MUSS die nächstgrößere Größe nach recommendedSize sein — niemals eine Größe überspringen. Prüfe dies vor der Ausgabe nochmals explizit.

Antworte NUR mit einem JSON-Objekt ohne Markdown:
{"recommendedSize":"...","alternativeSize":"...","explanation":"...","fitNote":"..."}`
        }]
      })
    });

    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Serverseitige Plausibilitätsprüfung
    const extractedSize = extractPrimarySize(result.explanation);
    if (extractedSize && extractedSize !== result.recommendedSize) {
      result.recommendedSize = extractedSize;
    }

    // Alternative muss nächstgrößere Größe sein
    const nextSize = getNextSize(result.recommendedSize, availableSizes);
    if (nextSize) {
      result.alternativeSize = nextSize;
    }

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy running on port ' + PORT));
