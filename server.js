const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

let campaigns = {};

// ── TWILIO XML (TwiML) — tocado quando a ligação atende ───────────────────
app.get('/play-audio/:campaignId', (req, res) => {
  const campaign = campaigns[req.params.campaignId];
  if (!campaign || !campaign.audioUrl) return res.status(404).send('Not found');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.play(campaign.audioUrl);
  res.set('Content-Type', 'text/xml');
  res.send(response.toString());
});

// ── UPLOAD ÁUDIO ──────────────────────────────────────────────────────────
app.post('/api/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const ext = path.extname(req.file.originalname);
  const newPath = `uploads/${req.file.filename}${ext}`;
  fs.renameSync(req.file.path, newPath);
  const baseUrl = req.body.baseUrl || `http://localhost:${PORT}`;
  const publicUrl = `${baseUrl}/audio-file/${req.file.filename}${ext}`;
  res.json({ url: publicUrl, filename: req.file.filename + ext });
});

app.get('/audio-file/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ── PARSE CSV ─────────────────────────────────────────────────────────────
app.post('/api/parse-csv', upload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const numbers = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => {
      const val = Object.values(row)[0];
      if (val) {
        let num = String(val).replace(/\D/g, '');
        if (!num.startsWith('57')) num = '57' + num;
        if (!num.startsWith('+')) num = '+' + num;
        numbers.push(num);
      }
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);
      res.json({ count: numbers.length, numbers });
    })
    .on('error', () => res.status(500).json({ error: 'Erro ao processar CSV' }));
});

// ── INICIAR CAMPANHA ──────────────────────────────────────────────────────
app.post('/api/start-campaign', async (req, res) => {
  const { accountSid, authToken, fromNumber, numbers, audioUrl, callsPerBatch, delayMs, baseUrl } = req.body;
  if (!accountSid || !authToken || !fromNumber || !numbers?.length || !audioUrl) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const campaignId = Date.now().toString();
  const client = twilio(accountSid, authToken);
  const twimlUrl = `${baseUrl || req.headers.origin}/play-audio/${campaignId}`;

  campaigns[campaignId] = {
    audioUrl,
    status: 'running',
    total: numbers.length,
    dialed: 0,
    answered: 0,
    failed: 0,
    pending: numbers.length,
    log: [],
    startTime: Date.now()
  };

  res.json({ campaignId, total: numbers.length });

  const batchSize = parseInt(callsPerBatch) || 5;
  const delay = parseInt(delayMs) || 1500;

  for (let i = 0; i < numbers.length; i += batchSize) {
    if (campaigns[campaignId].status === 'stopped') break;
    const batch = numbers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (num) => {
      try {
        await client.calls.create({
          to: num,
          from: fromNumber,
          url: twimlUrl,
          method: 'GET'
        });
        campaigns[campaignId].dialed++;
        campaigns[campaignId].pending--;
        campaigns[campaignId].answered++;
        campaigns[campaignId].log.unshift({
          number: num, status: 'dialed', time: new Date().toLocaleTimeString()
        });
      } catch (e) {
        campaigns[campaignId].dialed++;
        campaigns[campaignId].pending--;
        campaigns[campaignId].failed++;
        campaigns[campaignId].log.unshift({
          number: num, status: 'failed', error: e.message, time: new Date().toLocaleTimeString()
        });
      }
      if (campaigns[campaignId].log.length > 200) campaigns[campaignId].log.pop();
    }));
    await new Promise(r => setTimeout(r, delay));
  }

  if (campaigns[campaignId].status !== 'stopped') {
    campaigns[campaignId].status = 'completed';
  }
});

// ── STATUS ────────────────────────────────────────────────────────────────
app.get('/api/status/:campaignId', (req, res) => {
  const c = campaigns[req.params.campaignId];
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
  res.json(c);
});

// ── PARAR ─────────────────────────────────────────────────────────────────
app.post('/api/stop/:campaignId', (req, res) => {
  if (campaigns[req.params.campaignId]) campaigns[req.params.campaignId].status = 'stopped';
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Twilio Broadcast rodando na porta ${PORT}`));
