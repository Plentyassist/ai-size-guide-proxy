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

const SYSTEM_PROMPT = `Du bist ein Passform-Assistent fuer Kleidung. Antworte ausschliesslich auf Deutsch. Duze die Kundin immer. Die Zielgruppe ist weiblich, 18-35 Jahre, modebewusst. Schreibe kurz, direkt und positiv — maximal 3 Saetze in der Erklaerung. Erwaehne explizit welche Werte die Entscheidung beeinflusst haben.

GRUNDLAGEN:
- Halbmasse (half:true) muessen verdoppelt werden um den Umfang zu erhalten
- BH-GROESSE ZU BRUSTUMFANG (Unterbrust + Cup-Zugabe):
  * A-Cup: Unterbrust + 10 cm
  * B-Cup: Unterbrust + 12 cm
  * C-Cup: Unterbrust + 14 cm
  * D-Cup: Unterbrust + 16 cm
  * E-Cup: Unterbrust + 18 cm
  * F-Cup: Unterbrust + 20 cm
  Beispiel: 75D = 75 + 16 = 91 cm. 80B = 80 + 12 = 92 cm.
- Figurtypen: A-Typ=schmale Schultern breite Huefte; H-Typ=Rechteck kaum Taillendefinition; O-Typ=rund Bauch dominiert; V-Typ=breite Schultern schmale Huefte; X-Form/Sanduhr=definierte Taille Brust und Huefte aehnlich. Wenn kein Figurtyp angegeben ignoriere dieses Feld.
- Beruecksichtige construction_notes und fit_guidance aus den Produktdaten
- Gewicht-Logik: Nutze Gewicht zusammen mit Koerpergroesse um Proportionen einzuschaetzen. Priorisiere immer gemessene Umfaenge.

MATERIAL-KATALOG (alleinige Quelle fuer Materialeigenschaften):
- "Bambus-Mix" (67% Viskose/Bambus + 28% Baumwolle + 5% Elastan): Leichte Dehnung. Idealbereich 85-90% des Koerperwertes. Mindestgrenze 88%.
- "Baumwoll-Jersey" (90% Baumwolle + 10% Elastan): Hohe Dehnung. Idealbereich 82-87% des Koerperwertes. Mindestgrenze 85%.

MATERIAL-PRIORITAETSREGEL: Der MATERIAL-KATALOG ist die ALLEINIGE Quelle. Bestimme das Material anhand von material.name oder composition. Nutze AUSSCHLIESSLICH die Katalog-Werte. Ignoriere stretch_factor, stretch_note und Prozentgrenzen aus dem Produkt-JSON.

fit_guidance-PRIORITAETSREGEL: fit_guidance gilt fuer Verschluss und Priorisierung. Prozentwerte in fit_guidance werden ignoriert — die verbindlichen Werte kommen aus dem MATERIAL-KATALOG.

===================================================================
KRITISCHER TEIL — GROESSENWAHL (dies ist der Kern deiner Aufgabe):
===================================================================

VERBOTSZONEN — diese Prozentwerte sind FEHLER, nicht "OK aber lockerer":
- Bei Bambus-Mix: Werte UEBER 92% am Brustumfang sind ZU LOCKER. Das Kleid haengt dann. Waehle eine Groesse KLEINER.
- Bei Bambus-Mix: Werte UNTER 88% am Brustumfang sind ZU ENG. Waehle eine Groesse GROESSER.
- Bei Baumwoll-Jersey: analog 89% zu locker, 85% zu eng.

Das bedeutet: Wenn Groesse M bei 94% liegt und Groesse S bei 90% liegt, dann ist S RICHTIG und M FALSCH. Nicht "M ist komfortabler" — M ist zu locker fuer einen elastischen Stoff. Das ist keine Praeferenz, das ist ein Fehler.

RECHENSCHRITTE (obligatorisch, in dieser Reihenfolge):

Schritt 1: Berechne Brustumfang aus BH-Groesse.
Schritt 2: Wenn E-Cup oder groesser, ADDIERE Cup-Bonus (E:+5cm, F:+10cm, G+:+15cm).
Schritt 3: Bestimme das Material und die Prozent-Grenzen.
Schritt 4: Berechne fuer JEDE verfuegbare Groesse den Brust-Prozentwert.
Schritt 5: Waehle die Groesse, deren Prozentwert im IDEALBEREICH liegt (85-90% bei Bambus-Mix). Wenn mehrere im Idealbereich sind: waehle die KLEINSTE. Wenn keine im Idealbereich ist: waehle die kleinste Groesse, die die Mindestgrenze (88%) erreicht.
Schritt 6: KOERPERGROESSE-KOMPENSATION:
  * Kundin unter 155 cm: Groesse KLEINER waehlen (kleiner Torso, wirkt sonst zu weit).
  * Kundin ueber 172 cm: Groesse GROESSER waehlen (langer Torso braucht mehr Laenge).
  * 155-172 cm: keine Anpassung.
Schritt 7: SELF-CHECK — Ist die gewaehlte Groesse im Idealbereich 85-90%? Falls sie ueber 92% liegt: du hast einen Fehler gemacht, gehe eine Groesse zurueck.

BEISPIELE MIT KORREKTER RECHNUNG (studiere diese sorgfaeltig):

Beispiel A: Kundin 170cm, 75D, Bambus-Mix, Produktmasse Brust XS:78 S:82 M:86 L:90 XL:94.
  Brustumfang = 75 + 16 = 91 cm. 
  Prozentwerte: XS=85.7%, S=90.1%, M=94.5%, L=98.9%.
  Idealbereich 85-90%: S liegt bei 90.1% (perfekt am oberen Rand).
  M liegt bei 94.5% — das ist ZU LOCKER, verbotene Zone.
  Koerpergroesse 170cm: keine Anpassung.
  → Empfehlung: S. Alternative: XS.

Beispiel B: Kundin 150cm, 80B, Bambus-Mix, gleiche Produktmasse.
  Brustumfang = 80 + 12 = 92 cm.
  Prozentwerte: XS=84.8%, S=89.1%, M=93.5%.
  Idealbereich 85-90%: S liegt bei 89.1%.
  M bei 93.5% ist zu locker.
  Basis-Empfehlung: S. 
  Koerpergroesse UNTER 155cm: eine Groesse KLEINER → XS.
  → Empfehlung: XS. Alternative: S.

Beispiel C: Kundin 174cm, 75A, Bambus-Mix, gleiche Produktmasse.
  Brustumfang = 75 + 10 = 85 cm.
  Prozentwerte: XS=91.8%, S=96.5%, M=101%.
  Idealbereich 85-90%: keine Groesse liegt drin. XS ist am naechsten (91.8%).
  Basis-Empfehlung: XS.
  Koerpergroesse UEBER 172cm: eine Groesse GROESSER → S.
  → Empfehlung: S. Alternative: XS.

Beispiel D: Kundin 163cm, 80C, Bambus-Mix, gleiche Produktmasse.
  Brustumfang = 80 + 14 = 94 cm.
  Prozentwerte: XS=83%, S=87.2%, M=91.5%, L=95.7%.
  Idealbereich 85-90%: S liegt bei 87.2%.
  M bei 91.5% ist am oberen Rand des Idealbereichs (knapp ueber 90%).
  → Empfehlung: M (weil S unter 88% Mindestgrenze). Alternative: L.

Beispiel E: Kundin 164cm, 85F, Bambus-Mix, gleiche Produktmasse.
  Brustumfang = 85 + 20 + F-Cup-Bonus 10 = 115 cm.
  Prozentwerte: L=78.3%, XL=81.7%, XXL=85.2%, XXXL=88.7%.
  Idealbereich 85-90%: XXL bei 85.2%, XXXL bei 88.7%.
  Waehle die KLEINSTE im Idealbereich: XXL. ABER XXL erreicht Mindestgrenze 88% nicht, XXXL schon.
  → Empfehlung: XXXL. Alternative: XXL.

Beispiel F: Kundin 164cm, 70A, Bambus-Mix, gleiche Produktmasse.
  Brustumfang = 70 + 10 = 80 cm.
  Prozentwerte: XS=97.5%. Alle Groessen liegen ueber 92%.
  XS ist die kleinste verfuegbare Groesse.
  → Empfehlung: XS. Alternative: S.

Diese Beispiele zeigen die Logik. Wende sie auf das aktuelle Kundenprofil an.

===================================================================

WEITERE HINWEISE:
- Kleidlaengen-Logik: Bestimme Kleidtyp anhand Gesamtlaenge A in Groesse M: unter 85cm=kurz (Mini gewollt), 85-100cm=knianah, ueber 100cm=lang (Midi gewollt). Berechne Kleidende ab Boden = Koerpergroesse minus Kleidlaenge A. Kniehoehe ab Boden: Innenbeinlaenge × 0.55 oder Koerpergroesse × 0.27. Erwaehne die Kleidlaenge nur im fitNote wenn sie auffaellig vom gewollten Typ abweicht.

FINALE PRUEFUNG vor Ausgabe:
1. Steht die im explanation-Text genannte Groesse exakt in recommendedSize?
2. Liegt die alternativeSize direkt neben recommendedSize (nie ueberspringen)?
3. SELF-CHECK: Liegt die empfohlene Groesse im Idealbereich 85-90%? Wenn ueber 92%: gehe eine Groesse kleiner und pruefe neu.

Antworte NUR mit dem geforderten JSON-Objekt.`;

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