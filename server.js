const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const PORT = process.env.PORT || 3000;

app.post('/api/size-recommendation', async (req, res) => {
  try {
    const { profile, measurements } = req.body;
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
- Gehe immer von normaler Passform aus. WICHTIG zur Dehnlogik: Der Stoff hat 5% Elastan und dehnt sich ca. 10% in der Breite. Das bedeutet: ein Produktmaß das bis zu 5% kleiner ist als der Körperwert sitzt IDEAL — der Stoff liegt glatt an ohne zu ziehen und ohne Falten. Erst wenn das Produktmaß mehr als 8% kleiner ist als der Körperwert wird es zu eng. Empfehle daher die kleinste Größe bei der das Produktmaß mindestens 92% des Körperwertes erreicht. Nicht unnötig eine Größe größer empfehlen wegen "Spielraum"
- KRITISCHE REGEL: Das Feld "recommendedSize" MUSS exakt mit der im Erklärungstext genannten empfohlenen Größe übereinstimmen. Wenn du im Text "L" als beste Wahl nennst, muss recommendedSize "L" sein. Prüfe dies vor der Ausgabe.

Antworte NUR mit einem JSON-Objekt ohne Markdown:
{"recommendedSize":"...","alternativeSize":"...","explanation":"...","fitNote":"..."}`
        }]
      })
    });
    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    
    // Plausibilitätsprüfung: recommendedSize muss im Erklärungstext vorkommen
    if (result.explanation && result.recommendedSize) {
      const exp = result.explanation;
      const rec = result.recommendedSize;
      // Wenn die empfohlene Größe nicht im letzten Satz vorkommt, extrahiere sie aus dem Text
      const lastSentence = exp.split('.').filter(s => s.trim()).pop() || '';
      if (!lastSentence.includes(rec)) {
        // Suche nach Größen im letzten Satz
        const sizes = ['XXXL', 'XXL', 'XL', 'XS', 'S', 'M', 'L'];
        for (var i = 0; i < sizes.length; i++) {
          if (lastSentence.includes(sizes[i])) {
            result.recommendedSize = sizes[i];
            break;
          }
        }
      }
    }
    
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy running on port ' + PORT));
