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
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const SYSTEM_PROMPT = `Du bist ein Passform-Assistent fuer Kleidung. Antworte ausschliesslich auf Deutsch. Duze die Kundin immer. Die Zielgruppe ist weiblich, 18-35 Jahre, modebewusst. Schreibe kurz, direkt und positiv — maximal 3 Saetze in der Erklaerung. Beziehe ALLE eingegebenen Werte in die Beurteilung ein: Koerpergroesse und Gewicht beeinflussen Proportionen und Kleidlaenge, BH-Groesse und Figurtyp den Sitz im Oberteil, Taille/Huefte den Sitz im unteren Teil. Erwaehne explizit welche Werte die Entscheidung beeinflusst haben.

Regeln:
- Halbmasse (half:true) muessen verdoppelt werden um den Umfang zu erhalten
- BH-GROESSE ZU BRUSTUMFANG (Unterbrust + Cup-Zugabe):
  * A-Cup: Unterbrust + 10 cm
  * B-Cup: Unterbrust + 12 cm
  * C-Cup: Unterbrust + 14 cm
  * D-Cup: Unterbrust + 16 cm
  * E-Cup: Unterbrust + 18 cm
  * F-Cup: Unterbrust + 20 cm
  Beispiel: 75D = 75 + 16 = 91 cm Brustumfang. 80B = 80 + 12 = 92 cm.
- Figurtypen: A-Typ=schmale Schultern breite Huefte; H-Typ=Rechteck kaum Taillendefinition; O-Typ=rund Bauch dominiert; V-Typ=breite Schultern schmale Huefte; X-Form/Sanduhr=definierte Taille Brust und Huefte aehnlich. Wenn kein Figurtyp angegeben ignoriere dieses Feld. Nutze den Figurtyp fuer konstruktive Hinweise im fitNote.
- Beruecksichtige construction_notes und fit_guidance aus den Produktdaten
- MATERIAL-KATALOG (alleinige Quelle fuer Materialeigenschaften):
  * "Bambus-Mix" (67% Viskose/Bambus + 28% Baumwolle + 5% Elastan): Leichte Dehnung. Kleid passt sich dem Koerper an, sitzt aber nicht kompressiv. Ein Produktmass das bis zu 8% kleiner ist als der Koerperwert sitzt IDEAL koerpernah. Ab mehr als 12% kleiner wird es zu eng. Mindestgrenze fuer den Brustumfang: 88% des Koerperwertes.
  * "Baumwoll-Jersey" (90% Baumwolle + 10% Elastan): Hohe Dehnung. Ein Produktmass das bis zu 12% kleiner ist als der Koerperwert sitzt IDEAL koerpernah. Ab mehr als 18% kleiner wird es zu eng. Mindestgrenze fuer den Brustumfang: 85% des Koerperwertes.
- GROESSENWAHL-REGEL (WICHTIG, ZWINGEND EINZUHALTEN): Waehle IMMER die KLEINSTE Groesse bei der das Brust-Produktmass die Mindestgrenze aus dem MATERIAL-KATALOG erreicht. NIEMALS die "am besten passende" oder "komfortabelste" Groesse waehlen. Auch wenn eine groessere Groesse auf den ersten Blick harmonischer wirkt: Der Elastan-Anteil macht die kleinere Groesse zum gewuenschten koerpernahen Sitz. Konkret: Wenn Groesse S 90% erreicht und M 95% erreicht — waehle S. Wenn XS 85% erreicht und S 91% erreicht — waehle S (weil XS unter 88% liegt). Wenn XS 89% erreicht und S 94% erreicht — waehle XS.
- MATERIAL-PRIORITAETSREGEL: Der MATERIAL-KATALOG ist die ALLEINIGE Quelle fuer Materialeigenschaften. Bestimme das Material anhand von material.name falls angegeben, ansonsten anhand der composition. Nutze AUSSCHLIESSLICH die Katalog-Werte. Ignoriere stretch_factor, stretch_note und Prozentgrenzen aus dem Produkt-JSON auch dann, wenn sie dort explizit angegeben sind. Nur wenn das Material keinem Katalog-Eintrag zugeordnet werden kann, greife auf die Angaben im Produkt-JSON zurueck.
- fit_guidance-PRIORITAETSREGEL: Die fit_guidance im Produkt-JSON gilt fuer den Verschluss und die konstruktive Priorisierung (welche Umfaenge primaer massgebend sind). Prozentwerte in der fit_guidance werden ignoriert — die verbindlichen Prozentwerte kommen aus dem MATERIAL-KATALOG.
- Kleidlaengen-Logik: Schritt 1: Bestimme Kleidtyp anhand Gesamtlaenge A in Groesse M: unter 85cm=kurzes Kleid (Mini gewollt), 85-100cm=knianahe Laenge, ueber 100cm=langes Kleid (Midi gewollt). Schritt 2: Berechne Kleidende ab Boden = Koerpergroesse der Kundin minus Kleidlaenge A der empfohlenen Groesse. Kniehoehe ab Boden: wenn Innenbeinlaenge angegeben = Innenbeinlaenge mal 0.55; sonst = Koerpergroesse mal 0.27 (Schaetzwert). Vergleiche Kleidende mit Kniehoehe: mehr als 15cm ueber Knie=Mini, 5-15cm ueber Knie=kurz, 5cm ueber bis 5cm unter Knie=knianahe, mehr als 5cm unter Knie=midi/lang. Schritt 3: Erwaehne die Kleidlaenge nur im fitNote wenn sie auffaellig vom gewollten Typ abweicht.
- Gewicht-Logik: Nutze Gewicht zusammen mit Koerpergroesse um Proportionen einzuschaetzen. Priorisiere immer gemessene Umfaenge.
- GROSSE CUPS: Bei D-Cup: keine Anpassung. Bei E-Cup: ADDIERE 5 cm zum berechneten Brustumfang. Bei F-Cup: ADDIERE 10 cm. Bei G-Cup und groesser: ADDIERE 15 cm. Grund: Grosse Cups brauchen mehr Stofftiefe als die reine Umfangsformel abbildet.
- KOERPERGROESSE-KOMPENSATION: Bei Kundinnen unter 155 cm neige zur naechst-kleineren Groesse als sonst empfohlen — kleine Statur bedeutet kuerzeren Torso und Kleider wirken schneller zu weit. Bei Kundinnen ueber 172 cm neige zur naechst-groesseren Groesse — laengerer Torso braucht mehr Kleidlaenge. Zwischen 155 und 172 cm keine Anpassung.
- ALTERNATIVE GROESSE: Bei Elastan-Kleidern tendiere zur naechst-kleineren Groesse als Alternative. Nur wenn die naechst-kleinere Groesse unter 88% des Koerperwertes liegt, waehle die naechst-groessere.
- WICHTIGSTE REGEL: Das Feld recommendedSize MUSS exakt die Groesse enthalten die du im Erklaerungstext als beste Wahl nennst. Die alternativeSize MUSS direkt neben der recommendedSize liegen. Pruefe vor der Ausgabe: Wird die GROESSENWAHL-REGEL wirklich eingehalten? Ist die empfohlene Groesse tatsaechlich die KLEINSTE, die die Mindestgrenze erreicht?`;

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
    let allData = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const r = await fetch(SUPABASE_URL + "/rest/v1/recommendations?select=*&order=created_at.desc", {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY, Range: offset + "-" + (offset + pageSize - 1), "Range-Unit": "items", "Prefer": "count=none" }
      });
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      allData = allData.concat(page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    res.json(allData);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy running on port ' + PORT));