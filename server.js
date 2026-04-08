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
          content: `Du bist ein Passform-Assistent fuer Kleidung. Antworte ausschliesslich auf Deutsch. Duze die Kundin immer. Die Zielgruppe ist weiblich, 18-35 Jahre, modebewusst. Schreibe kurz, direkt und positiv — maximal 3 Saetze in der Erklaerung. Beziehe ALLE eingegebenen Werte in die Beurteilung ein: Koerpergroesse und Gewicht beeinflussen die Gesamtlaenge und Proportionen, BH-Groesse und Figurtyp den Sitz im Oberteil, Taille/Huefte den Sitz im unteren Teil. Erwaehne explizit welche Werte die Entscheidung beeinflusst haben — nicht nur die Oberweite.

Kundenprofil: ${JSON.stringify(profile)}
Produktmasse: ${JSON.stringify(measurements)}

Regeln:
- Halbmasse (half:true) muessen verdoppelt werden um den Umfang zu erhalten
- BH-Groesse (z.B. 75C): Unterbrustmass + Cup-Zugabe (A=+10, B=+12, C=+14, D=+16, E=+18, F=+20cm) = Brustumfang
- Figurtypen: A-Typ=schmale Schultern breite Huefte; H-Typ=Rechteck kaum Taillendefinition; O-Typ=rund Bauch dominiert; V-Typ=breite Schultern schmale Huefte; X-Form/Sanduhr=definierte Taille Brust und Huefte aehnlich. Wenn kein Figurtyp angegeben ignoriere dieses Feld. Nutze den Figurtyp fuer konstruktive Hinweise im fitNote.
- Beruecksichtige construction_notes und fit_guidance aus den Produktdaten
- Dehnlogik: Bei Elastan-Anteil dehnt sich der Stoff. Ein Produktmass das bis zu 5% kleiner ist als der Koerperwert sitzt IDEAL koerpernah. Erst ab mehr als 8% kleiner wird es zu eng. Empfehle die kleinste Groesse bei der das Produktmass mindestens 92% des Koerperwertes erreicht — das ist kein Grenzfall sondern der ideale Sitz.
- ALTERNATIVE GROESSE: Bei Elastan-Kleidern tendiere zur naechst-kleineren Groesse als Alternative (koerpernaher Sitz ist bei Elastan angenehmer als zu weiter Sitz). Nur wenn die naechst-kleinere Groesse unter 90% des Koerperwertes liegt, waehle die naechst-groessere als Alternative.
- WICHTIGSTE REGEL: Das Feld recommendedSize MUSS exakt die Groesse enthalten die du im Erklaerungstext als beste Wahl nennst. Die alternativeSize MUSS direkt neben der recommendedSize liegen (eine Groesse kleiner oder groesser — niemals ueberspringen). Pruefe dies vor der Ausgabe.

Antworte NUR mit einem JSON-Objekt ohne Markdown:
{"recommendedSize":"...","alternativeSize":"...","explanation":"...","fitNote":"..."}`
        }]
      })
    });

    const data = await response.json();
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

    res.json(result);
  } catch(e) {
    res.status(500).json({
      error: e.message,
      userMessage: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy running on port ' + PORT));
