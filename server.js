const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
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

async function saveToSupabase(data) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(SUPABASE_URL + '/rest/v1/recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    });
  } catch(e) {
    console.error('Supabase write error:', e.message);
  }
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
          content: `Du bist ein Passform-Assistent fuer Kleidung. Antworte ausschliesslich auf Deutsch. Duze die Kundin immer. Die Zielgruppe ist weiblich, 18-35 Jahre, modebewusst. Schreibe kurz, direkt und positiv — maximal 3 Saetze in der Erklaerung. Beziehe ALLE eingegebenen Werte in die Beurteilung ein: Koerpergroesse und Gewicht beeinflussen Proportionen und Kleidlaenge, BH-Groesse und Figurtyp den Sitz im Oberteil, Taille/Huefte den Sitz im unteren Teil. Erwaehne explizit welche Werte die Entscheidung beeinflusst haben.

Kundenprofil: ${JSON.stringify(profile)}
Produktmasse: ${JSON.stringify(measurements)}

Regeln:
- Halbmasse (half:true) muessen verdoppelt werden um den Umfang zu erhalten
- BH-Groesse (z.B. 75C): Unterbrustmass + Cup-Zugabe (A=+10, B=+12, C=+14, D=+16, E=+18, F=+20cm) = Brustumfang
- Figurtypen: A-Typ=schmale Schultern breite Huefte; H-Typ=Rechteck kaum Taillendefinition; O-Typ=rund Bauch dominiert; V-Typ=breite Schultern schmale Huefte; X-Form/Sanduhr=definierte Taille Brust und Huefte aehnlich. Wenn kein Figurtyp angegeben ignoriere dieses Feld. Nutze den Figurtyp fuer konstruktive Hinweise im fitNote.
- Beruecksichtige construction_notes und fit_guidance aus den Produktdaten
- Dehnlogik: Bei Elastan-Anteil dehnt sich der Stoff. Ein Produktmass das bis zu 5% kleiner ist als der Koerperwert sitzt IDEAL koerpernah. Erst ab mehr als 8% kleiner wird es zu eng. Empfehle die kleinste Groesse bei der das Produktmass mindestens 92% des Koerperwertes erreicht — das ist kein Grenzfall sondern der ideale Sitz.
- Kleidlaengen-Logik: Schritt 1: Bestimme Kleidtyp anhand Gesamtlaenge A in Groesse M: unter 85cm=kurzes Kleid (Mini gewollt), 85-100cm=knianahe Laenge, ueber 100cm=langes Kleid (Midi gewollt). Schritt 2: Berechne Kleidende ab Boden = Koerpergroesse der Kundin minus Kleidlaenge A der empfohlenen Groesse. Kniehoehe ab Boden: wenn Innenbeinlaenge angegeben = Innenbeinlaenge mal 0.55; sonst = Koerpergroesse mal 0.27 (Schaetzwert). Vergleiche Kleidende mit Kniehoehe: mehr als 15cm ueber Knie=Mini, 5-15cm ueber Knie=kurz, 5cm ueber bis 5cm unter Knie=knianahe, mehr als 5cm unter Knie=midi/lang. Schritt 3: Erwaehne die Kleidlaenge nur im fitNote wenn sie auffaellig vom gewollten Typ abweicht.
- Gewicht-Logik: Nutze Gewicht zusammen mit Koerpergroesse um Proportionen einzuschaetzen. Priorisiere immer gemessene Umfaenge.
- ALTERNATIVE GROESSE: Bei Elastan-Kleidern tendiere zur naechst-kleineren Groesse als Alternative. Nur wenn die naechst-kleinere Groesse unter 90% des Koerperwertes liegt, waehle die naechst-groessere.
- WICHTIGSTE REGEL: Das Feld recommendedSize MUSS exakt die Groesse enthalten die du im Erklaerungstext als beste Wahl nennst. Die alternativeSize MUSS direkt neben der recommendedSize liegen. Pruefe dies vor der Ausgabe.

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

    // Supabase logging
    await saveToSupabase({
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
    });

    res.json(result);
  } catch(e) {
    res.status(500).json({
      error: e.message,
      userMessage: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.'
    });
  }
});

app.use(express.static(__dirname));

app.get("/api/dashboard-data", async (req, res) => {
  const pwd = req.headers["x-dashboard-password"];
  if (pwd !== "tates2026") { return res.status(401).json({ error: "Unauthorized" }); }
  try {
    const response = await fetch(SUPABASE_URL + "/rest/v1/recommendations?select=*&order=created_at.desc&limit=10000", {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY }
    });
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy running on port ' + PORT));

