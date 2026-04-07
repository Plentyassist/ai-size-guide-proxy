const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/size-recommendation', async (req, res) => {
  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(
      'https://ai-size-guide.lovable.app/functions/v1/size-recommendation',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }
    );
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log('Proxy running on port 3001'));
