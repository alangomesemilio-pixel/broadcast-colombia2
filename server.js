const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

let campaigns = {};

// ── TWIML — toca áudio quando atende ─────────────────────────────────────
app.get('/play-audio/:campaignId', (req, res) => {
  const campaign = campaigns[req.params.campaignId];
  if (!campaign || !campaign.audioUrl) return res.status(404).send('Not found');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.play(campaign.audioUrl);
  res.set('Content-Type', 'text/xml');
  res.send(response.toString());
});

// ── CALLBACK DE STATUS — Twilio avisa o que aconteceu com cada ligação ───
app.post('/call-status/:campaignId/:number', (req, res) => {
  const { campaignId, number } = req.params;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration || 0;
  const campaign = campaigns[campaignId];
  if (!campaign) return res.sendStatus(200);

  const statusMap = {
    'completed':    { label: 'Atendeu',        icon: '✅', group: 'answered' },
    'no-answer':    { label: 'Não atendeu',     icon: '📵', group: 'noAnswer' },
    'busy':         { label: 'Ocupado',         icon: '🔴', group: 'busy' },
    'failed':       { label: 'Falhou',          icon: '❌', group: 'failed' },
    'canceled':     { label: 'Cancelado',       icon: '⛔', group: 'failed' },
    'ringing':      { label: 'Chamando',        icon: '🔔', group: 'ringing' },
    'in-progress':  { label: 'Em andamento',    icon: '📞', group: 'ringing' },
  };

  const info = statusMap[callStatus] || { label: callStatus, icon: '❓', group: 'failed' };

  // Atualiza contadores
  if (info.group === 'answered') {
    campaign.answered = (campaign.answered || 0) + 1;
    campaign.totalDuration = (campaign.totalDuration || 0) + parseInt(callDuration);
  } else if (info.group === 'noAnswer') {
    campaign.noAnswer = (campaign.noAnswer || 0) + 1;
  } else if (info.group === 'busy') {
    campaign.busy = (campaign.busy || 0) + 1;
  } else if (info.group === 'failed') {
    campaign.failed = (campaign.failed || 0) + 1;
  }

  // Atualiza log
  const logEntry = campaign.log.find(l => l.number === '+' + number || l.number === number);
  if (logEntry) {
    logEntry.status = info.group;
    logEntry.statusLabel = info.label;
    logEntry.icon = info.icon;
    logEntry.duration = callDuration;
  } else {
    campaign.log.unshift({
      number: '+' + number,
      status: info.group,
      statusLabel: info.label,
      icon: info.icon,
      duration: callDuration,
      time: new Date().toLocaleTimeString()
    });
  }

  if (campaign.log.length > 500) campaign.log.pop();
  res.sendStatus(200);
});

// ── UPLOAD ÁUDIO ──────────────────────────────────────────────────────────
app.post('/api/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const ext = path.extname(req.file.originalname);
  const newPath = `uploads/${req.file.filename}${ext}`;
  fs.renameSync(req.file.path, newPath);
  const baseUrl = req.body.baseUrl || `http://localhost:${PORT}`;
  res.json({ url: `${baseUrl}/audio-file/${req.file.filename}${ext}` });
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
    .on('end', () => { fs.unlinkSync(req.file.path); res.json({ count: numbers.length, numbers }); })
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
  const base = baseUrl || `http://localhost:${PORT}`;

  campaigns[campaignId] = {
    audioUrl, status: 'running',
    total: numbers.length,
    dialed: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0,
    totalDuration: 0,
    log: [], startTime: Date.now()
  };

  res.json({ campaignId, total: numbers.length });

  const batchSize = parseInt(callsPerBatch) || 5;
  const delay = parseInt(delayMs) || 1500;

  for (let i = 0; i < numbers.length; i += batchSize) {
    if (campaigns[campaignId].status === 'stopped') break;
    const batch = numbers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (num) => {
      const numClean = num.replace('+', '');
      try {
        await client.calls.create({
          to: num,
          from: fromNumber,
          url: `${base}/play-audio/${campaignId}`,
          method: 'GET',
          statusCallback: `${base}/call-status/${campaignId}/${numClean}`,
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['completed', 'no-answer', 'busy', 'failed', 'canceled']
        });
        campaigns[campaignId].dialed++;
        campaigns[campaignId].log.unshift({
          number: num, status: 'ringing', statusLabel: 'Chamando', icon: '🔔',
          duration: 0, time: new Date().toLocaleTimeString()
        });
      } catch (e) {
        campaigns[campaignId].dialed++;
        campaigns[campaignId].failed++;
        campaigns[campaignId].log.unshift({
          number: num, status: 'failed', statusLabel: 'Erro: ' + e.message, icon: '❌',
          duration: 0, time: new Date().toLocaleTimeString()
        });
      }
      if (campaigns[campaignId].log.length > 500) campaigns[campaignId].log.pop();
    }));
    await new Promise(r => setTimeout(r, delay));
  }

  if (campaigns[campaignId].status !== 'stopped') campaigns[campaignId].status = 'completed';
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
