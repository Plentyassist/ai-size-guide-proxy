const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

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
          content: `You are a garment fit assistant. Given this customer profile and product measurements, recommend the best size. Measurements marked as half:true must be doubled to get circumference. Consider the customer fit preference (Eng=tight, Normal=regular, Locker=loose). If measurements exceed available sizes, say so honestly. Respond ONLY with a JSON object: {"recommendedSize":"...","alternativeSize":"...","explanation":"...","fitNote":"..."}

Customer profile: ${JSON.stringify(profile)}
Product measurements: ${JSON.stringify(measurements)}`
        }]
      })
    });
    const data = await response.json();
    const text = data.content[0].text;
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(json);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3001, () => console.log('Proxy running'));
